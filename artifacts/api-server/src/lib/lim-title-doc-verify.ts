import { createHash } from "node:crypto";
// Import the library entry directly. The package's top-level index contains a
// CLI/debug branch that reads ./test/data when test runners bundle it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { and, eq } from "drizzle-orm";
import {
  db,
  propertyDocuments,
  withDbRetry,
  type PropertyDocument,
  type PropertyDocumentType,
} from "@workspace/db";
import { normaliseAddressKey } from "./address-key";
import { logger } from "./logger";
import { ObjectStorageService, s3StorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadDocument(row: PropertyDocument): Promise<Buffer> {
  if (row.objectPath.startsWith("/s3/")) {
    const key = s3StorageService.keyForObjectPath(row.objectPath);
    if (!key) throw new Error("Invalid S3 object path");
    const response = await s3StorageService.download(key, 0);
    return Buffer.from(await response.arrayBuffer());
  }
  if (row.objectPath.startsWith("/objects/")) {
    if (objectStorageService.isLocal) {
      return streamToBuffer(objectStorageService.readLocalFile(row.objectPath).stream);
    }
    const file = await objectStorageService.getObjectEntityFile(row.objectPath);
    const response = await objectStorageService.downloadObject(file, 0);
    return Buffer.from(await response.arrayBuffer());
  }
  if (row.fileUrl.startsWith("data:")) {
    const comma = row.fileUrl.indexOf(",");
    if (comma < 0) throw new Error("Invalid inline document URL");
    return Buffer.from(row.fileUrl.slice(comma + 1), "base64");
  }
  throw new Error("Unsupported document storage path");
}

function classifyDocument(text: string): {
  docType: PropertyDocumentType | null;
  markers: string[];
  titleIdentifier: string | null;
} {
  const markers: string[] = [];
  const lim = /LAND\s+INFORMATION\s+MEMORANDUM/i.test(text);
  const recordOfTitle = /RECORD\s+OF\s+TITLE/i.test(text);
  const identifierMatch = text.match(
    /\bIDENTIFIER\b[\s\S]{0,100}?\b([A-Z]{1,3}\d{1,6}\/\d{1,6}|\d{4,9})\b/i,
  );
  const title = recordOfTitle || Boolean(identifierMatch);
  if (lim) markers.push("LAND INFORMATION MEMORANDUM");
  if (recordOfTitle) markers.push("RECORD OF TITLE");
  if (identifierMatch) markers.push("IDENTIFIER");
  return {
    docType: lim && title ? "combined" : lim ? "lim_report" : title ? "title" : null,
    markers,
    titleIdentifier: identifierMatch?.[1] ?? null,
  };
}

function extractIssueDate(text: string): { raw: string | null; date: Date | null } {
  const match = text.match(
    /(?:DATE\s+ISSUED|SEARCH\s+COPY\s+DATED|ISSUE\s+DATE)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
  ) ?? text.slice(0, 2500).match(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\b/);
  const raw = match?.[1] ?? null;
  if (!raw) return { raw: null, date: null };
  const [day, month, yearRaw] = raw.split(/[\/.\-]/).map(Number);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return { raw, date: null };
  return { raw, date };
}

function addressMatch(text: string, propertyAddress: string, propertyKey: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => /\d/.test(line) && /[A-Za-z]/.test(line)).slice(0, 80);
  const exact = candidates.find((line) => {
    const key = normaliseAddressKey(line);
    return key === propertyKey || key.includes(propertyKey) || propertyKey.includes(key);
  });
  if (exact) return { matched: true, extractedAddress: exact };

  const tokens: string[] = propertyAddress
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? ([] as string[]);
  const meaningful = Array.from(new Set(tokens.filter((token) => token.length > 1)));
  const lowerText = text.toLowerCase();
  const hitCount = meaningful.filter((token) => new RegExp(`\\b${token}\\b`, "i").test(lowerText)).length;
  const number = meaningful.find((token) => /^\d+[a-z]?$/.test(token));
  const matched = meaningful.length > 0 && (!number || lowerText.includes(number)) && hitCount / meaningful.length >= 0.7;
  return { matched, extractedAddress: matched ? candidates[0] ?? propertyAddress : candidates[0] ?? null };
}

/** Best-effort, compute-only verification. This must never be awaited by the DM send path. */
export async function verifyLimTitleDocument(documentId: string): Promise<void> {
  try {
    const [row] = await withDbRetry(() =>
      db.select().from(propertyDocuments).where(eq(propertyDocuments.id, documentId)).limit(1),
    );
    if (!row || row.verificationStatus === "rejected" || row.verificationStatus === "admin_confirmed") return;

    const bytes = await downloadDocument(row);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const parsed = await pdfParse(bytes, { max: 2 });
    const text = parsed.text?.trim() ?? "";
    if (text.length < 30) {
      await withDbRetry(() =>
        db.update(propertyDocuments)
          .set({
            verificationStatus: "no_text_layer",
            verificationJson: { sha256, matchedMarkers: [] },
            updatedAt: new Date(),
          })
          .where(and(eq(propertyDocuments.id, documentId), eq(propertyDocuments.verificationStatus, "pending"))),
      );
      return;
    }

    const classification = classifyDocument(text);
    const address = addressMatch(text, row.propertyAddress, row.propertyKey);
    const issue = extractIssueDate(text);
    const typeMatches = classification.docType === "combined"
      ? true
      : classification.docType === row.docType;
    const verificationStatus = address.matched && classification.docType && typeMatches ? "text_match" : "mismatch";
    await withDbRetry(() =>
      db.update(propertyDocuments)
        .set({
          verificationStatus,
          verificationJson: {
            classifiedDocType: classification.docType,
            extractedAddress: address.extractedAddress,
            titleIdentifier: classification.titleIdentifier,
            issueDate: issue.raw,
            matchedMarkers: classification.markers,
            sha256,
          },
          issuedAt: issue.date,
          updatedAt: new Date(),
        })
        .where(and(eq(propertyDocuments.id, documentId), eq(propertyDocuments.verificationStatus, "pending"))),
    );
  } catch (err) {
    logger.warn({ err, documentId }, "LIM/title document verification failed");
    await withDbRetry(() =>
      db.update(propertyDocuments)
        .set({
          verificationJson: { error: err instanceof Error ? err.message : String(err) },
          updatedAt: new Date(),
        })
        .where(and(eq(propertyDocuments.id, documentId), eq(propertyDocuments.verificationStatus, "pending"))),
    ).catch(() => undefined);
  }
}
