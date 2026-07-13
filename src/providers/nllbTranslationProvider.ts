import path from "node:path";
import { nllbSupportedLanguage } from "../languageCatalog.js";
import { SerializedJsonLineWorker } from "./serializedJsonLineWorker.js";

export interface NllbTranslationResult {
  translatedText: string;
  model: string;
  sourceTag?: string;
  targetTag?: string;
}

interface NllbWorkerResponse {
  id: number;
  ok: boolean;
  translatedText?: string;
  model?: string;
  sourceTag?: string;
  targetTag?: string;
  error?: string;
}

let client: SerializedJsonLineWorker<NllbWorkerResponse> | undefined;

export function nllbTranslationEnabled() {
  return process.env.CHATPOLISH_NLLB_ENABLED === "1";
}

export function nllbCanTranslate(source: string, target: string) {
  return source !== target && nllbSupportedLanguage(source) && nllbSupportedLanguage(target);
}

export async function translateWithNllb(text: string, source: string, target: string) {
  if (!nllbTranslationEnabled()) throw new Error("NLLB translation is disabled.");
  if (!nllbCanTranslate(source, target)) throw new Error(`NLLB language route is unavailable: ${source}-${target}`);

  const response = await getClient().request({ method: "translate", text, source, target });
  if (typeof response.translatedText !== "string") throw new Error("NLLB returned no translated text.");
  return {
    translatedText: response.translatedText,
    model: response.model ?? "nllb-200-distilled-600M-int8",
    sourceTag: response.sourceTag,
    targetTag: response.targetTag
  } satisfies NllbTranslationResult;
}

export function stopNllbTranslationWorker() {
  client?.stop();
  client = undefined;
}

export async function prewarmNllbTranslationWorker() {
  if (!nllbTranslationEnabled()) return;
  try {
    await translateWithNllb("Hello", "en", "ko");
  } catch {
    // The server remains healthy and reports fallback until the optional model is ready.
  }
}

function getClient() {
  client ??= new SerializedJsonLineWorker<NllbWorkerResponse>({
    command: process.env.CHATPOLISH_PYTHON ?? "python",
    args: [path.resolve(process.cwd(), "workers", "nllb_translate_worker.py")],
    cwd: process.cwd(),
    env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    timeoutMs: () => Number(process.env.CHATPOLISH_NLLB_TIMEOUT_MS ?? 60000),
    timeoutGraceMs: 30000,
    debugLabel: "nllb"
  });
  return client;
}
