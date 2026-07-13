import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export interface LocalGecResult {
  corrected: string;
  model: string;
}

interface PendingRequest {
  resolve: (result: LocalGecResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: ChildProcessWithoutNullStreams | undefined;
let buffer = "";
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function getTimeoutMs() {
  return Number(process.env.CHATPOLISH_GEC_TIMEOUT_MS ?? 90_000);
}

function workerPath() {
  return path.resolve(process.cwd(), "workers", "korean_gec_worker.py");
}

function pythonCommand() {
  return process.env.CHATPOLISH_PYTHON ?? "python";
}

function shutdownWorker(error?: Error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error ?? new Error("Local GEC worker stopped."));
  }
  pending.clear();
  buffer = "";

  if (worker && !worker.killed) {
    worker.kill();
  }
  worker = undefined;
}

function ensureWorker() {
  if (worker && !worker.killed) {
    return worker;
  }

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
      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line) as {
          id: number;
          ok: boolean;
          corrected?: string;
          model?: string;
          error?: string;
        };
        const request = pending.get(message.id);
        if (!request) {
          continue;
        }
        pending.delete(message.id);
        clearTimeout(request.timer);

        if (message.ok && typeof message.corrected === "string") {
          request.resolve({
            corrected: message.corrected,
            model: message.model ?? process.env.CHATPOLISH_GEC_MODEL ?? "Soyoung97/gec_kr"
          });
        } else {
          request.reject(new Error(message.error ?? "Local GEC worker failed."));
        }
      } catch (error) {
        shutdownWorker(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  child.stderr.on("data", (chunk: string) => {
    if (process.env.CHATPOLISH_DEBUG === "1") {
      console.error(`[local-gec] ${chunk.trim()}`);
    }
  });

  child.on("error", (error) => shutdownWorker(error));
  child.on("exit", (code, signal) => {
    shutdownWorker(new Error(`Local GEC worker exited with code ${code ?? "none"} signal ${signal ?? "none"}.`));
  });

  worker = child;
  return child;
}

export function correctWithLocalGecModel(text: string): Promise<LocalGecResult> {
  const child = ensureWorker();
  const id = nextId++;

  return new Promise<LocalGecResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Local GEC model timed out after ${getTimeoutMs()}ms.`));
    }, getTimeoutMs());

    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method: "correct", text })}\n`, "utf8", (error) => {
      if (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

export function stopLocalGecWorker() {
  shutdownWorker();
}
