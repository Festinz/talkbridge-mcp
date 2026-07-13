import { describe, expect, it } from "vitest";
import { TranslationService } from "../src/translation.js";

describe("TranslationService", () => {
  it("matches CJK fixture text even when OCR inserts spaces", async () => {
    const service = new TranslationService();
    const result = await service.translate({
      text: "明日 、 何 時 に 会 える ?",
      sourceLanguage: "ja",
      targetLanguage: "ko",
      mode: "incoming"
    });

    expect(result.translatedText).toBe("내일 몇 시에 만날 수 있어?");
    expect(result.provider).toBe("fixture");
  });
});
