import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { correctChat } from "./correctionService.js";
import {
  detectLanguage,
  getPartnerLanguage,
  isPartnerLanguage,
  LANGUAGE_LABELS,
  normalizeLanguage,
  setPartnerLanguage,
  type LanguageCode,
  type PartnerLanguage,
  TranslationService,
  type TranslationResult
} from "./translation.js";
import type { ProviderMode, Tone } from "./types.js";

export type ImageMessageSide = "incoming" | "outgoing" | "unknown";

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { left: number; top: number; width: number; height: number };
}

export interface OcrMessageGroup {
  text: string;
  segments: string[];
  confidence: number;
  side: ImageMessageSide;
  bbox: { left: number; top: number; width: number; height: number };
}

export interface ImageBridgeMessage {
  id: string;
  side: ImageMessageSide;
  originalText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceLabel: string;
  targetLabel: string;
  confidence: number;
  bbox: OcrMessageGroup["bbox"];
  provider: string;
  cached: boolean;
  fallback: boolean;
  correction?: Awaited<ReturnType<typeof correctChat>>;
}

export interface ImageBridgeResult {
  conversationId: string;
  myLanguage: LanguageCode;
  partnerLanguage: PartnerLanguage;
  partnerLanguageLabel: string;
  ocrProvider: "tesseract-local";
  ocrLanguages: string[];
  ocrConfidence: number;
  imageBytes: number;
  detectedMessages: number;
  messages: ImageBridgeMessage[];
  externalApi: false;
  selfHosted: true;
  latencyMs: number;
}

interface ImageBridgeOptions {
  conversationId?: string;
  myLanguage?: LanguageCode;
  partnerLanguage?: LanguageCode;
  tone?: Tone;
  provider?: ProviderMode;
}

interface OcrWorkerOptions {
  langs: string[];
  langPath?: string;
  cachePath?: string;
  timeoutMs: number;
}

const DEFAULT_OCR_LANGS = ["eng", "kor", "jpn", "chi_sim", "spa"];
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const translationService = new TranslationService();
let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | undefined;

