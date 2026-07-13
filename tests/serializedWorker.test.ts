import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SerializedJsonLineWorker } from "../src/providers/serializedJsonLineWorker.js";

interface EchoResponse {
  id: number;
  ok: boolean;
  value?: string;
  error?: string;
}

let worker: SerializedJsonLineWorker<EchoResponse> | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
});

describe("SerializedJsonLineWorker", () => {
  it("starts each timeout only when that request reaches the single worker", async () => {
    worker = new SerializedJsonLineWorker<EchoResponse>({
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/json-line-worker.mjs", import.meta.url))],
      cwd: process.cwd(),
      timeoutMs: () => 350,
      debugLabel: "test-worker"
    });

    const started = Date.now();
    const [first, second] = await Promise.all([
      worker.request({ value: "first", delayMs: 200 }),
      worker.request({ value: "second", delayMs: 200 })
    ]);

    expect(first.value).toBe("first");
    expect(second.value).toBe("second");
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
  });
});
