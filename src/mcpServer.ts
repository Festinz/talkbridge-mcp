import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  translateChatTranscript,
  translateMyMessage,
  translatePartnerMessage,
  type ChatTranscriptResult
} from "./bridgeService.js";
import { correctChat } from "./correctionService.js";
import { detectLanguage, languageLabel, normalizeLanguage } from "./translation.js";
import { TONES } from "./types.js";

const SERVICE_NAME = "TalkBridge(톡브릿지)";
const toneSchema = z.enum(TONES).describe("Desired tone: neutral, polite, friendly, formal, or concise.");
const providerSchema = z
  .enum(["rules", "local-gec", "hybrid"])
  .describe("Local correction engine. Use rules for the fastest response.");
const languageSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .default("auto")
  .describe("Language code or name. Use auto for detection; ISO codes such as ko, en, ja, es, fr, de, ar, hi, vi, or an NLLB language tag are accepted.");
const partnerLanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .describe("Conversation partner language as an ISO code or language name, for example ja, en, es, fr, de, ar, hi, or vi.");
const transcriptMessageSchema = z.object({
  id: z.string().min(1).max(64).optional().describe("Optional stable message id."),
  side: z.enum(["incoming", "outgoing"]).describe("incoming is the partner on the left; outgoing is the user on the right."),
  text: z.string().min(1).max(1000).describe("One OCR-extracted or copied chat bubble.")
});

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