export function imageBridgeConfig() {
  return {
    languages: readOcrLanguages(),
    maxImageBytes: readPositiveInt(process.env.CHATPOLISH_OCR_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
    timeoutMs: readPositiveInt(process.env.CHATPOLISH_OCR_TIMEOUT_MS, 120_000),
    langPath: process.env.CHATPOLISH_OCR_LANG_PATH?.trim() || undefined,
    cachePath: process.env.CHATPOLISH_OCR_CACHE_PATH?.trim() || undefined
  };
}

export async function translateConversationImage(
  image: Buffer,
  options: ImageBridgeOptions = {}
): Promise<ImageBridgeResult> {
  const started = Date.now();
  const config = imageBridgeConfig();
  const ocrLanguages = selectOcrLanguages(options.partnerLanguage, config.languages);
  const ocrConfig = { ...config, languages: ocrLanguages };
  if (image.byteLength > config.maxImageBytes) {
    throw new Error(`image_too_large:${config.maxImageBytes}`);
  }

  const lines = await recognizeImage(image, ocrConfig);
  const allGroups = groupOcrLines(lines);
  const contentBottom = Math.max(1, ...allGroups.map((group) => group.bbox.top + group.bbox.height));
  const explicitComposerBoundary = lines
    .filter((line) => isComposerBoundary(line.text))
    .map((line) => line.bbox.top)
    .sort((a, b) => a - b)[0];
  const inferredComposerBoundary = lines.some((line) => isTranslationFooter(line.text))
    ? findLargeBottomGap(allGroups, contentBottom)
    : undefined;
  const composerBoundary = [explicitComposerBoundary, inferredComposerBoundary]
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)[0];
  const contentGroups = allGroups.filter(
    (group) => group.bbox.top >= contentBottom * 0.08 && (composerBoundary === undefined || group.bbox.top < composerBoundary)
  );
  const groups = contentGroups.filter((group, index) => {
    const nextIncoming = contentGroups.find((candidate, candidateIndex) =>
      candidateIndex > index
      && (candidate.side === "incoming" || candidate.side === "unknown")
      && candidate.bbox.top - (group.bbox.top + group.bbox.height) <= 90
    );
    return !isLikelySenderLabel(group, nextIncoming);
  });
  const conversationId = normalizeConversationId(options.conversationId);
  const myLanguage = normalizeLanguage(options.myLanguage, "ko");
  const remembered = getPartnerLanguage(conversationId);
  const explicitPartner = normalizeLanguage(options.partnerLanguage);
  let partnerLanguage: PartnerLanguage = isPartnerLanguage(explicitPartner)
    ? explicitPartner
    : remembered.partnerLanguage;
  let partnerLanguageLocked = isPartnerLanguage(explicitPartner);

  for (const group of groups) {
    const detectedText = selectOcrText(group.segments, group.side, myLanguage, partnerLanguage);
    const detectedResult = detectLanguage(detectedText);
    if (group.side === "incoming" && group.confidence >= 65 && isReliablePartnerCandidate(detectedText, detectedResult.language)) {
      partnerLanguage = detectedResult.language;
      setPartnerLanguage(conversationId, partnerLanguage);
      partnerLanguageLocked = true;
      break;
    }
  }

  const messages: ImageBridgeMessage[] = [];
  for (const [index, group] of groups.entries()) {
    const detectedText = selectOcrText(group.segments, group.side, myLanguage, partnerLanguage);
    const detected = detectLanguage(detectedText).language;
    const side = resolveSide(group.side, detected, myLanguage);
    const sourceText = selectOcrText(group.segments, side, myLanguage, partnerLanguage);
    if (!isLikelyMessageText(sourceText)) continue;
    if (
      side === "incoming"
      && partnerLanguageLocked
      && detected !== partnerLanguage
      && detected !== myLanguage
      && messageTextScore(sourceText) < 8
    ) continue;
    if (side === "incoming") {
      const translation = await translationService.translate({
        text: sourceText,
        sourceLanguage: "auto",
        targetLanguage: myLanguage,
        mode: "incoming"
      });
      if (!partnerLanguageLocked && isReliablePartnerCandidate(sourceText, translation.sourceLanguage)) {
        partnerLanguage = translation.sourceLanguage;
        setPartnerLanguage(conversationId, partnerLanguage);
        partnerLanguageLocked = true;
      }
      messages.push(toImageMessage(index, side, { ...group, text: sourceText }, translation));
      continue;
    }

    if (side === "outgoing") {
      const correction = await correctChat(normalizeKoreanOcrSpacing(sourceText), {
        tone: options.tone ?? "neutral",
        provider: options.provider
      });
      const translation = await translationService.translate({
        text: correction.corrected,
        sourceLanguage: myLanguage,
        targetLanguage: partnerLanguage,
        mode: "outgoing"
      });
      messages.push(toImageMessage(index, side, { ...group, text: sourceText }, translation, correction));
      continue;
    }

    const translation = await translationService.translate({
      text: sourceText,
      sourceLanguage: detected,
      targetLanguage: myLanguage,
      mode: "incoming"
    });
    messages.push(toImageMessage(index, side, { ...group, text: sourceText }, translation));
  }

  return {
    conversationId,
    myLanguage,
    partnerLanguage,
    partnerLanguageLabel: LANGUAGE_LABELS[partnerLanguage],
    ocrProvider: "tesseract-local",
    ocrLanguages,
    ocrConfidence: average(groups.map((group) => group.confidence)),
    imageBytes: image.byteLength,
    detectedMessages: messages.length,
    messages,
    externalApi: false,
    selfHosted: true,
    latencyMs: Date.now() - started
  };
}

export function groupOcrLines(lines: OcrLine[]): OcrMessageGroup[] {
  const normalizedLines = lines
    .map((line) => ({ ...line, text: normalizeOcrText(line.text) }))
    .filter(
      (line) =>
        line.text.length > 0 &&
        line.bbox.width > 0 &&
        line.bbox.height > 0 &&
        !isOcrMetadata(line.text) &&
        !(line.bbox.top < 60 && Array.from(line.text).length < 12)
    );
  const medianHeight = median(normalizedLines.map((line) => line.bbox.height));
  const usable = normalizedLines.filter((line) => line.bbox.height >= Math.max(6, medianHeight * 0.45));
  if (usable.length === 0) return [];

  const minLeft = Math.min(...usable.map((line) => line.bbox.left));
  const maxRight = Math.max(...usable.map((line) => line.bbox.left + line.bbox.width));
  const contentWidth = maxRight - minLeft;
  const center = minLeft + contentWidth / 2;
  const spread = Math.max(contentWidth * 0.1, 30);
  const positioned = usable
    .map((line) => ({ ...line, side: sideFromBbox(line.bbox, center, spread) }))
    .sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);

  const groups: OcrMessageGroup[] = [];
  const lastLineBottoms: number[] = [];
  const lastLineHeights: number[] = [];
  for (const line of positioned) {
    const previous = groups.at(-1);
    const previousBottom = previous ? lastLineBottoms.at(-1) ?? previous.bbox.top + previous.bbox.height : 0;
    const previousHeight = lastLineHeights.at(-1) ?? line.bbox.height;
    const previousTop = previousBottom - previousHeight;
    const gap = line.bbox.top - previousBottom;
    const sameSide = previous && (previous.side === line.side || previous.side === "unknown" || line.side === "unknown");
    const closeEnough = previous && gap <= Math.max(line.bbox.height, previousHeight) * 2.2;
    const aligned = previous && Math.abs(previous.bbox.left - line.bbox.left) <= Math.max(44, maxRight * 0.12);
    const sameRow = previous && Math.abs(line.bbox.top - previousTop) <= Math.max(line.bbox.height, previousHeight) * 0.65;
    const horizontalGap = previous ? line.bbox.left - (previous.bbox.left + previous.bbox.width) : Number.POSITIVE_INFINITY;
    const adjacentFragment = sameRow && horizontalGap >= -20 && horizontalGap <= Math.max(60, contentWidth * 0.1);
    if (previous && ((sameSide && closeEnough && aligned) || adjacentFragment)) {
      previous.text = `${previous.text} ${line.text}`.trim();
      previous.segments.push(line.text);
      previous.confidence = average([previous.confidence, line.confidence]);
      previous.bbox = mergeBboxes(previous.bbox, line.bbox);
      previous.side = sideFromBbox(previous.bbox, center, spread);
      lastLineBottoms[lastLineBottoms.length - 1] = line.bbox.top + line.bbox.height;
      lastLineHeights[lastLineHeights.length - 1] = line.bbox.height;
      continue;
    }
    groups.push({
      text: line.text,
      segments: [line.text],
      confidence: line.confidence,
      side: line.side,
      bbox: { ...line.bbox }
    });
    lastLineBottoms.push(line.bbox.top + line.bbox.height);
    lastLineHeights.push(line.bbox.height);
  }

  return groups;
}

