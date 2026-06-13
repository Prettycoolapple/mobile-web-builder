import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NZ_PROPERTY_TRANSCRIPTION_PROMPT } from "../../lib/transcription-place-correction";

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  toFile: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn(function OpenAI() {
    return {
    audio: {
      transcriptions: {
        create: openAiMocks.create,
      },
    },
  };
  }),
  toFile: openAiMocks.toFile,
}));

describe("POST /transcribe", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_TRANSCRIPTION_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_TRANSCRIPTION_MODEL = "";
    openAiMocks.create.mockReset();
    openAiMocks.toFile.mockReset();
    openAiMocks.toFile.mockResolvedValue({ name: "audio.m4a" });
    openAiMocks.create.mockResolvedValue({ text: "hello there" });
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENAI_TRANSCRIPTION_MODEL;
    else process.env.OPENAI_TRANSCRIPTION_MODEL = originalModel;
  });

  it("uses the configured transcription model, sends the NZ vocabulary prompt, and leaves language unset", async () => {
    process.env.OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
    const { default: transcribeRouter } = await import("../transcribe");

    const app = express();
    app.use((req, _res, next) => {
      req.log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as never;
      next();
    });
    app.use(transcribeRouter);

    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const form = new FormData();
      form.append("file", new Blob(["fake audio"], { type: "audio/m4a" }), "audio.m4a");

      const resp = await fetch(`http://127.0.0.1:${port}/transcribe`, {
        method: "POST",
        body: form,
      });

      await expect(resp.json()).resolves.toEqual({ text: "hello there" });
      expect(resp.status).toBe(200);
      expect(openAiMocks.create).toHaveBeenCalledTimes(1);
      const args = openAiMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.model).toBe("gpt-4o-mini-transcribe");
      expect(args.prompt).toBe(NZ_PROPERTY_TRANSCRIPTION_PROMPT);
      expect(args).not.toHaveProperty("language");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
