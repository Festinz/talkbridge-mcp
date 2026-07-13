export const TONES = ["neutral", "polite", "friendly", "formal", "concise"] as const;

export type Tone = (typeof TONES)[number];

export type Audience = "general" | "friend" | "manager" | "customer";

export type ChangeType = "typo" | "spacing" | "punctuation" | "tone" | "normalization";

export type ProviderMode = "rules" | "local-gec" | "hybrid";

export interface CorrectionChange {
  type: ChangeType;
  before: string;
  after: string;
  reason: string;
  index?: number;
}

export interface LocalProvider {
  type: "local";
  name: string;
  version: string;
  externalApi: false;
  mode?: ProviderMode;
  model?: string;
  fallback?: boolean;
  error?: string;
}

export interface CorrectionResult {
  original: string;
  corrected: string;
  changes: CorrectionChange[];
  tone: Tone;
  confidence: number;
  provider: LocalProvider;
}

export interface ExplainedCorrectionResult extends CorrectionResult {
  summary: string;
  explanations: string[];
}

export interface SendOption {
  label: string;
  text: string;
  tone: Tone;
  confidence: number;
  changes: CorrectionChange[];
}

export interface SendOptionsResult {
  original: string;
  options: SendOption[];
  tone: Tone;
  confidence: number;
  provider: LocalProvider;
}
