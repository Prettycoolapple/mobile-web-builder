import { Storage, File } from "@google-cloud/storage";
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
