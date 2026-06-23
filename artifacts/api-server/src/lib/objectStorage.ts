import { Storage, File } from "@google-cloud/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { getGoogleCloudProjectId } from "./env";

function hasGcsCredentials(): boolean {
  return !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  );
}

function buildStorageClient(): Storage | null {
  if (!hasGcsCredentials()) return null;

  const projectId = getGoogleCloudProjectId();
  const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (rawJson) {
    try {
      const credentials = JSON.parse(rawJson);
      return new Storage({
        projectId: projectId ?? credentials.project_id,
        credentials,
      });
    } catch (err) {
      console.error(
        "[storage] GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON; falling back to local mode:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  try {
    return new Storage({ projectId });
  } catch (err) {
    console.error(
      "[storage] Failed to initialize Google Cloud Storage client; falling back to local mode:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export const objectStorageClient = buildStorageClient();

const LOCAL_UPLOAD_DIR = path.join(os.tmpdir(), "project-alpha-uploads");

export const isLocalStorageMode = !objectStorageClient;

if (isLocalStorageMode) {
  console.log(`[storage] GCS not configured — using local filesystem at ${LOCAL_UPLOAD_DIR}`);
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  get isLocal(): boolean {
    return isLocalStorageMode;
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Configure one or more bucket paths " +
          "and set PUBLIC_OBJECT_SEARCH_PATHS as a comma-separated list."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    if (isLocalStorageMode) return LOCAL_UPLOAD_DIR;
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error("PRIVATE_OBJECT_DIR not set. Configure a private storage prefix first.");
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (isLocalStorageMode) return null;
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient!.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  // ── Local filesystem helpers ──────────────────────────────────────────

  async saveLocal(
    buffer: Buffer | Uint8Array,
    contentType: string,
    namespace = "uploads",
  ): Promise<{ objectPath: string }> {
    const objectId = randomUUID();
    const ext = contentType.split("/")[1]?.split(";")[0] || "bin";
    const fileName = `${objectId}.${ext}`;
    const dir = path.join(LOCAL_UPLOAD_DIR, namespace);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), buffer);
    const metaPath = path.join(dir, `${fileName}.meta`);
    fs.writeFileSync(metaPath, JSON.stringify({ contentType, size: buffer.length }));
    return { objectPath: `/objects/${namespace}/${fileName}` };
  }

  readLocalFile(objectPath: string): {
    stream: fs.ReadStream;
    contentType: string;
    size: number;
  } {
    if (!objectPath.startsWith("/objects/")) {
      throw new Error(`Invalid object path: must start with /objects/ (got: ${objectPath})`);
    }
    const relative = objectPath.slice("/objects/".length);
    const filePath = path.join(LOCAL_UPLOAD_DIR, relative);
    if (!fs.existsSync(filePath)) throw new ObjectNotFoundError();
    const metaPath = `${filePath}.meta`;
    let contentType = "application/octet-stream";
    let size = 0;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        contentType = meta.contentType ?? contentType;
        size = meta.size ?? 0;
      } catch { /* use defaults */ }
    }
    if (!size) size = fs.statSync(filePath).size;
    return { stream: fs.createReadStream(filePath), contentType, size };
  }

  localFileExists(objectPath: string): boolean {
    if (!objectPath.startsWith("/objects/")) return false;
    const relative = objectPath.slice("/objects/".length);
    return fs.existsSync(path.join(LOCAL_UPLOAD_DIR, relative));
  }

  // ── GCS methods ───────────────────────────────────────────────────────

  async getObjectEntityUploadURL(options?: {
    contentType?: string;
    namespace?: string;
  }): Promise<string> {
    if (isLocalStorageMode) {
      throw new Error("getObjectEntityUploadURL is not available in local storage mode — use saveLocal() instead");
    }
    const privateObjectDir = this.getPrivateObjectDir();
    const namespace = options?.namespace?.trim() || "uploads";
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/${namespace}/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
      contentType: options?.contentType,
    });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (isLocalStorageMode) {
      throw new Error("getObjectEntityFile is not available in local storage mode — use readLocalFile() instead");
    }
    const privateObjectDir = this.getPrivateObjectDir();

    if (!objectPath.startsWith("/objects/")) {
      throw new Error(`Invalid object path: must start with /objects/ (got: ${objectPath})`);
    }

    const entityId = objectPath.slice("/objects/".length);
    const fullPath = `${privateObjectDir}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = objectStorageClient!.bucket(bucketName);
    const objectFile = bucket.file(objectName);

    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
  contentType,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
  contentType?: string;
}): Promise<string> {
  const bucket = objectStorageClient!.bucket(bucketName);
  const file = bucket.file(objectName);
  const action =
    method === "PUT" ? "write" : method === "DELETE" ? "delete" : "read";
  const [signedURL] = await file.getSignedUrl({
    version: "v4",
    action,
    expires: Date.now() + ttlSec * 1000,
    ...(contentType ? { contentType } : {}),
  });

  return signedURL;
}

// ── S3-compatible storage (Cloudflare R2, AWS S3, etc.) ──────────────────────
//
// Configure via these environment variables:
//   S3_ENDPOINT          e.g. https://<account-id>.r2.cloudflarestorage.com
//   S3_ACCESS_KEY_ID     R2 / AWS access key ID
//   S3_SECRET_ACCESS_KEY R2 / AWS secret access key
//   S3_BUCKET_NAME       Bucket name
//   S3_PUBLIC_URL        Optional — public CDN base URL (e.g. https://pub-xxx.r2.dev)
//                        When set, listing images and profile pictures are served
//                        directly from R2 without proxying through the API.
//
// If any of the first four vars are missing the service is disabled and the
// existing GCS / inline fallback chain takes over.

// Namespaces that must go into the private bucket (sensitive documents).
// Everything else (listing-images, avatars, dm-images) uses the public bucket.
const PRIVATE_NAMESPACES = new Set(["listing-documents", "provider-certificates"]);

/** Extract a bucket name from a Supabase/S3 object URL (last path segment). */
function bucketFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
}

export class S3StorageService {
  private client: S3Client | null = null;
  /** Public bucket — listing photos, avatars, DM images. */
  private publicBucket: string = "";
  /** Private bucket — LIM reports, title documents, provider certificates.
   *  Falls back to publicBucket when not configured. */
  private privateBucket: string = "";
  /** Optional CDN / public-access base URL for the public bucket. */
  private publicUrl: string = "";

  constructor() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    const bucketName = process.env.S3_BUCKET_NAME?.trim();

    if (endpoint && accessKeyId && secretAccessKey && bucketName) {
      // S3_REGION defaults to "auto" (works for Cloudflare R2).
      // Supabase and AWS require an explicit region such as "ap-southeast-2".
      const region = process.env.S3_REGION?.trim() || "auto";
      this.client = new S3Client({
        region,
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // Supabase Storage requires path-style URLs (https://host/bucket/key)
        // rather than virtual-hosted style (https://bucket.host/key).
        forcePathStyle: true,
      });
      this.publicBucket = bucketName;
      this.publicUrl = process.env.S3_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";

      // Private bucket: use S3_PRIVATE_BUCKET_NAME if set; otherwise parse the
      // bucket name from S3_PRIVATE_URL (last path segment, e.g. "documents").
      this.privateBucket =
        process.env.S3_PRIVATE_BUCKET_NAME?.trim() ||
        bucketFromUrl(process.env.S3_PRIVATE_URL?.trim() ?? "") ||
        "";

      console.log(
        `[storage] S3-compatible storage configured` +
        ` (public bucket: ${this.publicBucket}` +
        `, private bucket: ${this.privateBucket || `none — using "${this.publicBucket}"`}` +
        `, region: ${region}` +
        `, public URL: ${this.publicUrl || "none — using API proxy"})`,
      );
    } else {
      console.log("[storage] S3-compatible storage not configured — set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME to enable");
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Resolve which bucket a given namespace should use. */
  private resolveBucket(namespace: string): string {
    return PRIVATE_NAMESPACES.has(namespace) && this.privateBucket
      ? this.privateBucket
      : this.publicBucket;
  }

  /**
   * Upload a file buffer to S3/R2.
   *
   * Automatically routes to the private bucket for sensitive namespaces
   * (listing-documents, provider-certificates) and to the public bucket for
   * everything else (listing-images, avatars, dm-images).
   *
   * Returns:
   *   objectPath  — internal path for API-proxied serving: /s3/<namespace>/<key>
   *   fileUrl     — where clients load the file from:
   *                 • Public namespace + S3_PUBLIC_URL set → direct CDN URL
   *                 • Otherwise → /api/storage/s3/<namespace>/<key> (API proxy)
   */
  async upload(
    buffer: Buffer | Uint8Array,
    mimetype: string,
    namespace: string,
  ): Promise<{ objectPath: string; fileUrl: string }> {
    if (!this.client) throw new Error("S3 storage is not configured");

    const bucket = this.resolveBucket(namespace);
    const isPrivate = PRIVATE_NAMESPACES.has(namespace);
    const ext = mimetype.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "bin";
    const key = `${namespace}/${randomUUID()}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(buffer),
        ContentType: mimetype,
        ContentLength: buffer.length,
      }),
    );

    const objectPath = `/s3/${key}`;
    // Private files always go through the authenticated API proxy.
    // Public files use the CDN URL when S3_PUBLIC_URL is set.
    const fileUrl =
      !isPrivate && this.publicUrl
        ? `${this.publicUrl}/${key}`
        : `/api/storage/s3/${key}`;

    return { objectPath, fileUrl };
  }

  /**
   * Generate a presigned PUT URL so clients can upload DIRECTLY to S3/R2,
   * bypassing the API server entirely. This is essential on serverless hosts
   * (e.g. Vercel) where routing the file body through a function hits the
   * ~4.5MB request-body cap (FUNCTION_PAYLOAD_TOO_LARGE / 413).
   *
   * The client must PUT with the exact `Content-Type` returned here, since it
   * is part of the signature. Returns the same `objectPath` (`/s3/<key>`) and
   * `fileUrl` shape as `upload()` so the rest of the pipeline is identical.
   */
  async getPresignedUploadUrl(options: {
    contentType: string;
    namespace: string;
    expiresInSec?: number;
  }): Promise<{ uploadURL: string; objectPath: string; fileUrl: string }> {
    if (!this.client) throw new Error("S3 storage is not configured");

    const { contentType, namespace } = options;
    const bucket = this.resolveBucket(namespace);
    const ext = contentType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "bin";
    const key = `${namespace}/${randomUUID()}.${ext}`;

    const uploadURL = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: options.expiresInSec ?? 900 },
    );

    return { uploadURL, objectPath: `/s3/${key}`, fileUrl: this.fileUrlForObjectPath(`/s3/${key}`) };
  }

  /** Map an `/s3/<key>` objectPath back to its storage key, or null if not an S3 path. */
  keyForObjectPath(objectPath: string): string | null {
    return objectPath.startsWith("/s3/") ? objectPath.slice("/s3/".length) : null;
  }

  /** Resolve the client-facing fileUrl for a stored `/s3/<key>` objectPath. */
  fileUrlForObjectPath(objectPath: string): string {
    const key = this.keyForObjectPath(objectPath) ?? "";
    const namespace = key.split("/")[0] ?? "";
    const isPrivate = PRIVATE_NAMESPACES.has(namespace);
    return !isPrivate && this.publicUrl ? `${this.publicUrl}/${key}` : `/api/storage/s3/${key}`;
  }

  /**
   * Download a file for API-proxied serving.
   * Automatically selects the correct bucket based on the namespace prefix in the key.
   */
  async download(key: string, cacheTtlSec = 3600): Promise<Response> {
    if (!this.client) throw new Error("S3 storage is not configured");

    // Key format: <namespace>/<uuid>.<ext> — extract namespace to pick bucket.
    const namespace = key.split("/")[0] ?? "";
    const bucket = this.resolveBucket(namespace);

    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

    const contentType = result.ContentType ?? "application/octet-stream";
    const contentLength = result.ContentLength;

    const body = result.Body as ReadableStream | undefined;
    if (!body) throw new ObjectNotFoundError();

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (contentLength) headers["Content-Length"] = String(contentLength);

    return new Response(body, { headers });
  }

  /**
   * Apply a CORS policy to the configured bucket(s) so browsers can PUT files
   * directly to a presigned URL from the given origins. Without this, the
   * cross-origin PUT from the web portals is blocked and uploads fall back to
   * the multipart endpoint (which hits the serverless body cap). Native apps
   * are unaffected — they don't enforce CORS.
   *
   * Returns the bucket names it configured.
   */
  async configureCors(origins: string[], allowedMethods: string[] = ["GET", "PUT", "HEAD"]): Promise<string[]> {
    if (!this.client) throw new Error("S3 storage is not configured");
    const buckets = Array.from(
      new Set([this.publicBucket, this.privateBucket].filter((b): b is string => !!b)),
    );
    const corsConfiguration = {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: allowedMethods,
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    };
    for (const Bucket of buckets) {
      await this.client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: corsConfiguration }));
    }
    return buckets;
  }

  /** Check if a key exists without downloading it. */
  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    const namespace = key.split("/")[0] ?? "";
    const bucket = this.resolveBucket(namespace);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

export const s3StorageService = new S3StorageService();
