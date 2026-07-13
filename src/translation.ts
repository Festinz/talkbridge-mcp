import { franc } from "franc-min";
import {
  CORE_PARTNER_LANGUAGES,
  francCodeToLanguage,
  isPartnerLanguage,
  languageLabel,
  normalizeLanguageCode,
  supportedLanguageCodes,
  type LanguageCode,
  type PartnerLanguage
} from "./languageCatalog.js";
import {
  argosCanTranslate,
  argosTranslationEnabled,
  translateWithArgos
} from "./providers/argosTranslationProvider.js";
import {
  nllbCanTranslate,
  nllbTranslationEnabled,
  translateWithNllb
} from "./providers/nllbTranslationProvider.js";

export { isPartnerLanguage, LANGUAGE_LABELS, languageLabel, supportedLanguageCodes } from "./languageCatalog.js";
export type { LanguageCode, PartnerLanguage } from "./languageCatalog.js";

export type TranslationMode = "incoming" | "outgoing" | "live";
export type TranslationProvider = "fixture" | "local" | "argos-local" | "nllb-local" | "libretranslate" | "fallback";

export const PARTNER_LANGUAGES = CORE_PARTNER_LANGUAGES;

export interface TranslationRequest {
  text: string;
  sourceLanguage?: LanguageCode;
  targetLanguage: LanguageCode;
  mode: TranslationMode;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceLabel: string;
  targetLabel: string;
  provider: TranslationProvider;
  externalApi: boolean;
  selfHosted: boolean;
  confidence: number;
  cached: boolean;
  fallback: boolean;
  latencyMs: number;
}

interface ProviderResult {
  translatedText: string;
  provider: TranslationProvider;
  externalApi: boolean;
  selfHosted: boolean;
  confidence: number;
}

export interface TranslationServiceOptions {
  libreTranslateUrl?: string;
  maxCacheEntries?: number;
  libreTranslateTimeoutMs?: number;
}

const FIXTURES = new Map<string, string>([
  [key("明日、何時に会える？", "ja", "ko"), "내일 몇 시에 만날 수 있어?"],
  [key("明日何時に会える？", "ja", "ko"), "내일 몇 시에 만날 수 있어?"],
  [key("駅前で会おう", "ja", "ko"), "역 앞에서 보자"],
  [key("こんにちは", "ja", "ko"), "안녕하세요"],
  [key("ありがとう", "ja", "ko"), "고마워"],
  [key("お元気ですか？", "ja", "ko"), "잘 지내세요?"],
  [key("こんにちは。お元気でしたか？", "ja", "ko"), "안녕하세요. 잘 지내셨나요?"],
  [key("19時はどう？", "ja", "ko"), "저녁 7시에 어때?"],
  [key("저녁 7시에 어때?", "ko", "ja"), "19時はどう？"],
  [key("역 앞에서 보자", "ko", "ja"), "駅前で会おう"],
  [key("안녕하세요. 잘 지내셨나요?", "ko", "ja"), "こんにちは。お元気でしたか？"],
  [key("안녕하세요 잘 지내셨나요?", "ko", "ja"), "こんにちは。お元気でしたか？"],
  [key("나는 신창준이야", "ko", "ja"), "私はシン・チャンジュンです。"],
  [key("오랜만이야. 잘 지냈어?", "ko", "ja"), "久しぶり。元気だった？"],
  [key("hello, what time can we meet tomorrow?", "en", "ko"), "안녕, 내일 몇 시에 만날 수 있어?"],
  [key("where should we meet?", "en", "ko"), "어디서 만날까?"],
  [key("Let's meet in front of the station.", "en", "ko"), "역 앞에서 만나자."],
  [key("역 앞에서 보자", "ko", "en"), "Let's meet in front of the station."],
  [key("내일 저녁에 보자", "ko", "en"), "Let's meet tomorrow evening."],
  [key("내일 몇 시에 만날까?", "ko", "en"), "What time shall we meet tomorrow?"],
  [key("안녕하세요. 잘 지내셨나요?", "ko", "en"), "Hello. How have you been?"],
  [key("Hello. How have you been?", "en", "ko"), "안녕하세요. 잘 지내셨나요?"],
  [key("明天几点见？", "zh", "ko"), "내일 몇 시에 만날까?"],
  [key("내일 몇 시에 만날까?", "ko", "zh"), "明天几点见？"],
  [key("¿a qué hora nos vemos mañana?", "es", "ko"), "내일 몇 시에 만날까?"],
  [key("내일 몇 시에 볼까?", "ko", "es"), "¿A qué hora nos vemos mañana?"],
  [key("Nos vemos frente a la estación.", "es", "ko"), "역 앞에서 만나자."]
]);

