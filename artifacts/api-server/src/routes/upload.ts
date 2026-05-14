import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import { eq } from "drizzle-orm";
import { db, userUploads, profiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function classifyStorageUploadError(error: unknown): { status: number; error: string; code: string } | null {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("PRIVATE_OBJECT_DIR not set") ||
    message.includes("PUBLIC_OBJECT_SEARCH_PATHS not set") ||
    message.includes("GOOGLE_APPLICATION_CREDENTIALS") ||
    message.includes("local storage mode")
  ) {
    return {
      status: 503,
      error: "Profile photo storage is not configured on the server. Please contact support.",
      code: "STORAGE_NOT_CONFIGURED",
    };
  }
  return null;
}

async function uploadToStorage(
  service: ObjectStorageService,
  buffer: Buffer | Uint8Array,
  mimetype: string,
  size: number,
  namespace?: string,
): Promise<{ objectPath: string }> {
  if (service.isLocal) {
    return service.saveLocal(Buffer.from(buffer), mimetype, namespace);
  }
  const uploadURL = await service.getObjectEntityUploadURL({
    contentType: mimetype,
    ...(namespace ? { namespace } : {}),
  });
  const objectPath = service.normalizeObjectEntityPath(uploadURL);
  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": mimetype, "Content-Length": String(size) },
    body: new Uint8Array(buffer),
  });
  if (!uploadRes.ok) {
    throw new Error(`Storage upload failed with status ${uploadRes.status}`);
  }
  return { objectPath };
}

function profilePictureDataUrl(buffer: Buffer | Uint8Array, mimetype: string): string {
  return `data:${mimetype};base64,${Buffer.from(buffer).toString("base64")}`;
}

function inlineImageDataUrl(buffer: Buffer | Uint8Array, mimetype: string): string {
  return `data:${mimetype};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function saveInlineProfilePicture(
  userId: string,
  buffer: Buffer | Uint8Array,
  mimetype: string,
): Promise<{ fileUrl: string }> {
  const fileUrl = profilePictureDataUrl(buffer, mimetype);
  await db.update(profiles).set({ avatarUrl: fileUrl }).where(eq(profiles.id, userId));
  return { fileUrl };
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
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

const uploadImageOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are accepted"));
    }
  },
});

// Pre-signup variant — uploads the certificate to object storage and returns
// the URL without requiring auth. Used so provider signup can be ATOMIC: the
// mobile client uploads the cert first, then submits signup with the URL in
// the payload, and the server refuses to create a half-formed provider profile
// without it. No DB row is inserted here; the URL is bound to userUploads in
// the signup transaction once the account is created.
//
// Because this endpoint is unauthenticated, it is rate-limited per source IP
// to prevent storage spam / DoS abuse. The window + cap are deliberately tight
// since a real provider signup only needs ONE successful upload.
const PRE_SIGNUP_RATE_WINDOW_MS = 10 * 60 * 1000;
const PRE_SIGNUP_RATE_MAX = 5;
const preSignupHits = new Map<string, number[]>();

function preSignupRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";
  const now = Date.now();
  const cutoff = now - PRE_SIGNUP_RATE_WINDOW_MS;
  const hits = (preSignupHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= PRE_SIGNUP_RATE_MAX) {
    res.status(429).json({
      error: "Too many uploads. Please try again later.",
      code: "RATE_LIMITED",
    });
    return;
  }
  hits.push(now);
  preSignupHits.set(ip, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (preSignupHits.size > 10_000) {
    for (const [k, v] of preSignupHits) {
      const fresh = v.filter((t) => t > cutoff);
      if (fresh.length === 0) preSignupHits.delete(k);
      else preSignupHits.set(k, fresh);
    }
  }
  next();
}

router.post(
  "/upload/profile-picture/request-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const { name, size, contentType } = (req.body ?? {}) as {
      name?: string;
      size?: number;
      contentType?: string;
    };
    const fileSize = typeof size === "number" ? size : Number.NaN;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing or invalid file name", code: "INVALID_NAME" });
      return;
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({
        error: `Invalid file size. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        code: "INVALID_SIZE",
      });
      return;
    }
    if (!contentType || typeof contentType !== "string" || !ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      res.status(415).json({ error: "Only image files are accepted", code: "INVALID_FILE_TYPE" });
      return;
    }

    try {
      if (objectStorageService.isLocal) {
        res.status(501).json({
          error: "Signed URL upload not available in local storage mode. Use the multipart upload endpoint instead.",
          code: "LOCAL_MODE",
        });
        return;
      }
      const uploadURL = await objectStorageService.getObjectEntityUploadURL({
        contentType,
        namespace: "avatars",
      });
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const fileUrl = `/api/storage${objectPath}`;

      res.json({
        uploadURL,
        objectPath,
        fileUrl,
        expiresInSec: 900,
        requiredHeaders: {
          "Content-Type": contentType,
        },
        metadata: {
          name,
          size: fileSize,
          contentType,
        },
      });
    } catch (error) {
      req.log.error({ err: error }, "Profile picture signed URL generation failed");
      const classified = classifyStorageUploadError(error);
      if (classified) {
        res.status(classified.status).json({ error: classified.error, code: classified.code });
        return;
      }
      res.status(500).json({ error: "Failed to generate upload URL", code: "SIGN_URL_FAILED" });
    }
  },
);

