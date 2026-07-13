import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type LanguageCode = string;
export type PartnerLanguage = string;

interface LanguageDefinition {
  nllb: string;
  label: string;
  iso3: string[];
  aliases: string[];
}

type LanguageCatalog = Record<string, LanguageDefinition>;

const catalogPath = process.env.CHATPOLISH_LANGUAGE_CATALOG_PATH
  ?? fileURLToPath(new URL("../workers/nllb_languages.json", import.meta.url));

const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as LanguageCatalog;
const aliasToCode = new Map<string, string>();
const iso3ToCode = new Map<string, string>();
const nllbToCode = new Map<string, string>();

for (const [code, definition] of Object.entries(catalog)) {
  aliasToCode.set(code, code);
  aliasToCode.set(definition.label.toLowerCase(), code);
  nllbToCode.set(definition.nllb.toLowerCase(), code);
  for (const alias of definition.aliases) aliasToCode.set(alias.toLowerCase(), code);
  for (const iso3 of definition.iso3) iso3ToCode.set(iso3.toLowerCase(), code);
}

aliasToCode.set("auto", "auto");
aliasToCode.set("자동", "auto");
aliasToCode.set("자동 감지", "auto");
aliasToCode.set("unknown", "unknown");

export const LANGUAGE_LABELS: Record<string, string> = {
  auto: "자동 감지",
  unknown: "알 수 없음",
  ...Object.fromEntries(Object.entries(catalog).map(([code, definition]) => [code, definition.label]))
};

export const CORE_PARTNER_LANGUAGES = ["ja", "en", "zh", "es"] as const;

export function normalizeLanguageCode(value: unknown, fallback: LanguageCode = "auto"): LanguageCode {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase().replace(/-/g, "_").replace(/\s+/g, " ");
  const aliased = aliasToCode.get(normalized) ?? iso3ToCode.get(normalized) ?? nllbToCode.get(normalized);
  if (aliased) return aliased;

  return fallback;
}

export function languageLabel(code: LanguageCode) {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

export function isConcreteLanguage(code: LanguageCode): boolean {
  return code !== "auto" && code !== "unknown" && Boolean(catalog[code]);
}

export function isPartnerLanguage(code: LanguageCode): code is PartnerLanguage {
  return isConcreteLanguage(code);
}

export function francCodeToLanguage(code: string): LanguageCode {
  return iso3ToCode.get(code.toLowerCase()) ?? "unknown";
}

export function nllbLanguageTag(code: LanguageCode) {
  return catalog[code]?.nllb;
}

export function nllbSupportedLanguage(code: LanguageCode) {
  return Boolean(nllbLanguageTag(code));
}

export function supportedLanguageCodes() {
  return Object.keys(catalog);
}
