import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  languageLabel,
  normalizeLanguage,
  TranslationService
} from "../src/translation.js";

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

  it("does not cache a fallback translation failure", async () => {
    const service = new TranslationService();
    const request = {
      text: "This sentence is intentionally outside the fixtures.",
      sourceLanguage: "en" as const,
      targetLanguage: "ko" as const,
      mode: "incoming" as const
    };

    const first = await service.translate(request);
    const second = await service.translate(request);

    expect(first.fallback).toBe(true);
    expect(second.fallback).toBe(true);
    expect(second.cached).toBe(false);
  });

  it("detects arbitrary Spanish chat instead of treating every Latin sentence as English", () => {
    const result = detectLanguage("Hola, soy un hombre guapo de 29 años.");

    expect(result.language).toBe("es");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it.each([
    ["Could you send me the updated schedule after lunch?", "en"],
    ["Can you help me with this?", "en"],
    ["das Fahrrad ist da", "de"],
    ["Bonjour, pouvons-nous nous retrouver après la réunion ?", "fr"],
    ["Wir treffen uns morgen vor dem Bahnhof.", "de"],
    ["Завтра я буду немного позже.", "ru"],
    ["سأتصل بك بعد الاجتماع.", "ar"],
    ["Tôi sẽ đến sau mười phút nữa.", "vi"]
  ])("detects a broad free-form language sample", (text, expected) => {
    expect(detectLanguage(text).language).toBe(expected);
  });

  it("does not truncate a longer Chinese message to a greeting", async () => {
    const service = new TranslationService();
    const result = await service.translate({
      text: "你好，我们明天几点见面？",
      sourceLanguage: "zh",
      targetLanguage: "ko",
      mode: "incoming"
    });

    expect(result.translatedText).not.toBe("안녕하세요");
    expect(result.provider).not.toBe("local");
  });

  it("normalizes language names and labels broad language codes", () => {
    expect(normalizeLanguage("Spanish")).toBe("es");
    expect(normalizeLanguage("프랑스어")).toBe("fr");
    expect(normalizeLanguage("kor_Hang")).toBe("ko");
    expect(languageLabel("vi")).toBe("베트남어");
  });
});