function toolResult(payload: object, markdown: string) {
  return {
    content: [{ type: "text" as const, text: markdown }],
    structuredContent: payload as Record<string, unknown>
  };
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function transcriptMarkdown(result: ChatTranscriptResult) {
  const rows = result.messages.map((message, index) => {
    const speaker = message.side === "incoming" ? "상대방" : "나";
    const corrected = message.correctedText && message.correctedText !== message.originalText
      ? `\n   교정: ${message.correctedText}`
      : "";
    const warning = message.fallback ? " (번역 엔진 확인 필요)" : "";
    return `${index + 1}. **${speaker}**: ${message.originalText}${corrected}\n   → ${message.translatedText}${warning}`;
  });
  return `**대화 번역 ${result.messages.length}개**\n\n${rows.join("\n\n")}\n\n상대 언어: ${result.partnerLanguageLabel}`;
}

export function createTalkBridgeMcpServer() {
  const server = new McpServer({ name: "talkbridge", version: "1.0.0" });

  server.registerTool(
    "detect_chat_language",
    {
      title: "채팅 언어 자동 감지",
      description: `${SERVICE_NAME} detects the language of any free-form copied chat message before translation.`,
      inputSchema: {
        text: z.string().min(1).max(2000).describe("Copied chat message to inspect.")
      },
      annotations: { title: "채팅 언어 자동 감지", ...annotations }
    },
    async ({ text }) => {
      const detected = detectLanguage(text);
      const payload = {
        language: detected.language,
        languageLabel: languageLabel(detected.language),
        confidence: detected.confidence
      };
      return toolResult(payload, `감지 언어: **${payload.languageLabel} (${payload.language})**\n신뢰도: ${percent(payload.confidence)}`);
    }
  );

  server.registerTool(
    "translate_received_message",
    {
      title: "받은 메시지 번역",
      description: `${SERVICE_NAME} auto-detects and translates any free-form partner message into the user's language with self-hosted local models.`,
      inputSchema: {
        text: z.string().min(1).max(2000).describe("Message copied from the conversation partner."),
        myLanguage: languageSchema.default("ko"),
        sourceLanguage: languageSchema
      },
      annotations: { title: "받은 메시지 번역", ...annotations }
    },
    async ({ text, myLanguage, sourceLanguage }) => {
      const response = await translatePartnerMessage(text, {
        conversationId: "stateless",
        myLanguage: normalizeLanguage(myLanguage, "ko"),
        sourceLanguage: normalizeLanguage(sourceLanguage)
      });
      const payload = response.result;
      const warning = payload.fallback ? "\n\n번역 엔진에서 이 문장을 처리하지 못해 원문을 표시했습니다." : "";
      return toolResult(
        payload,
        `**${payload.targetLabel} 번역**\n${payload.translatedText}\n\n원문 언어: ${payload.sourceLabel}${warning}`
      );
    }
  );

  server.registerTool(
    "prepare_message_to_send",
    {
      title: "보낼 메시지 교정·번역",
      description: `${SERVICE_NAME} corrects a user's Korean draft and translates any free-form message into the conversation partner's requested language.`,
      inputSchema: {
        text: z.string().min(1).max(2000).describe("Draft message the user wants to send."),
        partnerLanguage: partnerLanguageSchema,
        myLanguage: languageSchema.default("ko"),
        tone: toneSchema.optional().default("neutral"),
        provider: providerSchema.optional().default("rules")
      },
      annotations: { title: "보낼 메시지 교정·번역", ...annotations }
    },
    async ({ text, partnerLanguage, myLanguage, tone, provider }) => {
      const response = await translateMyMessage(text, {
        conversationId: "stateless",
        myLanguage: normalizeLanguage(myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(partnerLanguage),
        tone,
        provider
      });
      const payload = {
        correctedText: response.correction.corrected,
        translatedText: response.result.translatedText,
        partnerLanguage: response.partnerLanguage,
        partnerLanguageLabel: response.partnerLanguageLabel,
        fallback: response.result.fallback,
        provider: response.result.provider,
        externalApi: response.result.externalApi
      };
      const warning = payload.fallback ? "\n\n번역 엔진 확인이 필요합니다." : "";
      return toolResult(
        payload,
        `**교정된 문장**\n${payload.correctedText}\n\n**${payload.partnerLanguageLabel}로 보낼 문장**\n${payload.translatedText}${warning}`
      );
    }
  );

  server.registerTool(
    "bridge_chat_turn",
    {
      title: "받은 말 번역·답장 준비",
      description: `${SERVICE_NAME} translates one received message and corrects plus translates one reply in a single bidirectional chat turn.`,
      inputSchema: {
        incomingMessage: z.string().min(1).max(2000).describe("Partner message to translate."),
        myDraft: z.string().min(1).max(2000).describe("User reply to correct and translate."),
        myLanguage: languageSchema.default("ko"),
        partnerLanguage: partnerLanguageSchema.optional(),
        tone: toneSchema.optional().default("neutral"),
        provider: providerSchema.optional().default("rules")
      },
      annotations: { title: "받은 말 번역·답장 준비", ...annotations }
    },
    async ({ incomingMessage, myDraft, myLanguage, partnerLanguage, tone, provider }) => {
      const response = await translateChatTranscript({
        messages: [
          { id: "received", side: "incoming", text: incomingMessage },
          { id: "reply", side: "outgoing", text: myDraft }
        ],
        myLanguage: normalizeLanguage(myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(partnerLanguage),
        tone,
        provider
      });
      const received = response.messages.find((message) => message.side === "incoming");
      const reply = response.messages.find((message) => message.side === "outgoing");
      const payload = {
        receivedTranslation: received?.translatedText,
        correctedReply: reply?.correctedText,
        translatedReply: reply?.translatedText,
        partnerLanguage: response.partnerLanguage,
        partnerLanguageLabel: response.partnerLanguageLabel,
        externalApi: response.externalApi,
        latencyMs: response.latencyMs
      };
      return toolResult(
        payload,
        `**받은 메시지 번역**\n${payload.receivedTranslation}\n\n**교정된 답장**\n${payload.correctedReply}\n\n**${payload.partnerLanguageLabel}로 보낼 답장**\n${payload.translatedReply}`
      );
    }
  );

  server.registerTool(
    "translate_chat_transcript",
    {
      title: "대화 캡처 발화 번역",
      description: `${SERVICE_NAME} reconstructs and translates multiple OCR-extracted chat bubbles while preserving left-side partner and right-side user roles.`,
      inputSchema: {
        messages: z.array(transcriptMessageSchema).min(1).max(20).describe("Ordered chat bubbles extracted from a screenshot or copied transcript."),
        myLanguage: languageSchema.default("ko"),
        partnerLanguage: partnerLanguageSchema.optional(),
        tone: toneSchema.optional().default("neutral"),
        provider: providerSchema.optional().default("rules")
      },
      annotations: { title: "대화 캡처 발화 번역", ...annotations }
    },
    async ({ messages, myLanguage, partnerLanguage, tone, provider }) => {
      const response = await translateChatTranscript({
        messages,
        myLanguage: normalizeLanguage(myLanguage, "ko"),
        partnerLanguage: normalizeLanguage(partnerLanguage),
        tone,
        provider
      });
      return toolResult(response, transcriptMarkdown(response));
    }
  );

  server.registerTool(
    "correct_korean_message",
    {
      title: "한국어 메시지 맞춤법 교정",
      description: `${SERVICE_NAME} corrects Korean chat spelling, spacing, and punctuation before the user sends a message.`,
      inputSchema: {
        text: z.string().min(1).max(2000).describe("Korean chat message to correct."),
        tone: toneSchema.optional().default("neutral"),
        provider: providerSchema.optional().default("rules")
      },
      annotations: { title: "한국어 메시지 맞춤법 교정", ...annotations }
    },
    async ({ text, tone, provider }) => {
      const response = await correctChat(text, { tone, provider });
      const payload = {
        originalText: response.original,
        correctedText: response.corrected,
        changes: response.changes,
        confidence: response.confidence,
        provider: response.provider.name,
        externalApi: response.provider.externalApi
      };
      const changes = response.changes.length
        ? response.changes.map((change) => `- ${change.before} → ${change.after}: ${change.reason}`).join("\n")
        : "- 별도 수정이 필요하지 않습니다.";
      return toolResult(payload, `**교정 결과**\n${response.corrected}\n\n${changes}`);
    }
  );

  return server;
}
