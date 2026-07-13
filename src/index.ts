import { createApp } from "./app.js";
import {
  prewarmArgosTranslationWorker,
  stopArgosTranslationWorker
} from "./providers/argosTranslationProvider.js";
import {
  prewarmNllbTranslationWorker,
  stopNllbTranslationWorker
} from "./providers/nllbTranslationProvider.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`TalkBridge MCP server listening at http://${host}:${port}`);
  console.log(`MCP endpoint: http://${host}:${port}/mcp`);
  void prewarmArgosTranslationWorker();
  void prewarmNllbTranslationWorker();
});

function shutdown() {
  stopArgosTranslationWorker();
  stopNllbTranslationWorker();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