async function recognizeImage(image: Buffer, config: ReturnType<typeof imageBridgeConfig>) {
  console.info("ocr_stage", { stage: "worker_start", imageBytes: image.byteLength, languages: config.languages });
  const normalizedImage = await sharp(image)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 })
    .png()
    .toBuffer();
  const worker = await getWorker({
    langs: config.languages,
    langPath: config.langPath,
    cachePath: config.cachePath,
    timeoutMs: config.timeoutMs
  });
  console.info("ocr_stage", { stage: "worker_ready" });
  const recognition = worker.recognize(normalizedImage, { rotateAuto: true }, { blocks: true });
  const result = await withTimeout(recognition, config.timeoutMs, "ocr_timeout");
  console.info("ocr_stage", { stage: "recognition_complete" });
  const lines: OcrLine[] = [];
  for (const block of result.data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text,
          confidence: line.confidence,
          bbox: {
            left: line.bbox.x0,
            top: line.bbox.y0,
            width: line.bbox.x1 - line.bbox.x0,
            height: line.bbox.y1 - line.bbox.y0
          }
        });
      }
    }
  }
  console.info("ocr_stage", { stage: "lines_extracted", lines: lines.length });
  return lines;
}

async function getWorker(options: OcrWorkerOptions) {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (options.cachePath) {
        await mkdir(options.cachePath, { recursive: true });
      }
      const worker = await createWorker(options.langs, 1, {
        langPath: options.langPath,
        cachePath: options.cachePath,
        logger: () => undefined
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return worker;
    })();
  }
  try {
    return await withTimeout(workerPromise, options.timeoutMs, "ocr_worker_timeout");
  } catch (error) {
    workerPromise = undefined;
    throw error;
  }
}

function toImageMessage(
  index: number,
  side: ImageMessageSide,
  group: OcrMessageGroup,
  translation: TranslationResult,
  correction?: Awaited<ReturnType<typeof correctChat>>
): ImageBridgeMessage {
  return {
    id: `image-message-${index + 1}`,
    side,
    originalText: correction?.original ?? translation.originalText,
    translatedText: correction ? translation.translatedText : translation.translatedText,
    sourceLanguage: translation.sourceLanguage,
    targetLanguage: translation.targetLanguage,
    sourceLabel: translation.sourceLabel,
    targetLabel: translation.targetLabel,
    confidence: Math.min(translation.confidence, group.confidence / 100 || translation.confidence),
    bbox: group.bbox,
    provider: translation.provider,
    cached: translation.cached,
    fallback: translation.fallback,
    correction
  };
}

function resolveSide(side: ImageMessageSide, detected: LanguageCode, myLanguage: LanguageCode): ImageMessageSide {
  if (side !== "unknown") return side;
  if (detected === myLanguage || (myLanguage === "ko" && detected === "ko")) return "outgoing";
  return "incoming";
}

function sideFromBbox(bbox: OcrLine["bbox"], center: number, spread: number): ImageMessageSide {
  const messageCenter = bbox.left + bbox.width / 2;
  if (bbox.left < center - spread) return "incoming";
  if (bbox.left > center + spread * 0.4) return "outgoing";
  if (messageCenter < center - spread * 0.5) return "incoming";
  if (messageCenter > center + spread * 0.5) return "outgoing";
  return "unknown";
}