const LANGUAGE_HINTS: Array<{ language: LanguageCode; pattern: RegExp }> = [
  { language: "es", pattern: /\b(hola|gracias|mañana|dónde|cuando|qué|cómo|amigo|años|soy|nos vemos)\b|[ñ¿¡]/iu },
  { language: "fr", pattern: /\b(bonjour|merci|demain|pourquoi|comment|avec|vous|je suis|rendez-vous)\b|[çœ]/iu },
  { language: "de", pattern: /\b(hallo|danke|morgen|warum|wie|ich bin|bitte|treffen|tschüss)\b|[äöüß]/iu },
  { language: "pt", pattern: /\b(olá|obrigad[oa]|amanhã|você|encontro|como|porque)\b|[ãõ]/iu },
  { language: "it", pattern: /\b(ciao|grazie|domani|perché|come|sono|incontro|arrivederci)\b/iu },
  { language: "vi", pattern: /\b(tôi|bạn|chúng|sẽ|đến|sau|phút|cảm ơn|ngày mai)\b|[ăâđêôơư]/iu },
  { language: "uk", pattern: /(привіт|дякую|зустрінемося|після|будь ласка)|[іїєґ]/iu },
  { language: "ru", pattern: /(привет|спасибо|завтра|буду|встреча|после|пожалуйста|немного|позже)/iu },
  { language: "en", pattern: /\b(hello|hi|thanks|tomorrow|where|when|what|how|friend|see you|let's|i am)\b/iu }
];

const ENGLISH_FUNCTION_WORDS = new Set([
  "i", "you", "your", "we", "our", "they", "their",
  "the", "this", "that", "these", "those",
  "is", "are", "have", "has", "can", "could", "would", "should", "will",
  "please", "send", "meet", "with", "from", "about", "after", "before"
]);

export function normalizeLanguage(value: unknown, fallback: LanguageCode = "auto"): LanguageCode {
  return normalizeLanguageCode(value, fallback);
}

export function detectLanguage(text: string): { language: LanguageCode; confidence: number } {
  const normalized = text.trim();
  if (!normalized) return { language: "unknown", confidence: 0 };
  if (/[가-힣]/u.test(normalized)) return { language: "ko", confidence: 0.99 };
  if (/[ぁ-ゖァ-ヺ]/u.test(normalized)) return { language: "ja", confidence: 0.95 };
  if (/[一-鿿]/u.test(normalized)) return { language: "zh", confidence: 0.72 };
  for (const hint of LANGUAGE_HINTS) {
    if (hint.pattern.test(normalized)) return { language: hint.language, confidence: 0.92 };
  }

  if (/^[\x00-\x7F]+$/.test(normalized) && englishFunctionWordScore(normalized) >= 2) {
    return { language: "en", confidence: 0.9 };
  }

  const francCode = franc(normalized, { minLength: 3 });
  const detected = francCodeToLanguage(francCode);
  if (detected !== "unknown") {
    return { language: detected, confidence: normalized.length >= 20 ? 0.84 : 0.66 };
  }
  if (/^[\x00-\x7F]+$/.test(normalized) && /[a-z]/i.test(normalized)) {
    return { language: "en", confidence: 0.55 };
  }
  return { language: "unknown", confidence: 0.2 };
}

function englishFunctionWordScore(text: string) {
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  return words.reduce((score, word) => score + (ENGLISH_FUNCTION_WORDS.has(word) ? 1 : 0), 0);
}

export class TranslationService {
  private readonly cache = new Map<string, TranslationResult>();
  private readonly maxCacheEntries: number;
  private readonly libreTranslateUrl?: string;
  private readonly libreTranslateTimeoutMs: number;

  constructor(options: TranslationServiceOptions = {}) {
    this.maxCacheEntries = options.maxCacheEntries ?? 300;
    this.libreTranslateUrl = options.libreTranslateUrl ?? process.env.CHATPOLISH_LIBRETRANSLATE_URL;
    this.libreTranslateTimeoutMs = options.libreTranslateTimeoutMs ?? Number(process.env.CHATPOLISH_LIBRETRANSLATE_TIMEOUT_MS ?? 2200);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const started = Date.now();
    const text = request.text.trim().replace(/\s+/g, " ");
    const detected = detectLanguage(text);
    const sourceLanguage = request.sourceLanguage && request.sourceLanguage !== "auto"
      ? normalizeLanguage(request.sourceLanguage, detected.language)
      : detected.language;
    const targetLanguage = normalizeLanguage(request.targetLanguage, "ko");
    const cacheKey = `${request.mode}:${sourceLanguage}:${targetLanguage}:${text.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true, latencyMs: Date.now() - started };

    let providerResult: ProviderResult | null = null;
    if (sourceLanguage !== "unknown" && targetLanguage !== "unknown" && sourceLanguage !== targetLanguage) {
      providerResult = fixtureTranslation(text, sourceLanguage, targetLanguage);
      if (!providerResult) providerResult = localTranslation(text, sourceLanguage, targetLanguage);
      if (!providerResult && nllbTranslationEnabled() && nllbCanTranslate(sourceLanguage, targetLanguage)) {
        providerResult = await nllbTranslation(text, sourceLanguage, targetLanguage);
      }
      if (!providerResult && argosTranslationEnabled() && argosCanTranslate(sourceLanguage, targetLanguage)) {
        providerResult = await argosTranslation(text, sourceLanguage, targetLanguage);
      }
      if (!providerResult) {
        providerResult = await libreTranslate(
          text,
          sourceLanguage,
          targetLanguage,
          this.libreTranslateUrl,
          this.libreTranslateTimeoutMs
        );
      }
    }

    const finalProvider = providerResult ?? {
      translatedText: text,
      provider: "fallback" as const,
      externalApi: false,
      selfHosted: true,
      confidence: sourceLanguage === targetLanguage ? 0.99 : 0.2
    };
    const result: TranslationResult = {
      originalText: text,
      translatedText: finalProvider.translatedText,
      sourceLanguage,
      targetLanguage,
      sourceLabel: languageLabel(sourceLanguage),
      targetLabel: languageLabel(targetLanguage),
      provider: finalProvider.provider,
      externalApi: finalProvider.externalApi,
      selfHosted: finalProvider.selfHosted,
      confidence: finalProvider.confidence,
      cached: false,
      fallback: finalProvider.provider === "fallback",
      latencyMs: Date.now() - started
    };
    if (!result.fallback) {
      this.cache.set(cacheKey, result);
      while (this.cache.size > this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
        else break;
      }
    }
    return result;
  }

  status() {
    return {
      configured: argosTranslationEnabled() || nllbTranslationEnabled() || Boolean(this.libreTranslateUrl),
      argosEnabled: argosTranslationEnabled(),
      nllbEnabled: nllbTranslationEnabled(),
      supportedLanguages: nllbTranslationEnabled() ? supportedLanguageCodes().length : 5,
      mode: argosTranslationEnabled() && nllbTranslationEnabled()
        ? "hybrid-local"
        : nllbTranslationEnabled()
          ? "nllb-local"
          : argosTranslationEnabled()
            ? "argos-local"
            : this.libreTranslateUrl
              ? "libretranslate"
              : "local-fallback",
      selfHosted: argosTranslationEnabled() || nllbTranslationEnabled()
        ? true
        : this.libreTranslateUrl
          ? isSelfHostedEndpoint(this.libreTranslateUrl)
          : true,
      timeoutMs: this.libreTranslateTimeoutMs
    } as const;
  }

  async readiness() {
    const started = Date.now();
    if (argosTranslationEnabled() || nllbTranslationEnabled()) {
      return {
        ready: true,
        mode: argosTranslationEnabled() && nllbTranslationEnabled()
          ? "hybrid-local" as const
          : nllbTranslationEnabled()
            ? "nllb-local" as const
            : "argos-local" as const,
        latencyMs: 0
      };
    }

    if (!this.libreTranslateUrl) {
      return { ready: true, mode: "local-fallback" as const, latencyMs: 0 };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.libreTranslateTimeoutMs);
    try {
      const response = await fetch(new URL("/languages", this.libreTranslateUrl), {
        signal: controller.signal
      });
      return {
        ready: response.ok,
        mode: "libretranslate" as const,
        latencyMs: Date.now() - started
      };
    } catch {
      return {
        ready: false,
        mode: "libretranslate" as const,
        latencyMs: Date.now() - started
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function argosTranslation(
  text: string,
  source: LanguageCode,
  target: LanguageCode
): Promise<ProviderResult | null> {
  try {
    const result = await translateWithArgos(text, source, target);
    if (!isUsefulTranslation(text, result.translatedText)) return null;
    return {
      translatedText: result.translatedText,
      provider: "argos-local",
      externalApi: false,
      selfHosted: true,
      confidence: 0.86
    };
  } catch {
    return null;
  }
}

async function nllbTranslation(
  text: string,
  source: LanguageCode,
  target: LanguageCode
): Promise<ProviderResult | null> {
  try {
    const result = await translateWithNllb(text, source, target);
    if (!isUsefulTranslation(text, result.translatedText)) return null;
    return {
      translatedText: result.translatedText,
      provider: "nllb-local",
      externalApi: false,
      selfHosted: true,
      confidence: 0.84
    };
  } catch {
    return null;
  }
}

function isUsefulTranslation(original: string, translated: string) {
  const normalizedOriginal = original.normalize("NFKC").trim().toLowerCase();
  const normalizedTranslated = translated.normalize("NFKC").trim().toLowerCase();
  if (!normalizedTranslated) return false;
  if (normalizedOriginal !== normalizedTranslated) return true;
  return !/[\p{L}\p{N}]/u.test(normalizedOriginal);
}

function key(text: string, source: LanguageCode, target: LanguageCode) {
  return `${source}:${target}:${normalizeTranslationText(text)}`;
}

function normalizeTranslationText(text: string) {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d)\s+(시|분|초|개|명|번)/g, "$1$2")
    .replace(/(시|분|초)\s+(에|쯤|까지|부터)/g, "$1$2")
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "")
    .replace(/([、。！？?!,.])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "$1")
    .replace(/\s+([、?!,.。！？])/g, "$1");
}

function fixtureTranslation(text: string, source: LanguageCode, target: LanguageCode): ProviderResult | null {
  const translatedText = FIXTURES.get(key(text, source, target)) ?? FIXTURES.get(key(stripEnding(text), source, target));
  return translatedText
    ? { translatedText, provider: "fixture", externalApi: false, selfHosted: true, confidence: 0.98 }
    : null;
}

function localTranslation(text: string, source: LanguageCode, target: LanguageCode): ProviderResult | null {
  const phrase = stripEnding(text);
  if (source === "ja" && target === "ko") {
    if (/^こんにちは$/u.test(phrase)) return local("안녕하세요", 0.83);
    if (/^(ありがとう|ありがとうございます)$/u.test(phrase)) return local("고마워", 0.83);
    if (/^お元気ですか$/u.test(phrase)) return local("잘 지내세요?", 0.8);
  }
  if (source === "en" && target === "ko") {
    if (/^(hi|hello)$/i.test(phrase)) return local("안녕하세요", 0.83);
    if (/^(thank you|thanks)$/i.test(phrase)) return local("고마워요", 0.83);
  }
  if (source === "zh" && target === "ko" && /^(你好|您好)$/u.test(phrase)) return local("안녕하세요", 0.83);
  if (source === "es" && target === "ko" && /^hola$/i.test(phrase)) return local("안녕하세요", 0.83);
  return null;
}

function local(translatedText: string, confidence: number): ProviderResult {
  return { translatedText, provider: "local", externalApi: false, selfHosted: true, confidence };
}

async function libreTranslate(
  text: string,
  source: LanguageCode,
  target: LanguageCode,
  baseUrl?: string,
  timeoutMs = 2200
): Promise<ProviderResult | null> {
  if (!baseUrl || source === "unknown" || target === "auto" || target === "unknown") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/translate", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, source, target, format: "text" }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { translatedText?: string };
    return payload.translatedText
      ? {
          translatedText: payload.translatedText,
          provider: "libretranslate",
          externalApi: !isSelfHostedEndpoint(baseUrl),
          selfHosted: isSelfHostedEndpoint(baseUrl),
          confidence: 0.82
        }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripEnding(value: string) {
  return value.trim().replace(/[.!?。！？]+$/u, "");
}

function isSelfHostedEndpoint(baseUrl: string) {
  if (process.env.CHATPOLISH_LIBRETRANSLATE_EXTERNAL_API === "1") return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "[::1]", "libretranslate"].includes(hostname) || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

const partnerMemory = new Map<string, PartnerLanguage>();

export function setPartnerLanguage(conversationId: string, language: PartnerLanguage) {
  const id = conversationId.trim().slice(0, 64) || "default";
  partnerMemory.set(id, language);
  return { conversationId: id, partnerLanguage: language, partnerLanguageLabel: languageLabel(language) };
}

export function getPartnerLanguage(conversationId: string, fallback: PartnerLanguage = "ja") {
  const id = conversationId.trim().slice(0, 64) || "default";
  const partnerLanguage = partnerMemory.get(id) ?? fallback;
  return { conversationId: id, partnerLanguage, partnerLanguageLabel: languageLabel(partnerLanguage) };
}
