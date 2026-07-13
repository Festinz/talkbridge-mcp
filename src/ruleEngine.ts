import type {
  Audience,
  ChangeType,
  CorrectionChange,
  CorrectionResult,
  ExplainedCorrectionResult,
  LocalProvider,
  SendOption,
  SendOptionsResult,
  Tone
} from "./types.js";

export const LOCAL_PROVIDER: LocalProvider = {
  type: "local",
  name: "talkbridge-rule-engine",
  version: "0.2.0",
  externalApi: false
};

interface EngineState {
  text: string;
  changes: CorrectionChange[];
}

interface CorrectOptions {
  tone?: Tone;
}

interface PolishOptions {
  audience?: Audience;
  tone?: Tone;
}

type Replacement = (match: string, ...groups: string[]) => string;

const protectedTokenPattern = /__CHATPOLISH_TOKEN_\d+__$/;
const sentenceEndPattern = /[.!?。！？]$/;
const questionEndingPattern = /(나요|셨나요|인가요|일까요|될까요|할까요|습니까|되나요|있나요|없나요|어때요|어때)$/;

const typoRules: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  { pattern: /안되요/g, replacement: "안 돼요", reason: "'안되요'는 '안 돼요'가 자연스럽습니다." },
  { pattern: /되요/g, replacement: "돼요", reason: "'되요'는 '돼요'로 씁니다." },
  { pattern: /됬/g, replacement: "됐", reason: "'됬'은 '됐'으로 씁니다." },
  { pattern: /몇일/g, replacement: "며칠", reason: "'몇일'은 '며칠'이 맞습니다." },
  { pattern: /오랫만/g, replacement: "오랜만", reason: "'오랫만'은 '오랜만'으로 씁니다." },
  { pattern: /금새/g, replacement: "금세", reason: "'금새'는 '금세'가 맞습니다." },
  { pattern: /뵈요/g, replacement: "봬요", reason: "'뵈요'는 '봬요'로 씁니다." },
  { pattern: /할께/g, replacement: "할게", reason: "'할께'는 '할게'가 맞습니다." },
  { pattern: /갈께/g, replacement: "갈게", reason: "'갈께'는 '갈게'가 맞습니다." },
  { pattern: /볼께/g, replacement: "볼게", reason: "'볼께'는 '볼게'가 맞습니다." },
  { pattern: /연락드릴께요/g, replacement: "연락드릴게요", reason: "'-ㄹ께요'는 '-ㄹ게요'로 씁니다." }
];

const spacingRules: Array<{ pattern: RegExp; replacement: Replacement; reason: string }> = [
  {
    pattern: /안녕하세요(?=\S)/g,
    replacement: () => "안녕하세요 ",
    reason: "첫 인사 뒤에는 공백을 넣는 편이 읽기 좋습니다."
  },
  {
    pattern: /잘지내/g,
    replacement: () => "잘 지내",
    reason: "'잘 지내다'는 띄어 씁니다."
  },
  {
    pattern: /잘지냈/g,
    replacement: () => "잘 지냈",
    reason: "'잘 지내다'는 띄어 씁니다."
  },
  {
    pattern: /(보내기|가기|먹기|회의|출근|퇴근|공유|확인|전달|등록)전에/g,
    replacement: (_match, word) => `${word} 전에`,
    reason: "'전에'는 앞말과 띄어 씁니다."
  },
  {
    pattern: /(보내기|가기|먹기|회의|출근|퇴근|공유|확인|전달|등록)전/g,
    replacement: (_match, word) => `${word} 전`,
    reason: "'전'은 앞말과 띄어 씁니다."
  },
  {
    pattern: /(확인|전달|공유|등록|검토)부탁/g,
    replacement: (_match, word) => `${word} 부탁`,
    reason: "'부탁'은 앞말과 띄어 쓰는 편이 읽기 쉽습니다."
  },
  {
    pattern: /(할|볼|갈|먹을|읽을|보낼|확인할)수/g,
    replacement: (_match, word) => `${word} 수`,
    reason: "의존 명사 '수'는 앞말과 띄어 씁니다."
  },
  {
    pattern: /수있/g,
    replacement: () => "수 있",
    reason: "'수 있다'는 띄어 씁니다."
  },
  {
    pattern: /수없/g,
    replacement: () => "수 없",
    reason: "'수 없다'는 띄어 씁니다."
  },
  {
    pattern: /나와의대화/g,
    replacement: () => "나와의 대화",
    reason: "'나와의 대화'처럼 의미 단위로 띄어 씁니다."
  },
  {
    pattern: /도구연결/g,
    replacement: () => "도구 연결",
    reason: "'도구 연결'처럼 띄어 씁니다."
  },
  {
    pattern: /예를들어/g,
    replacement: () => "예를 들어",
    reason: "'예를 들어'처럼 띄어 씁니다."
  }
];

