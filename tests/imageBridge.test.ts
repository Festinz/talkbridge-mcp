import { describe, expect, it } from "vitest";
import { groupOcrLines, type OcrLine } from "../src/imageBridgeService.js";

describe("conversation image grouping", () => {
  it("groups adjacent OCR lines and infers left/right chat sides", () => {
    const lines: OcrLine[] = [
      { text: "こんにちは", confidence: 92, bbox: { left: 20, top: 80, width: 120, height: 20 } },
      { text: "元気ですか", confidence: 90, bbox: { left: 20, top: 104, width: 130, height: 20 } },
      { text: "네, 잘 지내요", confidence: 95, bbox: { left: 250, top: 180, width: 120, height: 20 } }
    ];

    const groups = groupOcrLines(lines);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ text: "こんにちは 元気ですか", side: "incoming" });
    expect(groups[1]).toMatchObject({ text: "네, 잘 지내요", side: "outgoing" });
  });

  it("drops empty OCR lines", () => {
    const groups = groupOcrLines([
      { text: "   ", confidence: 90, bbox: { left: 20, top: 10, width: 50, height: 20 } }
    ]);

    expect(groups).toEqual([]);
  });
});
