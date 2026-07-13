import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("HTTP API", () => {
  const app = createApp();

  it("responds to health checks", async () => {
    const response = await request(app).get("/healthz").expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.externalApi).toBe(false);
    expect(response.body.capabilities.providers.map((provider: { id: string }) => provider.id)).toContain(
      "local-gec"
    );
    expect(response.body.translation.mode).toBe("local-fallback");
  });

  it("reports readiness when only local providers are configured", async () => {
    const response = await request(app).get("/readyz").expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.translation.mode).toBe("local-fallback");
  });

  it("lists correction providers", async () => {
    const response = await request(app).get("/api/demo/providers").expect(200);

    expect(response.body.providers.map((provider: { id: string }) => provider.id)).toEqual([
      "rules",
      "local-gec",
      "hybrid"
    ]);
  });

  it("lists broad local translation languages without an external API", async () => {
    const response = await request(app).get("/api/demo/languages").expect(200);
    const codes = response.body.languages.map((language: { code: string }) => language.code);

    expect(codes).toEqual(expect.arrayContaining(["ko", "es", "fr", "de", "ar", "hi", "vi"]));
    expect(response.body.externalApi).toBe(false);
  });

  it("corrects text through demo endpoint", async () => {
    const response = await request(app)
      .post("/api/demo/correct")
      .send({ text: "안녕하세요 잘지내셨나요" })
      .expect(200);

    expect(response.body.corrected).toBe("안녕하세요. 잘 지내셨나요?");
    expect(response.body.provider.type).toBe("local");
  });

  it("polishes text through demo endpoint", async () => {
    const response = await request(app)
      .post("/api/demo/polish")
      .send({ text: "확인부탁", audience: "manager" })
      .expect(200);

    expect(response.body.corrected).toContain("확인 부탁드립니다");
  });

  it("generates three options through demo endpoint", async () => {
    const response = await request(app)
      .post("/api/demo/options")
      .send({ text: "보내기전에 확인부탁", count: 3 })
      .expect(200);

    expect(response.body.options).toHaveLength(3);
    expect(response.body.provider.externalApi).toBe(false);
  });

  it("falls back to rules when local model worker is unavailable", async () => {
    const previousPython = process.env.CHATPOLISH_PYTHON;
    process.env.CHATPOLISH_PYTHON = "python-command-that-does-not-exist";

    try {
      const response = await request(app)
        .post("/api/demo/correct")
        .send({ text: "안녕하세요 잘지내셨나요", provider: "local-gec" })
        .expect(200);

      expect(response.body.corrected).toBe("안녕하세요. 잘 지내셨나요?");
      expect(response.body.provider.fallback).toBe(true);
      expect(response.body.provider.externalApi).toBe(false);
    } finally {
      if (previousPython === undefined) {
        delete process.env.CHATPOLISH_PYTHON;
      } else {
        process.env.CHATPOLISH_PYTHON = previousPython;
      }
    }
  });

  it("rejects empty text", async () => {
    const response = await request(app).post("/api/demo/correct").send({ text: "" }).expect(400);

    expect(response.body.error).toBe("text is required");
  });

  it("requires an image for the image bridge endpoint", async () => {
    const response = await request(app).post("/api/demo/image-bridge").expect(400);

    expect(response.body.error).toBe("image is required");
  });
});
