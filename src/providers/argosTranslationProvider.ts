import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export interface ArgosTranslationResult {
  translatedText: string;
  model: string;
}

interface PendingRequest {
  resolve: (result: ArgosTranslationResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: ChildProcessWithoutNullStreams | undefined;
let buffer = "";
let nextId = 1;
const pending = new Map<number, PendingRequest>();

export function argosTranslationEnabled() {
  return process.env.CHATPOLISH_ARGOS_ENABLED === "1";
}

function timeoutMs() {
  return Number(process.env.CHATPOLISH_ARGOS_TIMEOUT_MS ?? 2800);
}

function workerPath() {
  return path.resolve(process.cwd(), "workers", "argos_translate_worker.py");
}

function pythonCommand() {
  return process.env.CHATPOLISH_PYTHON ?? "python";
}

function shutdownWorker(error?: Error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error ?? new Error("Argos translation worker stopped."));
  }
  pending.clear();
  buffer = "";
  if (worker && !worker.killed) worker.kill();
  worker = undefined;
}

function ensureWorker() {
  if (!argosTranslationEnabled()) throw new Error("Argos translation is disabled.");
  if (worker && !worker.killed) return worker;

  const child = spawn(pythonCommand(), [workerPath()], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line) continue;
      try {
        const message = JSON.parse(line) as {
          id: number;
          ok: boolean;
          translatedText?: string;
          model?: string;
          error?: string;
        };
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.ok && typeof message.translatedText === "string") {
          request.resolve({ translatedText: message.translatedText, model: message.model ?? "argos-translate" });
        } else {
          request.reject(new Error(message.error ?? "Argos translation failed."));
        }
      } catch (error) {
        shutdownWorker(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    if (process.env.CHATPOLISH_DEBUG === "1") console.error(`[argos] ${chunk.trim()}`);
  });
  child.on("error", (error) => shutdownWorker(error));
  child.on("exit", (code, signal) => {
    shutdownWorker(new Error(`Argos worker exited with code ${code ?? "none"} signal ${signal ?? "none"}.`));
  });
  worker = child;
  return child;
}

export function translateWithArgos(text: string, source: string, target: string) {
  const child = ensureWorker();
  const id = nextId++;
  return new Promise<ArgosTranslationResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Argos translation timed out after ${timeoutMs()}ms.`));
    }, timeoutMs());
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method: "translate", text, source, target })}\n`, "utf8", (error) => {
      if (!error) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function stopArgosTranslationWorker() {
  shutdownWorker();
}
