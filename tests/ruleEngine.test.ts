import { describe, expect, it } from "vitest";
import { correctKoreanChat, generateSendOptions, polishBeforeSend } from "../src/ruleEngine.js";

describe("rule engine", () => {
  it("corrects greeting spacing and punctuation", () => {
    const result = correctKoreanChat("안녕하세요 잘지내셨나요");

    expect(result.corrected).toBe("안녕하세요. 잘 지내셨나요?");
    expect(result.provider.type).toBe("local");
    expect(result.provider.externalApi).toBe(false);
    expect(result.changes.map((change) => change.type)).toContain("spacing");
  });

  it("fixes common pre-send spacing", () => {
    const result = correctKoreanChat("보내기전에 확인부탁");

    expect(result.corrected).toContain("보내기 전에");
    expect(result.corrected).toContain("확인 부탁");
  });

  it("keeps existing exclamation and preserves URL, emoji, and numbers", () => {
    const thanks = correctKoreanChat("감사합니다!");
    const withUrl = correctKoreanChat("오늘 3시에 봐요 https://example.com/a 🙂");

    expect(thanks.corrected).toBe("감사합니다!");
    expect(withUrl.corrected).toContain("3시");
    expect(withUrl.corrected).toContain("https://example.com/a");
    expect(withUrl.corrected).toContain("🙂");
  });

  it("polishes tone for manager messages", () => {
    const result = polishBeforeSend("자료 확인부탁", { audience: "manager" });

    expect(result.tone).toBe("formal");
    expect(result.corrected).toContain("확인 부탁드립니다");
  });

  it("generates copyable send options", () => {
    const result = generateSendOptions("안녕하세요 잘지내셨나요", { count: 3 });

    expect(result.options).toHaveLength(3);
    expect(result.options[0]?.text).toContain("안녕하세요");
  });
});
