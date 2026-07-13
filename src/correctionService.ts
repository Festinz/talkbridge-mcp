import {
  correctKoreanChat,
  explainCorrections,
  generateSendOptions,
  LOCAL_PROVIDER,
  polishBeforeSend
} from "./ruleEngine.js";
import { correctWithLocalGecModel } from "./providers/localGecProvider.js";
import type {
  Audience,
  CorrectionChange,
  CorrectionResult,
  ExplainedCorrectionResult,
  ProviderMode,
  SendOptionsResult,
  Tone
} from "./types.js";

interface CorrectServiceOptions {
  tone?: Tone;
  provider?: ProviderMode;
}

interface PolishServiceOptions extends CorrectServiceOptions {
  audience?: Audience;
}

interface OptionsServiceOptions extends PolishServiceOptions {
  count?: number;
}

function resolveProvider(provider?: ProviderMode): ProviderMode {
  const requested = provider ?? (process.env.CHATPOLISH_PROVIDER as ProviderMode | undefined) ?? "rules";
  return requested === "local-gec" || requested === "hybrid" || requested === "rules" ? requested : "rules";
}

function toneForAudience(audience?: Audience): Tone {
  if (audience === "friend") {
    return "friendly";
  }
  if (audience === "manager" || audience === "customer") {
    return "formal";
  }
  return "neutral";
}

function fallbackProvider(mode: ProviderMode, error: unknown) {
  return {
    ...LOCAL_PROVIDER,
    mode,
    fallback: true,
    error: error instanceof Error ? error.message : String(error)
  };
}

function modelProvider(mode: ProviderMode, model: string) {
  return {
    type: "local" as const,
    name: "talkbridge-local-gec",
    version: "0.2.0",
    externalApi: false as const,
    mode,
    model
  };
}

function modelChange(original: string, corrected: string, model: string): CorrectionChange[] {
  if (original === corrected) {
    return [];
  }

  return [
    {
      type: "normalization",
      before: original,
      after: corrected,
      reason: `로컬 한국어 GEC 모델(${model})이 문장을 교정했습니다.`
    }
  ];
}

export async function correctChat(text: string, options: CorrectServiceOptions = {}): Promise<CorrectionResult> {
  const mode = resolveProvider(options.provider);
  if (mode === "rules") {
    return correctKoreanChat(text, { tone: options.tone });
  }

  try {
    const modelResult = await correctWithLocalGecModel(text);
    if (mode === "hybrid") {
      const postProcessed = correctKoreanChat(modelResult.corrected, { tone: options.tone });
      return {
        ...postProcessed,
        original: String(text ?? ""),
        changes: [...modelChange(String(text ?? ""), modelResult.corrected, modelResult.model), ...postProcessed.changes],
        provider: modelProvider(mode, modelResult.model),
        confidence: Math.min(postProcessed.confidence + 0.01, 0.98)
      };
    }

    return {
      original: String(text ?? ""),
      corrected: modelResult.corrected,
      changes: modelChange(String(text ?? ""), modelResult.corrected, modelResult.model),
      tone: options.tone ?? "neutral",
      confidence: 0.9,
      provider: modelProvider(mode, modelResult.model)
    };
  } catch (error) {
    const fallback = correctKoreanChat(text, { tone: options.tone });
    return {
      ...fallback,
      provider: fallbackProvider(mode, error)
    };
  }
}

export async function polishChat(text: string, options: PolishServiceOptions = {}): Promise<CorrectionResult> {
  return correctChat(text, {
    tone: options.tone ?? toneForAudience(options.audience),
    provider: options.provider
  });
}

export async function explainChat(text: string, options: CorrectServiceOptions = {}): Promise<ExplainedCorrectionResult> {
  const mode = resolveProvider(options.provider);
  if (mode === "rules") {
    return explainCorrections(text, { tone: options.tone });
  }

  const result = await correctChat(text, options);
  const explanations = result.changes.map((change) => `${change.before} -> ${change.after}: ${change.reason}`);

  return {
    ...result,
    summary:
      explanations.length === 0
        ? "수정할 만한 오타, 띄어쓰기, 문장부호 문제가 크게 보이지 않습니다."
        : `${explanations.length}개의 수정 사항을 적용했습니다.`,
    explanations
  };
}

export async function generateChatOptions(
  text: string,
  options: OptionsServiceOptions = {}
): Promise<SendOptionsResult> {
  const mode = resolveProvider(options.provider);
  if (mode === "rules") {
    return generateSendOptions(text, options);
  }

  const corrected = await correctChat(text, {
    tone: options.tone,
    provider: mode
  });
  const generated = generateSendOptions(corrected.corrected, {
    audience: options.audience,
    tone: options.tone,
    count: options.count
  });

  return {
    ...generated,
    original: String(text ?? ""),
    provider: corrected.provider,
    confidence: Math.min((generated.confidence + corrected.confidence) / 2, 0.98)
  };
}

export function providerCapabilities() {
  return {
    defaultProvider: resolveProvider(),
    providers: [
      {
        id: "rules",
        label: "규칙 엔진",
        externalApi: false,
        description: "설치 없이 동작하는 TalkBridge 규칙 엔진입니다. 빠르고 무료지만, 정해진 패턴 밖의 문장은 제한적입니다."
      },
      {
        id: "local-gec",
        label: "로컬 모델",
        externalApi: false,
        model: process.env.CHATPOLISH_GEC_MODEL ?? "Soyoung97/gec_kr",
        description: "Python transformers로 로컬 한국어 GEC 모델을 실행합니다. 첫 실행 때 모델 다운로드와 로딩 시간이 필요합니다."
      },
      {
        id: "hybrid",
        label: "하이브리드",
        externalApi: false,
        model: process.env.CHATPOLISH_GEC_MODEL ?? "Soyoung97/gec_kr",
        description: "로컬 GEC 모델 결과를 규칙 엔진으로 후처리합니다. 자유 입력 대응 범위와 데모 안정성을 함께 노립니다."
      }
    ]
  };
}
