import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import { db, userUploads } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files are accepted"));
    }
  },
});

router.post(
  "/upload/incorporation-cert",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;

    if (!req.file) {
      res.status(400).json({ error: "No file provided", code: "MISSING_FILE" });
      return;
    }

    try {
      const { buffer, mimetype, originalname, size } = req.file;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": mimetype,
          "Content-Length": String(size),
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        req.log.error({ status: uploadRes.status }, "GCS upload failed");
        res.status(500).json({ error: "Failed to upload file to storage", code: "UPLOAD_FAILED" });
        return;
      }

      await db.insert(userUploads).values({ userId, objectPath });

      const fileUrl = `/api/storage${objectPath}`;

      res.status(201).json({
        objectPath,
        fileUrl,
        metadata: {
          name: originalname,
          size,
          contentType: mimetype,
        },
      });
    } catch (error) {
      req.log.error({ error }, "Incorporation cert upload failed");
      res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
    }
  },
);

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        code: "FILE_TOO_LARGE",
      });
      return;
    }
    res.status(400).json({ error: err.message, code: "UPLOAD_ERROR" });
    return;
  }
  if (err instanceof Error && err.message === "Only PDF and image files are accepted") {
    res.status(415).json({ error: err.message, code: "INVALID_FILE_TYPE" });
    return;
  }
  res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
});

export default router;
