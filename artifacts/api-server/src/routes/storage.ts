import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db, userUploads, profiles, dmMessages, dmThreads } from "@workspace/db";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, s3StorageService } from "../lib/objectStorage";
import { requireAuth } from "../lib/auth";
import { verifyStorageReviewToken } from "../lib/storage-review-token";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    if (objectStorageService.isLocal) {
      res.status(501).json({ error: "Signed URL upload not available in local storage mode" });
      return;
    }
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = wildcardPath.startsWith("objects/")
      ? `/${wildcardPath}`
      : `/objects/${wildcardPath}`;

    const [ownerRecord] = await db
      .select({ userId: userUploads.userId })
      .from(userUploads)
      .where(eq(userUploads.objectPath, objectPath))
      .limit(1);

    if (!ownerRecord || ownerRecord.userId !== userId) {
      const canonicalStorageUrl = `/api/storage${objectPath}`;
      const [avatarMatch] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.avatarUrl, canonicalStorageUrl))
        .limit(1);

      let allowed = !!avatarMatch;
      // DM attachments: multipart uploads omit user_uploads. Allow either participant
      // to read blobs linked from dm_messages.image_url or dm_messages.file_url.
      if (!allowed) {
        const [dmAccess] = await db
          .select({ id: dmMessages.id })
          .from(dmMessages)
          .innerJoin(dmThreads, eq(dmMessages.threadId, dmThreads.id))
          .where(
            and(
              or(
                and(isNotNull(dmMessages.imageUrl), eq(dmMessages.imageUrl, canonicalStorageUrl)),
                and(isNotNull(dmMessages.fileUrl), eq(dmMessages.fileUrl, canonicalStorageUrl)),
              ),
              or(eq(dmThreads.participantA, userId), eq(dmThreads.participantB, userId)),
            ),
          )
          .limit(1);
        allowed = !!dmAccess;
      }

      if (!allowed) {
        res.status(403).json({ error: "Access denied", code: "FORBIDDEN" });
        return;
      }
    }

    if (objectStorageService.isLocal || objectStorageService.localFileExists(objectPath)) {
      const { stream, contentType, size } = objectStorageService.readLocalFile(objectPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (size) res.setHeader("Content-Length", String(size));
      stream.pipe(res);
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// Authenticated proxy for S3/R2 private objects (documents etc.)
// Public listing images served via S3_PUBLIC_URL never hit this route.
router.get("/storage/s3/*key", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.key;
    const key = Array.isArray(raw) ? raw.join("/") : raw;

    if (!s3StorageService.isConfigured) {
      res.status(503).json({ error: "S3 storage is not configured.", code: "STORAGE_NOT_CONFIGURED" });
      return;
    }

    const response = await s3StorageService.download(key);
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found.", code: "NOT_FOUND" });
      return;
    }
    req.log.error({ err: error }, "Error serving S3 object");
    res.status(500).json({ error: "Failed to serve file.", code: "SERVE_FAILED" });
  }
});

router.get("/storage/review/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const token = typeof req.query.token === "string" ? req.query.token : undefined;

    if (!verifyStorageReviewToken(token, objectPath)) {
      res.status(403).json({ error: "Access denied", code: "FORBIDDEN" });
      return;
    }

    if (objectStorageService.isLocal || objectStorageService.localFileExists(objectPath)) {
      const { stream, contentType, size } = objectStorageService.readLocalFile(objectPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      if (size) res.setHeader("Content-Length", String(size));
      stream.pipe(res);
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile, 300);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found", code: "OBJECT_NOT_FOUND" });
      return;
    }
    req.log.error({ err: error }, "Error serving review object");
    res.status(500).json({ error: "Failed to serve object", code: "OBJECT_SERVE_FAILED" });
  }
});

export default router;
