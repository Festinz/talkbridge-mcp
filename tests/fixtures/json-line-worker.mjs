import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });

for await (const line of lines) {
  const request = JSON.parse(line);
  await new Promise((resolve) => setTimeout(resolve, Number(request.delayMs ?? 0)));
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value: request.value })}\n`);
}