function mergeBboxes(a: OcrMessageGroup["bbox"], b: OcrLine["bbox"]): OcrMessageGroup["bbox"] {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

function normalizeOcrText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeKoreanOcrSpacing(text: string) {
  return text
    .replace(/(\d)\s+(시|분|초|개|명|번)/g, "$1$2")
    .replace(/(시|분|초)\s+(에|쯤|까지|부터)/g, "$1$2");
}

function isOcrMetadata(text: string) {
  const compact = text.replace(/\s+/g, "");
  return /TalkBridge|AI채팅|번역채팅|상대언어|내언어|자동감지|번역미리보기|번역켜짐|번역끄기|ZA번짐|번역됨|상대에게.*전송|\d{1,2}:\d{2}|^오늘\d|^\d{2,4}$/iu.test(compact);
}

function isComposerBoundary(text: string) {
  return /번역\s*미리보기/u.test(text);
}

function isTranslationFooter(text: string) {
  const compact = text.replace(/\s+/g, "");
  return /번역켜짐|번역끄기|ZA번짐/iu.test(compact);
}

function findLargeBottomGap(groups: OcrMessageGroup[], contentBottom: number) {
  let boundary: number | undefined;
  let largestGap = 0;
  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1];
    const current = groups[index];
    const gap = current.bbox.top - (previous.bbox.top + previous.bbox.height);
    if (current.bbox.top > contentBottom * 0.55 && gap > contentBottom * 0.12 && gap > largestGap) {
      largestGap = gap;
      boundary = current.bbox.top;
    }
  }
  return boundary;
}

function selectOcrText(
  segments: string[],
  side: ImageMessageSide,
  myLanguage: LanguageCode,
  partnerLanguage: PartnerLanguage
) {
  const detectedSegments = segments
    .filter((text) => !isOcrMetadata(text))
    .map((text) => ({ text, language: detectLanguage(text).language }))
    .sort((a, b) => messageTextScore(b.text) - messageTextScore(a.text));
  if (side === "incoming") {
    const partnerText = detectedSegments.find((segment) => isPartnerLanguage(segment.language));
    if (partnerText) return partnerText.text;
  }
  if (side === "outgoing") {
    const myText = detectedSegments.find((segment) => segment.language === myLanguage);
    if (myText) return myText.text;
  }
  if (side === "unknown") {
    const firstDetected = detectedSegments.find((segment) => segment.language !== "unknown");
    if (firstDetected) return firstDetected.text;
  }
  const preferred = detectedSegments.find((segment) => segment.language === myLanguage)
    ?? detectedSegments.find((segment) => segment.language === partnerLanguage);
  return preferred?.text ?? segments.join(" ");
}

function isLikelyMessageText(text: string) {
  if (isOcrMetadata(text)) return false;
  const letters = Array.from(text).filter((character) => /\p{L}|\p{N}/u.test(character));
  return letters.length >= 2 && messageTextScore(text) >= 2;
}

function messageTextScore(text: string) {
  return Array.from(text).reduce((score, character) => score + (/\p{L}|\p{N}/u.test(character) ? 1 : 0), 0);
}

function isLikelySenderLabel(group: OcrMessageGroup, next?: OcrMessageGroup) {
  if (!next || group.side !== "incoming" || (next.side !== "incoming" && next.side !== "unknown")) return false;
  const gap = next.bbox.top - (group.bbox.top + group.bbox.height);
  const score = messageTextScore(group.text);
  const nextScore = messageTextScore(next.text);
  return gap >= 0
    && gap <= 90
    && score >= 2
    && score <= 7
    && nextScore >= score + 3
    && group.bbox.left < next.bbox.left
    && group.bbox.width < next.bbox.width * 0.8;
}

function isReliablePartnerCandidate(text: string, language: LanguageCode): language is PartnerLanguage {
  if (!isPartnerLanguage(language)) return false;
  const letters = Array.from(text).filter((character) => /\p{L}/u.test(character));
  return letters.length >= 3;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function readOcrLanguages() {
  const configured = process.env.CHATPOLISH_OCR_LANGS?.split(/[+,\s]+/).filter(Boolean);
  return configured?.length ? configured : DEFAULT_OCR_LANGS;
}

function selectOcrLanguages(partnerLanguage: unknown, configured: string[]) {
  const normalized = normalizeLanguage(partnerLanguage);
  const hinted = normalized === "ja"
    ? "jpn"
    : normalized === "en"
      ? "eng"
      : normalized === "zh"
        ? "chi_sim"
        : normalized === "es"
          ? "spa"
          : undefined;
  if (!hinted) return configured;
  return ["kor", hinted];
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeConversationId(value?: string) {
  return String(value ?? "default").trim().slice(0, 64) || "default";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