function protectSpecialTokens(text: string) {
  const tokens: string[] = [];
  const protectedText = text.replace(
    /(https?:\/\/[^\s]+|www\.[^\s]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi,
    (token) => {
      const id = tokens.length;
      tokens.push(token);
      return `__CHATPOLISH_TOKEN_${id}__`;
    }
  );

  return {
    text: protectedText,
    restore(value: string) {
      return value.replace(/__CHATPOLISH_TOKEN_(\d+)__/g, (_match, id: string) => tokens[Number(id)] ?? _match);
    }
  };
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

function pushChange(
  state: EngineState,
  type: ChangeType,
  before: string,
  after: string,
  reason: string,
  index?: number
) {
  if (before === after) return;
  state.changes.push({ type, before, after, reason, index });
}

function applyPattern(
  state: EngineState,
  pattern: RegExp,
  replacement: Replacement,
  type: ChangeType,
  reason: string
) {
  state.text = state.text.replace(pattern, (match: string, ...args: unknown[]) => {
    const index = typeof args[args.length - 2] === "number" ? (args[args.length - 2] as number) : undefined;
    const groups = args.slice(0, -2).filter((arg): arg is string => typeof arg === "string");
    const after = replacement(match, ...groups);
    pushChange(state, type, match, after, reason, index);
    return after;
  });
}

function normalizeWhitespace(state: EngineState) {
  const trimmed = state.text.trim();
  pushChange(state, "normalization", state.text, trimmed, "앞뒤 불필요한 공백을 정리했습니다.", 0);
  state.text = trimmed;
  applyPattern(state, /[ \t]{2,}/g, () => " ", "normalization", "연속 공백을 하나로 정리했습니다.");
  applyPattern(state, /\s+([,.!?])/g, (_match, mark) => mark, "punctuation", "문장부호 앞 공백을 정리했습니다.");
  applyPattern(state, /([.!?])(?=[가-힣A-Za-z0-9])/g, (_match, mark) => `${mark} `, "punctuation", "문장부호 뒤에 공백을 넣었습니다.");
}

function applyTypoRules(state: EngineState) {
  for (const rule of typoRules) {
    applyPattern(state, rule.pattern, () => rule.replacement, "typo", rule.reason);
  }
}

function applySpacingRules(state: EngineState) {
  for (const rule of spacingRules) {
    applyPattern(state, rule.pattern, rule.replacement, "spacing", rule.reason);
  }
}

function applyToneRules(state: EngineState, tone: Tone) {
  if (tone === "neutral") return;

  if (tone === "formal" || tone === "polite") {
    applyPattern(state, /(확인|전달|공유|검토|등록) 부탁(?!드립니다)/g, (_match, action) => `${action} 부탁드립니다`, "tone", "업무 메시지에 맞게 요청 표현을 완성했습니다.");
    applyPattern(state, /봐줘/g, () => "확인 부탁드립니다", "tone", "반말 요청을 정중한 표현으로 바꿨습니다.");
    applyPattern(state, /해줘/g, () => "해 주시면 감사하겠습니다", "tone", "반말 요청을 정중한 표현으로 바꿨습니다.");
    applyPattern(state, /고마워/g, () => "감사합니다", "tone", "감사 표현을 격식 있게 바꿨습니다.");
    applyPattern(state, /미안/g, () => "죄송합니다", "tone", "사과 표현을 격식 있게 바꿨습니다.");
  }

  if (tone === "friendly") {
    applyPattern(state, /부탁드립니다/g, () => "부탁해요", "tone", "친근한 존댓말로 낮췄습니다.");
    applyPattern(state, /감사합니다/g, () => "고마워요", "tone", "친근한 감사 표현으로 바꿨습니다.");
    applyPattern(state, /죄송합니다/g, () => "미안해요", "tone", "친근한 사과 표현으로 바꿨습니다.");
  }

  if (tone === "concise") {
    applyPattern(state, /혹시\s*/g, () => "", "tone", "불필요한 완충 표현을 줄였습니다.");
    applyPattern(state, /가능하시다면\s*/g, () => "", "tone", "불필요한 완충 표현을 줄였습니다.");
    applyPattern(state, /바쁘시겠지만\s*/g, () => "", "tone", "불필요한 완충 표현을 줄였습니다.");
    applyPattern(state, /정말\s+/g, () => "", "tone", "강조 표현을 줄였습니다.");
  }
}

function applyPunctuationRules(state: EngineState, tone: Tone) {
  applyPattern(state, /^(안녕하세요|안녕하십니까|안녕)\s+(?=[가-힣A-Za-z0-9])/u, (_match, greeting) => `${greeting}. `, "punctuation", "첫 인사 뒤에 마침표를 넣어 문장을 나눴습니다.");
  applyPattern(state, /^(오랜만이야)\s+(?=잘)/u, (_match, greeting) => `${greeting}. `, "punctuation", "첫 문장 뒤에 마침표를 넣어 문장을 나눴습니다.");
  applyPattern(state, /(나요|셨나요|인가요|습니까)\s+(?=[가-힣A-Za-z0-9])/g, (_match, ending) => `${ending}? `, "punctuation", "질문 어미 뒤에 물음표를 넣어 문장을 나눴습니다.");
  applyPattern(state, /!!+/g, () => "!", "punctuation", "느낌표를 하나로 정리했습니다.");
  applyPattern(state, /\?\?+/g, () => "?", "punctuation", "물음표를 하나로 정리했습니다.");

  const withoutTrailingSpace = state.text.trimEnd();
  if (withoutTrailingSpace !== state.text) {
    pushChange(state, "normalization", state.text, withoutTrailingSpace, "문장 끝 공백을 정리했습니다.");
    state.text = withoutTrailingSpace;
  }

  if (!state.text || sentenceEndPattern.test(state.text) || protectedTokenPattern.test(state.text)) return;

  const punctuation = questionEndingPattern.test(state.text) ? "?" : tone === "friendly" ? "" : ".";
  if (punctuation) {
    const before = state.text;
    state.text = `${state.text}${punctuation}`;
    pushChange(state, "punctuation", before, state.text, "문장 끝 문장부호를 보완했습니다.", before.length);
  }
}

function confidenceFor(changes: CorrectionChange[], tone: Tone) {
  const base = changes.length === 0 ? 0.82 : 0.76;
  const changeBoost = Math.min(changes.length * 0.03, 0.18);
  const toneBoost = tone === "neutral" ? 0 : 0.02;
  return roundConfidence(Math.min(base + changeBoost + toneBoost, 0.97));
}

function toneForAudience(audience?: Audience): Tone {
  if (audience === "friend") return "friendly";
  if (audience === "manager" || audience === "customer") return "formal";
  return "neutral";
}

function shapeOptionText(text: string, tone: Tone, label: string) {
  if (tone === "formal" || tone === "polite" || label === "정중하게") {
    return text.replace(/잘 지내셨나요\?$/u, "잘 지내셨는지 궁금합니다.").replace(/확인 부탁\.$/u, "확인 부탁드립니다.");
  }
  if (tone === "friendly" || label === "친근하게") {
    return text
      .replace(/잘 지냈나요\?$/u, "잘 지냈어?")
      .replace(/잘 지내셨나요\?$/u, "잘 지냈어요?")
      .replace(/부탁드립니다\.$/u, "부탁해요.")
      .replace(/감사합니다\.$/u, "고마워요.");
  }
  if (tone === "concise" || label === "간결하게" || label === "짧게") {
    return text
      .replace(/^안녕하세요\.\s*/u, "")
      .replace(/^오랜만이야\.\s*잘 지냈나요\?$/u, "오랜만! 잘 지냈어?")
      .replace(/[.]$/u, "");
  }
  return text;
}

function ensureDistinctOption(base: string, label: string) {
  if (label === "친근하게") return base.endsWith("요?") || base.endsWith("요.") ? base : `${base.replace(/[.!?]$/u, "")}요`;
  if (label === "정중하게") return base.includes("부탁드립니다") ? base : base.replace(/[.]?$/u, " 부탁드립니다.");
  if (label === "자연스럽게") return base;
  if (label === "간결하게" || label === "짧게") return base.replace(/^안녕하세요\.\s*/u, "").replace(/[.]$/u, "");
  return base;
}

export function correctKoreanChat(text: string, options: CorrectOptions = {}): CorrectionResult {
  const original = String(text ?? "");
  const tone = options.tone ?? "neutral";
  const protectedText = protectSpecialTokens(original);
  const state: EngineState = { text: protectedText.text, changes: [] };

  normalizeWhitespace(state);
  applyTypoRules(state);
  applySpacingRules(state);
  applyToneRules(state, tone);
  applyPunctuationRules(state, tone);

  return {
    original,
    corrected: protectedText.restore(state.text),
    changes: state.changes,
    tone,
    confidence: confidenceFor(state.changes, tone),
    provider: LOCAL_PROVIDER
  };
}

export function polishBeforeSend(text: string, options: PolishOptions = {}): CorrectionResult {
  return correctKoreanChat(text, { tone: options.tone ?? toneForAudience(options.audience) });
}

export function explainCorrections(text: string, options: CorrectOptions = {}): ExplainedCorrectionResult {
  const result = correctKoreanChat(text, options);
  const explanations = result.changes.map((change) => `${change.before} -> ${change.after}: ${change.reason}`);
  return {
    ...result,
    summary: explanations.length === 0 ? "수정할 만한 오타, 띄어쓰기, 문장부호 문제가 크게 보이지 않습니다." : `${explanations.length}개의 수정 사항을 적용했습니다.`,
    explanations
  };
}

export function generateSendOptions(text: string, options: PolishOptions & { count?: number } = {}): SendOptionsResult {
  const preferredTone = options.tone ?? toneForAudience(options.audience);
  const variants: Array<{ label: string; tone: Tone }> =
    options.audience === "friend"
      ? [
          { label: "친근하게", tone: "friendly" },
          { label: "자연스럽게", tone: "neutral" },
          { label: "짧게", tone: "concise" }
        ]
      : [
          { label: "정중하게", tone: preferredTone === "neutral" ? "polite" : preferredTone },
          { label: "자연스럽게", tone: "neutral" },
          { label: "간결하게", tone: "concise" },
          { label: "부드럽게", tone: "friendly" }
        ];

  const count = Math.max(1, Math.min(options.count ?? 3, 5));
  const seen = new Set<string>();
  const sendOptions: SendOption[] = [];

  for (const variant of variants) {
    const result = polishBeforeSend(text, { audience: options.audience, tone: variant.tone });
    let optionText = shapeOptionText(result.corrected, variant.tone, variant.label);
    optionText = ensureDistinctOption(optionText, variant.label);
    if (seen.has(optionText)) {
      optionText = `${optionText} (${variant.label})`;
    }
    seen.add(optionText);
    const changes =
      optionText === result.corrected
        ? result.changes
        : [
            ...result.changes,
            {
              type: "tone" as const,
              before: result.corrected,
              after: optionText,
              reason: `${variant.label} 후보에 맞게 표현을 조정했습니다.`
            }
          ];
    sendOptions.push({ label: variant.label, text: optionText, tone: result.tone, confidence: result.confidence, changes });
    if (sendOptions.length >= count) break;
  }

  return {
    original: String(text ?? ""),
    options: sendOptions,
    tone: preferredTone,
    confidence: sendOptions.length ? roundConfidence(sendOptions.reduce((sum, option) => sum + option.confidence, 0) / sendOptions.length) : 0.84,
    provider: LOCAL_PROVIDER
  };
}
