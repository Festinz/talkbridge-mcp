import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  bridgeChatTurn,
  getTranslationService,
  partnerLanguageState,
  translateMyMessage,
  translatePartnerMessage
} from "./bridgeService.js";
import {
  correctChat,
  explainChat,
  generateChatOptions,
  polishChat,
  providerCapabilities
} from "./correctionService.js";
import { createTalkBridgeMcpServer } from "./mcpServer.js";
import { imageBridgeConfig, translateConversationImage } from "./imageBridgeService.js";
import { createRateLimit } from "./rateLimit.js";
import { LOCAL_PROVIDER } from "./ruleEngine.js";
import { normalizeLanguage } from "./translation.js";
import type { Audience, ProviderMode, Tone } from "./types.js";

const publicDir = path.resolve(process.cwd(), "public");
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: imageBridgeConfig().maxImageBytes },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  }
});

function requireText(req: Request, res: Response): string | undefined {
  const text = req.body?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({
      error: "text is required",
      message: "교정할 문장을 text 필드에 넣어 주세요."
    });
    return undefined;
  }
  return text;
}

export function createApp() {
  const bindHost = process.env.MCP_BIND_HOST ?? process.env.HOST ?? "127.0.0.1";
  const allowedHosts = parseCsv(process.env.MCP_ALLOWED_HOSTS);
  const app = createMcpExpressApp(
    allowedHosts.length > 0 ? { host: bindHost, allowedHosts } : { host: bindHost }
  );

  app.use(
    createRateLimit(
      readPositiveInt(process.env.CHATPOLISH_RATE_LIMIT_WINDOW_MS, 60_000),
      readPositiveInt(process.env.CHATPOLISH_RATE_LIMIT_MAX, 120)
    )
  );

  app.use(express.static(publicDir));

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "TalkBridge",
      provider: LOCAL_PROVIDER,
      capabilities: providerCapabilities(),
      translation: getTranslationService().status(),
      externalApi: false
    });
  });

  app.get("/readyz", async (_req, res) => {
    const translation = await getTranslationService().readiness();
    res.status(translation.ready ? 200 : 503).json({
      ok: translation.ready,
      service: "TalkBridge",
      translation
    });
  });

  app.post("/api/demo/correct", async (req, res) => {
    const text = requireText(req, res);
    if (!text) {
      return;
    }

    res.json(
      await correctChat(text, {
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.post("/api/demo/polish", async (req, res) => {
    const text = requireText(req, res);
    if (!text) {
      return;
    }

    res.json(
      await polishChat(text, {
        audience: req.body?.audience as Audience | undefined,
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.post("/api/demo/options", async (req, res) => {
    const text = requireText(req, res);
    if (!text) {
      return;
    }

    res.json(
      await generateChatOptions(text, {
        audience: req.body?.audience as Audience | undefined,
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined,
        count: Number.isInteger(req.body?.count) ? Number(req.body.count) : 3
      })
    );
  });

  app.post("/api/demo/explain", async (req, res) => {
    const text = requireText(req, res);
    if (!text) {
      return;
    }

    res.json(
      await explainChat(text, {
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.get("/api/demo/providers", (_req, res) => {
    res.json(providerCapabilities());
  });

  app.post("/api/demo/set-partner-language", (req, res) => {
    const conversationId = String(req.body?.conversationId ?? "default");
    const state = partnerLanguageState(conversationId, normalizeLanguage(req.body?.partnerLanguage));
    res.json(state);
  });

  app.get("/api/demo/partner-language", (req, res) => {
    res.json(partnerLanguageState(String(req.query.conversationId ?? "default")));
  });

  app.post("/api/demo/partner-message", async (req, res) => {
    const text = requireText(req, res);
    if (!text) return;
    res.json(
      await translatePartnerMessage(text, {
        conversationId: String(req.body?.conversationId ?? "default"),
        myLanguage: normalizeLanguage(req.body?.myLanguage, "ko"),
        sourceLanguage: normalizeLanguage(req.body?.sourceLanguage)
      })
    );
  });

  app.post("/api/demo/my-message", async (req, res) => {
    const text = requireText(req, res);
    if (!text) return;
    res.json(
      await translateMyMessage(text, {
        conversationId: String(req.body?.conversationId ?? "default"),
        myLanguage: normalizeLanguage(req.body?.myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(req.body?.partnerLanguage),
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.post("/api/demo/bridge-turn", async (req, res) => {
    const incoming = typeof req.body?.incomingMessage === "string" ? req.body.incomingMessage.trim() : "";
    const draft = typeof req.body?.myDraft === "string" ? req.body.myDraft.trim() : "";
    if (!incoming && !draft) {
      res.status(400).json({ error: "missing_text", message: "incomingMessage 또는 myDraft 중 하나를 입력해 주세요." });
      return;
    }
    if (incoming.length > 2000 || draft.length > 2000) {
      res.status(400).json({ error: "text_too_long", message: "메시지는 2000자 이하로 입력해 주세요." });
      return;
    }
    res.json(
      await bridgeChatTurn({
        conversationId: String(req.body?.conversationId ?? "default"),
        incomingMessage: incoming || undefined,
        myDraft: draft || undefined,
        myLanguage: normalizeLanguage(req.body?.myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(req.body?.partnerLanguage),
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.post("/api/demo/live-preview", async (req, res) => {
    const draft = typeof req.body?.myDraft === "string" ? req.body.myDraft.trim() : "";
    if (!draft) {
      res.json({ preview: null });
      return;
    }
    res.json(
      await bridgeChatTurn({
        conversationId: String(req.body?.conversationId ?? "default"),
        myDraft: draft,
        myLanguage: normalizeLanguage(req.body?.myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(req.body?.partnerLanguage),
        tone: req.body?.tone as Tone | undefined,
        provider: req.body?.provider as ProviderMode | undefined
      })
    );
  });

  app.post("/api/demo/image-bridge", (req, res) => {
    imageUpload.single("image")(req, res, async (error) => {
      if (error instanceof multer.MulterError) {
        res.status(413).json({ error: "image_upload_failed", message: error.code });
        return;
      }
      if (error) {
        res.status(415).json({ error: "unsupported_image", message: "Only image uploads are supported." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "image is required", message: "Attach a screenshot or photo of the conversation." });
        return;
      }

      try {
        const result = await translateConversationImage(req.file.buffer, {
          conversationId: String(req.body?.conversationId ?? "default"),
          myLanguage: normalizeLanguage(req.body?.myLanguage, "ko"),
          partnerLanguage: normalizeLanguage(req.body?.partnerLanguage),
          tone: req.body?.tone as Tone | undefined,
          provider: req.body?.provider as ProviderMode | undefined
        });
        console.info("image_bridge", {
          adapter: result.ocrProvider,
          ocrLanguages: result.ocrLanguages,
          detectedMessages: result.detectedMessages,
          latencyMs: result.latencyMs,
          imageBytes: result.imageBytes
        });
        res.json(result);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "image_processing_failed";
        console.error("image_bridge_failed", { message });
        const status = message.startsWith("image_too_large") ? 413 : message === "ocr_timeout" ? 504 : 422;
        res.status(status).json({ error: "image_processing_failed", message });
      }
    });
  });

  app.post("/mcp", requireMcpAuth, async (req, res) => {
    const server = createTalkBridgeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST /mcp."
      },
      id: null
    });
  });

  return app;
}

function requireMcpAuth(req: Request, res: Response, next: NextFunction) {
  const token = process.env.MCP_BEARER_TOKEN?.trim();
  if (!token) {
    next();
    return;
  }

  if (req.header("authorization") === `Bearer ${token}`) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized"
    },
    id: null
  });
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
