import { afterEach, describe, expect, it } from "vitest";
import { argosCanTranslate } from "../src/providers/argosTranslationProvider.js";
import { nllbCanTranslate } from "../src/providers/nllbTranslationProvider.js";

const originalPairs = process.env.CHATPOLISH_ARGOS_MODEL_PAIRS;

afterEach(() => {
  if (originalPairs === undefined) delete process.env.CHATPOLISH_ARGOS_MODEL_PAIRS;
  else process.env.CHATPOLISH_ARGOS_MODEL_PAIRS = originalPairs;
});

describe("translation provider routing", () => {
  it("finds an Argos route through the English hub", () => {
    process.env.CHATPOLISH_ARGOS_MODEL_PAIRS = "es-en,en-ko,ko-en,en-ja";

    expect(argosCanTranslate("es", "ko")).toBe(true);
    expect(argosCanTranslate("ko", "ja")).toBe(true);
    expect(argosCanTranslate("fr", "ko")).toBe(false);
  });

  it("routes broader catalog languages to NLLB", () => {
    expect(nllbCanTranslate("fr", "ko")).toBe(true);
    expect(nllbCanTranslate("ar", "vi")).toBe(true);
    expect(nllbCanTranslate("unknown", "ko")).toBe(false);
  });
});