router.post(
  "/upload/profile-picture/complete",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { objectPath } = (req.body ?? {}) as { objectPath?: string };

    if (!objectPath || typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Missing or invalid objectPath", code: "INVALID_OBJECT_PATH" });
      return;
    }

    try {
      if (objectStorageService.isLocal) {
        if (!objectStorageService.localFileExists(objectPath)) {
          res.status(404).json({ error: "Uploaded object not found", code: "OBJECT_NOT_FOUND" });
          return;
        }
      } else {
        await objectStorageService.getObjectEntityFile(objectPath);
      }

      const fileUrl = `/api/storage${objectPath}`;
      await Promise.all([
        db.insert(userUploads).values({ userId, objectPath }).onConflictDoNothing(),
        db.update(profiles).set({ avatarUrl: fileUrl }).where(eq(profiles.id, userId)),
      ]);

      res.json({ fileUrl, objectPath });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found", code: "OBJECT_NOT_FOUND" });
        return;
      }
      req.log.error({ err: error }, "Profile picture completion failed");
      res.status(500).json({ error: "Failed to finalize profile picture upload", code: "FINALIZE_FAILED" });
    }
  },
);

router.post(
  "/upload/incorporation-cert-pre-signup",
  preSignupRateLimit,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided", code: "MISSING_FILE" });
      return;
    }
    try {
      const { buffer, mimetype, originalname, size } = req.file;
      const { objectPath } = await uploadToStorage(objectStorageService, buffer, mimetype, size);
      const fileUrl = `/api/storage${objectPath}`;
      res.status(201).json({
        objectPath,
        fileUrl,
        metadata: { name: originalname, size, contentType: mimetype },
      });
    } catch (error) {
      req.log.error({ err: error }, "Pre-signup incorporation cert upload failed");
      res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
    }
  },
);

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
      const { objectPath } = await uploadToStorage(objectStorageService, buffer, mimetype, size);
      await db.insert(userUploads).values({ userId, objectPath });
      const fileUrl = `/api/storage${objectPath}`;
      res.status(201).json({
        objectPath,
        fileUrl,
        metadata: { name: originalname, size, contentType: mimetype },
      });
    } catch (error) {
      req.log.error({ err: error }, "Incorporation cert upload failed");
      res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
    }
  },
);

router.post(
  "/upload/listing-image",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided", code: "MISSING_FILE" });
      return;
    }

    try {
      const { buffer, mimetype, size } = req.file;
      const { objectPath } = await uploadToStorage(objectStorageService, buffer, mimetype, size);
      const fileUrl = `/api/storage${objectPath}`;
      res.status(201).json({ fileUrl, objectPath });
    } catch (error) {
      res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
    }
  },
);

router.post(
  "/upload/dm-image",
  requireAuth,
  uploadImageOnly.single("file"),
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;

    if (!req.file) {
      res.status(400).json({ error: "No file provided", code: "MISSING_FILE" });
      return;
    }

    try {
      const { buffer, mimetype, size } = req.file;
      const { objectPath } = await uploadToStorage(objectStorageService, buffer, mimetype, size);
      await db.insert(userUploads).values({ userId, objectPath }).onConflictDoNothing();
      const fileUrl = `/api/storage${objectPath}`;
      res.status(201).json({ fileUrl, objectPath });
    } catch (error) {
      req.log.error({ err: error }, "DM image upload failed");
      try {
        const fileUrl = inlineImageDataUrl(req.file.buffer, req.file.mimetype);
        res.status(201).json({ fileUrl, objectPath: null, storage: "inline_fallback" });
        return;
      } catch (inlineError) {
        req.log.error({ err: inlineError }, "Inline DM image fallback failed");
      }
      const classified = classifyStorageUploadError(error);
      if (classified) {
        res.status(classified.status).json({ error: classified.error, code: classified.code });
        return;
      }
      res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
    }
  },
);

router.post(
  "/upload/profile-picture",
  requireAuth,
  uploadImageOnly.single("file"),
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;

    if (!req.file) {
      res.status(400).json({ error: "No file provided", code: "MISSING_FILE" });
      return;
    }

    try {
      const { buffer, mimetype, size } = req.file;
      if (objectStorageService.isLocal) {
        const inline = await saveInlineProfilePicture(userId, buffer, mimetype);
        res.status(201).json({ ...inline, objectPath: null });
        return;
      }
      const { objectPath } = await uploadToStorage(objectStorageService, buffer, mimetype, size, "avatars");

      const fileUrl = `/api/storage${objectPath}`;
      await Promise.all([
        db.insert(userUploads).values({ userId, objectPath }),
        db.update(profiles).set({ avatarUrl: fileUrl }).where(eq(profiles.id, userId)),
      ]);

      res.status(201).json({ fileUrl, objectPath });
    } catch (error) {
      req.log.error({ err: error }, "Profile picture upload failed");
      try {
        const inline = await saveInlineProfilePicture(userId, req.file.buffer, req.file.mimetype);
        res.status(201).json({ ...inline, objectPath: null });
        return;
      } catch (inlineError) {
        req.log.error({ err: inlineError }, "Inline profile picture fallback failed");
      }
      const classified = classifyStorageUploadError(error);
      if (classified) {
        res.status(classified.status).json({ error: classified.error, code: classified.code });
        return;
      }
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
  if (
    err instanceof Error &&
    (err.message === "Only PDF and image files are accepted" || err.message === "Only image files are accepted")
  ) {
    res.status(415).json({ error: err.message, code: "INVALID_FILE_TYPE" });
    return;
  }
  res.status(500).json({ error: "Upload failed. Please try again.", code: "UPLOAD_FAILED" });
});

export default router;
