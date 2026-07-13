import { correctChat } from "./correctionService.js";
import {
  getPartnerLanguage,
  isPartnerLanguage,
  LANGUAGE_LABELS,
  normalizeLanguage,
  setPartnerLanguage,
  TranslationService,
  detectLanguage,
  type LanguageCode,
  type PartnerLanguage,
  type TranslationResult
} from "./translation.js";
import type { ProviderMode, Tone } from "./types.js";

export interface BridgeTurnRequest {
  conversationId?: string;
  incomingMessage?: string;
  myDraft?: string;
  myLanguage?: LanguageCode;
  partnerLanguage?: LanguageCode;
  tone?: Tone;
  provider?: ProviderMode;
}

export interface BridgeTurnResult {
  conversationId: string;
  myLanguage: LanguageCode;
  partnerLanguage: PartnerLanguage;
  partnerLanguageLabel: string;
  detectedPartnerLanguage?: LanguageCode;
  incoming?: {
    translation: TranslationResult;
    displayedToUser: string;
  };
  outgoing?: {
    correction: Awaited<ReturnType<typeof correctChat>>;
    translation: TranslationResult;
    backTranslation: TranslationResult;
    displayedToPartner: string;
  };
  provider: string;
  externalApi: boolean;
  latencyMs: number;
}

export type ChatMessageSide = "incoming" | "outgoing";

export interface ChatTranscriptMessage {
  id?: string;
  side: ChatMessageSide;
  text: string;
}

export interface ChatTranscriptRequest {
  messages: ChatTranscriptMessage[];
  myLanguage?: LanguageCode;
  partnerLanguage?: LanguageCode;
  tone?: Tone;
  provider?: ProviderMode;
}

export interface ChatTranscriptResult {
  myLanguage: LanguageCode;
  partnerLanguage: PartnerLanguage;
  partnerLanguageLabel: string;
  detectedPartnerLanguage?: PartnerLanguage;
  messages: Array<{
    id: string;
    side: ChatMessageSide;
    originalText: string;
    correctedText?: string;
    translatedText: string;
    sourceLanguage: LanguageCode;
    targetLanguage: LanguageCode;
    provider: string;
    fallback: boolean;
  }>;
  externalApi: boolean;
  latencyMs: number;
}

const translationService = new TranslationService();

export function getTranslationService() {
  return translationService;
}

export async function translateChatTranscript(request: ChatTranscriptRequest): Promise<ChatTranscriptResult> {
  const started = Date.now();
  const myLanguage = normalizeLanguage(request.myLanguage, "ko");
  const explicitPartnerLanguage = normalizeLanguage(request.partnerLanguage);
  const detectedPartnerLanguage = request.messages
    .filter((message) => message.side === "incoming")
    .map((message) => detectLanguage(message.text).language)
    .find(isPartnerLanguage);
  const partnerLanguage = isPartnerLanguage(explicitPartnerLanguage)
    ? explicitPartnerLanguage
    : detectedPartnerLanguage ?? "en";

  const messages = await Promise.all(
    request.messages.map(async (message, index) => {
      const originalText = message.text.trim();
      if (message.side === "incoming") {
        const translation = await translationService.translate({
          text: originalText,
          sourceLanguage: "auto",
          targetLanguage: myLanguage,
          mode: "incoming"
        });
        return {
          id: message.id?.trim().slice(0, 64) || `message-${index + 1}`,
          side: message.side,
          originalText,
          translatedText: translation.translatedText,
          sourceLanguage: translation.sourceLanguage,
          targetLanguage: translation.targetLanguage,
          provider: translation.provider,
          fallback: translation.fallback,
          externalApi: translation.externalApi
        };
      }

      const correction = await correctChat(originalText, {
        tone: request.tone ?? "neutral",
        provider: request.provider
      });
      const translation = await translationService.translate({
        text: correction.corrected,
        sourceLanguage: myLanguage,
        targetLanguage: partnerLanguage,
        mode: "outgoing"
      });
      return {
        id: message.id?.trim().slice(0, 64) || `message-${index + 1}`,
        side: message.side,
        originalText,
        correctedText: correction.corrected,
        translatedText: translation.translatedText,
        sourceLanguage: translation.sourceLanguage,
        targetLanguage: translation.targetLanguage,
        provider: `${correction.provider.name} + ${translation.provider}`,
        fallback: translation.fallback,
        externalApi: translation.externalApi || correction.provider.externalApi
      };
    })
  );

  return {
    myLanguage,
    partnerLanguage,
    partnerLanguageLabel: LANGUAGE_LABELS[partnerLanguage],
    detectedPartnerLanguage,
    messages: messages.map(({ externalApi: _externalApi, ...message }) => message),
    externalApi: messages.some((message) => message.externalApi),
    latencyMs: Date.now() - started
  };
}

