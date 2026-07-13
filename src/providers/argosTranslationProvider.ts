import path from "node:path";
import { SerializedJsonLineWorker } from "./serializedJsonLineWorker.js";

export interface ArgosTranslationResult {
  translatedText: string;
  model: string;
}

interface ArgosWorkerResponse {
  id: number;
  ok: boolean;
  translatedText?: string;
  model?: string;
  error?: string;
}

const DEFAULT_MODEL_PAIRS = [
  "en-ko",
  "ko-en",
  "en-ja",
  "ja-en",
  "en-zh",
  "zh-en",
  "en-es",
  "es-en"
];

let client: SerializedJsonLineWorker<ArgosWorkerResponse> | undefined;

export function argosTranslationEnabled() {
  return process.env.CHATPOLISH_ARGOS_ENABLED === "1";
}

export function argosCanTranslate(source: string, target: string) {
  if (source === target) return true;
  const graph = new Map<string, Set<string>>();
  for (const pair of configuredPairs()) {
    const [from, to] = pair.split("-");
    if (!from || !to) continue;
    const destinations = graph.get(from) ?? new Set<string>();
    destinations.add(to);
    graph.set(from, destinations);
  }

  const visited = new Set([source]);
  const queue = [source];
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const destination of graph.get(current) ?? []) {
      if (destination === target) return true;
      if (visited.has(destination)) continue;
      visited.add(destination);
      queue.push(destination);
    }
  }
  return false;
}

export async function translateWithArgos(text: string, source: string, target: string) {
  if (!argosTranslationEnabled()) throw new Error("Argos translation is disabled.");
  if (!argosCanTranslate(source, target)) throw new Error(`Argos model route is unavailable: ${source}-${target}`);

  const response = await getClient().request({ method: "translate", text, source, target });
  if (typeof response.translatedText !== "string") throw new Error("Argos returned no translated text.");
  return {
    translatedText: response.translatedText,
    model: response.model ?? "argos-translate"
  } satisfies ArgosTranslationResult;
}

export function stopArgosTranslationWorker() {
  client?.stop();
  client = undefined;
}

export async function prewarmArgosTranslationWorker() {
  if (!argosTranslationEnabled() || process.env.CHATPOLISH_NLLB_ENABLED === "1") return;
  const samples = [
    ["Hello", "en", "ko"],
    ["안녕하세요", "ko", "en"],
    ["こんにちは", "ja", "ko"],
    ["안녕하세요", "ko", "ja"],
    ["Hola", "es", "ko"],
    ["안녕하세요", "ko", "es"]
  ] as const;

  for (const [text, source, target] of samples) {
    try {
      await translateWithArgos(text, source, target);
    } catch {
      // Readiness remains available while optional language routes warm up.
    }
  }
}

function configuredPairs() {
  return (process.env.CHATPOLISH_ARGOS_MODEL_PAIRS ?? DEFAULT_MODEL_PAIRS.join(","))
    .split(",")
    .map((pair) => pair.trim().toLowerCase())
    .filter((pair) => /^[a-z]{2,3}-[a-z]{2,3}$/.test(pair));
}

function getClient() {
  client ??= new SerializedJsonLineWorker<ArgosWorkerResponse>({
    command: process.env.CHATPOLISH_PYTHON ?? "python",
    args: [path.resolve(process.cwd(), "workers", "argos_translate_worker.py")],
    cwd: process.cwd(),
    env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    timeoutMs: () => Number(process.env.CHATPOLISH_ARGOS_TIMEOUT_MS ?? 12000),
    timeoutGraceMs: 30000,
    debugLabel: "argos"
  });
  return client;
}
