import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:3010/mcp";
const sampleText = process.argv[3] ?? "Could you send me the updated schedule after lunch?";
const sourceLanguage = process.argv[4] ?? "auto";
const client = new Client({ name: "talkbridge-smoke-client", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

try {
  const connectedAt = performance.now();
  await client.connect(transport);
  const initializeMs = performance.now() - connectedAt;

  const toolsStarted = performance.now();
  const tools = await client.listTools();
  const toolsListMs = performance.now() - toolsStarted;

  const detectStarted = performance.now();
  const detected = await client.callTool({
    name: "detect_chat_language",
    arguments: { text: "¿A qué hora nos vemos mañana?" }
  });
  const detectMs = performance.now() - detectStarted;

  const translateStarted = performance.now();
  const translated = await client.callTool({
    name: "translate_received_message",
    arguments: {
      text: sampleText,
      myLanguage: "ko",
      sourceLanguage
    }
  });
  const translateMs = performance.now() - translateStarted;

  console.log(JSON.stringify({
    endpoint,
    initializeMs: Math.round(initializeMs),
    toolsListMs: Math.round(toolsListMs),
    toolCount: tools.tools.length,
    toolNames: tools.tools.map((tool) => tool.name),
    detectMs: Math.round(detectMs),
    detected: detected.structuredContent,
    translateMs: Math.round(translateMs),
    translated: translated.structuredContent
  }, null, 2));
} finally {
  await client.close();
}