export async function bridgeChatTurn(request: BridgeTurnRequest): Promise<BridgeTurnResult> {
  const started = Date.now();
  const conversationId = normalizeConversationId(request.conversationId);
  const myLanguage = normalizeLanguage(request.myLanguage, "ko");
  const remembered = getPartnerLanguage(conversationId);
  const explicit = normalizeLanguage(request.partnerLanguage);
  let partnerLanguage = isPartnerLanguage(explicit) ? explicit : remembered.partnerLanguage;
  let detectedPartnerLanguage: LanguageCode | undefined;
  let incoming: BridgeTurnResult["incoming"];
  let outgoing: BridgeTurnResult["outgoing"];
  const providers: string[] = [];

  if (request.incomingMessage?.trim()) {
    const translation = await translationService.translate({
      text: request.incomingMessage,
      sourceLanguage: "auto",
      targetLanguage: myLanguage,
      mode: "incoming"
    });
    if (isPartnerLanguage(translation.sourceLanguage)) {
      partnerLanguage = translation.sourceLanguage;
      detectedPartnerLanguage = translation.sourceLanguage;
      setPartnerLanguage(conversationId, partnerLanguage);
    }
    incoming = { translation, displayedToUser: translation.translatedText };
    providers.push(translation.provider);
  }

  if (request.myDraft?.trim()) {
    const correction = await correctChat(request.myDraft, {
      tone: request.tone ?? "neutral",
      provider: request.provider
    });
    const translation = await translationService.translate({
      text: correction.corrected,
      sourceLanguage: myLanguage,
      targetLanguage: partnerLanguage,
      mode: "outgoing"
    });
    const backTranslation = await translationService.translate({
      text: translation.translatedText,
      sourceLanguage: partnerLanguage,
      targetLanguage: myLanguage,
      mode: "incoming"
    });
    outgoing = {
      correction,
      translation,
      backTranslation,
      displayedToPartner: translation.translatedText
    };
    providers.push(correction.provider.name, translation.provider);
  }

  return {
    conversationId,
    myLanguage,
    partnerLanguage,
    partnerLanguageLabel: LANGUAGE_LABELS[partnerLanguage],
    detectedPartnerLanguage,
    incoming,
    outgoing,
    provider: [...new Set(providers)].join(" + ") || "local",
    externalApi: Boolean(outgoing?.translation.externalApi || incoming?.translation.externalApi),
    latencyMs: Date.now() - started
  };
}

export async function translatePartnerMessage(
  text: string,
  options: { conversationId?: string; myLanguage?: LanguageCode; sourceLanguage?: LanguageCode } = {}
) {
  const conversationId = normalizeConversationId(options.conversationId);
  const result = await translationService.translate({
    text,
    sourceLanguage: normalizeLanguage(options.sourceLanguage),
    targetLanguage: normalizeLanguage(options.myLanguage, "ko"),
    mode: "incoming"
  });
  if (isPartnerLanguage(result.sourceLanguage)) setPartnerLanguage(conversationId, result.sourceLanguage);
  return { conversationId, result };
}

export async function translateMyMessage(
  text: string,
  options: { conversationId?: string; myLanguage?: LanguageCode; partnerLanguage?: LanguageCode; tone?: Tone; provider?: ProviderMode } = {}
) {
  const conversationId = normalizeConversationId(options.conversationId);
  const remembered = getPartnerLanguage(conversationId);
  const partnerLanguage = isPartnerLanguage(normalizeLanguage(options.partnerLanguage))
    ? (normalizeLanguage(options.partnerLanguage) as PartnerLanguage)
    : remembered.partnerLanguage;
  const correction = await correctChat(text, { tone: options.tone, provider: options.provider });
  const result = await translationService.translate({
    text: correction.corrected,
    sourceLanguage: normalizeLanguage(options.myLanguage, "ko"),
    targetLanguage: partnerLanguage,
    mode: "outgoing"
  });
  return { conversationId, partnerLanguage, partnerLanguageLabel: LANGUAGE_LABELS[partnerLanguage], correction, result };
}

export function partnerLanguageState(conversationId: string, requested?: LanguageCode) {
  if (isPartnerLanguage(normalizeLanguage(requested))) {
    return setPartnerLanguage(normalizeConversationId(conversationId), normalizeLanguage(requested) as PartnerLanguage);
  }
  return getPartnerLanguage(normalizeConversationId(conversationId));
}

function normalizeConversationId(value?: string) {
  return String(value ?? "default").trim().slice(0, 64) || "default";
}
