import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";

const router: IRouter = Router();

// Store audio in memory. Whisper has a 25MB file size limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// No auth gate: voice input must work for anonymous users too, consistent with
// the anonymous chat/discovery flows. This endpoint does not use the user id —
// it only turns audio into text; the downstream message send still enforces
// per-user/anonymous message limits.
router.post(
  "/transcribe",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided", code: "MISSING_FILE" });
      return;
    }

    try {
      // Ensure we have an API key. This will read OPENAI_API_KEY from env automatically.
      if (!process.env.OPENAI_API_KEY) {
        req.log.error("OPENAI_API_KEY is not set for transcription");
        res.status(503).json({ error: "Transcription service unavailable", code: "NO_API_KEY" });
        return;
      }

      const openai = new OpenAI();
      
      // OpenAI Node SDK provides a `toFile` utility to convert memory buffers to a File object
      // The extension helps Whisper infer format (m4a, wav, etc.)
      const extension = req.file.mimetype.includes("wav") ? "wav" : "m4a";
      const file = await toFile(req.file.buffer, `audio.${extension}`, { type: req.file.mimetype });

      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        // 'en' helps accuracy if we know it's english, but leaving it out allows auto-detect. 
        // We will leave it out or auto-detect so it supports Chinese/etc if the user speaks it.
      });

      res.status(200).json({ text: transcription.text });
    } catch (error) {
      req.log.error({ err: error }, "Audio transcription failed");
      res.status(500).json({ error: "Failed to transcribe audio", code: "TRANSCRIPTION_FAILED" });
    }
  }
);

export default router;
