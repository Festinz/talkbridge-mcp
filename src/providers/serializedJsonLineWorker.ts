import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface WorkerMessage {
  id: number;
  ok: boolean;
  error?: string;
}

interface QueuedRequest<T extends WorkerMessage> {
  id: number;
  payload: Record<string, unknown>;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
}

interface ActiveRequest<T extends WorkerMessage> extends QueuedRequest<T> {
  settled: boolean;
  timer: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

export interface SerializedWorkerOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: () => number;
  timeoutGraceMs?: number;
  debugLabel: string;
}

export class SerializedJsonLineWorker<T extends WorkerMessage> {
  private worker?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly queue: Array<QueuedRequest<T>> = [];
  private active?: ActiveRequest<T>;
  private stopping = false;

  constructor(private readonly options: SerializedWorkerOptions) {}

  request(payload: Record<string, unknown>) {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, payload, resolve, reject });
      this.pump();
    });
  }

  stop(error = new Error(`${this.options.debugLabel} worker stopped.`)) {
    this.stopping = true;
    this.rejectAll(error);
    if (this.worker && !this.worker.killed) this.worker.kill();
    this.worker = undefined;
    this.buffer = "";
    this.stopping = false;
  }

  private pump() {
    if (this.active || this.queue.length === 0) return;
    const request = this.queue.shift();
    if (!request) return;

    const child = this.ensureWorker();
    const timeoutMs = this.options.timeoutMs();
    const timer = setTimeout(() => {
      if (!this.active || this.active.id !== request.id || this.active.settled) return;
      this.active.settled = true;
      this.active.reject(new Error(`${this.options.debugLabel} timed out after ${timeoutMs}ms.`));
      this.active.killTimer = setTimeout(() => {
        if (this.active?.id === request.id && this.worker && !this.worker.killed) this.worker.kill();
      }, this.options.timeoutGraceMs ?? Math.max(timeoutMs, 5000));
    }, timeoutMs);

    this.active = { ...request, settled: false, timer };
    child.stdin.write(`${JSON.stringify({ id: request.id, ...request.payload })}\n`, "utf8", (error) => {
      if (!error || this.active?.id !== request.id) return;
      clearTimeout(this.active.timer);
      if (this.active.killTimer) clearTimeout(this.active.killTimer);
      if (!this.active.settled) this.active.reject(error);
      this.active = undefined;
      this.pump();
    });
  }

  private ensureWorker() {
    if (this.worker && !this.worker.killed) return this.worker;

    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleOutput(chunk));
    child.stderr.on("data", (chunk: string) => {
      if (process.env.CHATPOLISH_DEBUG === "1") {
        console.error(`[${this.options.debugLabel}] ${chunk.trim()}`);
      }
    });
    child.on("error", (error) => this.handleExit(child, error));
    child.on("exit", (code, signal) => {
      this.handleExit(child, new Error(`${this.options.debugLabel} exited with code ${code ?? "none"} signal ${signal ?? "none"}.`));
    });
    this.worker = child;
    return child;
  }

  private handleOutput(chunk: string) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf("\n");
      if (!line) continue;

      let message: T;
      try {
        message = JSON.parse(line) as T;
      } catch (error) {
        if (this.worker) this.handleExit(this.worker, error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!this.active || message.id !== this.active.id) continue;
      clearTimeout(this.active.timer);
      if (this.active.killTimer) clearTimeout(this.active.killTimer);
      if (!this.active.settled) {
        if (message.ok) this.active.resolve(message);
        else this.active.reject(new Error(message.error ?? `${this.options.debugLabel} request failed.`));
      }
      this.active = undefined;
      this.pump();
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.worker !== child) return;
    this.worker.removeAllListeners();
    this.worker = undefined;
    if (child.exitCode === null && !child.killed) child.kill();
    this.buffer = "";
    if (this.active) {
      clearTimeout(this.active.timer);
      if (this.active.killTimer) clearTimeout(this.active.killTimer);
      if (!this.active.settled) this.active.reject(error);
      this.active = undefined;
    }
    if (this.stopping) return;
    this.pump();
  }

  private rejectAll(error: Error) {
    if (this.active) {
      clearTimeout(this.active.timer);
      if (this.active.killTimer) clearTimeout(this.active.killTimer);
      if (!this.active.settled) this.active.reject(error);
      this.active = undefined;
    }
    for (const request of this.queue.splice(0)) request.reject(error);
  }
}
