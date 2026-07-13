import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("MCP tools", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = undefined;
    }
  });

  async function connectClient() {
    const httpServer = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => httpServer.once("listening", resolve));
    const port = (httpServer.address() as AddressInfo).port;
    closeServer = () => new Promise<void>((resolve) => httpServer.close(() => resolve()));

    const client = new Client({
      name: "talkbridge-test-client",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);

    return client;
  }

  it("lists PlayMCP-ready tools with schemas and annotations", async () => {
    const client = await connectClient();
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "detect_chat_language",
      "translate_received_message",
      "prepare_message_to_send",
      "bridge_chat_turn",
      "translate_chat_transcript",
      "correct_korean_message"
    ]);
    expect(result.tools.length).toBeGreaterThanOrEqual(3);
    expect(result.tools.length).toBeLessThanOrEqual(10);
    for (const tool of result.tools) {
      expect(tool.description).toContain("TalkBridge(톡브릿지)");
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.annotations).toMatchObject({
        title: expect.any(String),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
      expect(tool.name).not.toContain("kakao");
    }
    await client.close();
  });

  it("calls a correction tool", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "correct_korean_message",
      arguments: {
        text: "안녕하세요 잘지내셨나요"
      }
    });

    const payload = result.structuredContent as {
      correctedText: string;
      externalApi: boolean;
    };
    expect(payload.correctedText).toBe("안녕하세요. 잘 지내셨나요?");
    expect(payload.externalApi).toBe(false);
    await client.close();
  });

  it("detects an incoming language without an external API", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "detect_chat_language",
      arguments: { text: "¿A qué hora nos vemos mañana?" }
    });

    const payload = result.structuredContent as { language: string; languageLabel: string };
    expect(payload.language).toBe("es");
    expect(payload.languageLabel).toBe("스페인어");
    await client.close();
  });

  it("bridges an incoming message and an outgoing corrected draft", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "bridge_chat_turn",
      arguments: {
        incomingMessage: "明日、何時に会える？",
        myDraft: "저녁 7시에 어때?"
      }
    });

    const payload = result.structuredContent as {
      receivedTranslation: string;
      correctedReply: string;
      translatedReply: string;
      externalApi: boolean;
    };
    expect(payload.receivedTranslation).toBe("내일 몇 시에 만날 수 있어?");
    expect(payload.correctedReply).toBe("저녁 7시에 어때?");
    expect(payload.translatedReply).toBe("19時はどう？");
    expect(payload.externalApi).toBe(false);
    await client.close();
  });

  it("translates ordered transcript bubbles and preserves sides", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "translate_chat_transcript",
      arguments: {
        messages: [
          { id: "left-1", side: "incoming", text: "where should we meet?" },
          { id: "right-1", side: "outgoing", text: "역 앞에서 보자" }
        ]
      }
    });

    const payload = result.structuredContent as {
      partnerLanguage: string;
      messages: Array<{ id: string; side: string; translatedText: string }>;
    };
    expect(payload.partnerLanguage).toBe("en");
    expect(payload.messages).toMatchObject([
      { id: "left-1", side: "incoming", translatedText: "어디서 만날까?" },
      { id: "right-1", side: "outgoing", translatedText: "Let's meet in front of the station." }
    ]);
    await client.close();
  });
});
