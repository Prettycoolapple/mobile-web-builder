import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
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

export default router;
