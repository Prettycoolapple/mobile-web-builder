import { and, eq } from "drizzle-orm";
import {
  db,
  propertyDocuments,
  withDbRetry,
  type PropertyDocumentLinkMethod,
  type PropertyDocumentType,
} from "@workspace/db";
import { deriveLimTitleDeliveryStatus } from "./lim-title-leads";
import { logger } from "./logger";

export const LIM_TITLE_DOCUMENT_TYPES = new Set<PropertyDocumentType>([
  "lim_report",
  "title",
  "combined",
]);

export function isLimTitleDocumentType(value: unknown): value is PropertyDocumentType {
  return typeof value === "string" && LIM_TITLE_DOCUMENT_TYPES.has(value as PropertyDocumentType);
}

export function objectPathFromFileUrl(fileUrl: string): string | null {
  try {
    const path = /^https?:/i.test(fileUrl) ? new URL(fileUrl).pathname : fileUrl;
    const storageIndex = path.indexOf("/api/storage");
    if (storageIndex >= 0) return path.slice(storageIndex + "/api/storage".length);
    if (path.startsWith("/s3/") || path.startsWith("/objects/")) return path;
    const dmFilesIndex = path.indexOf("/dm-files/");
    if (dmFilesIndex >= 0) return `/s3/${path.slice(dmFilesIndex + 1)}`;
  } catch {
  }
  return null;
}

export type CaptureLimTitleDocumentInput = {
  requestId: string;
  messageId: string;
  sourceAgentUserId: string;
  propertyKey: string;
  propertyAddress: string;
  docType: PropertyDocumentType;
  fileUrl: string;
  objectPath?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  fileHash?: string | null;
  linkMethod: PropertyDocumentLinkMethod;
  reuseConsentAt?: Date | null;
  replaceExistingForMessage?: boolean;
};

/** Persist one tagged message in the canonical library, then verify and derive delivery. */
export async function captureLimTitleDocument(input: CaptureLimTitleDocumentInput): Promise<void> {
  try {
    const objectPath = input.objectPath || objectPathFromFileUrl(input.fileUrl) || `inline:${input.messageId}`;
    const now = new Date();
    const row = await withDbRetry(() => db.transaction(async (tx) => {
      if (input.replaceExistingForMessage) {
        await tx.delete(propertyDocuments).where(eq(propertyDocuments.sourceMessageId, input.messageId));
      }
      const values = {
        propertyKey: input.propertyKey,
        propertyAddress: input.propertyAddress,
        docType: input.docType,
        objectPath,
        fileUrl: input.fileUrl,
        fileName: input.fileName ?? null,
        fileMime: input.fileMime ?? null,
        fileSize: input.fileSize ?? null,
        fileHash: input.fileHash?.replace(/^\"|\"$/g, "") || null,
        sourceAgentUserId: input.sourceAgentUserId,
        sourceRequestId: input.requestId,
        sourceMessageId: input.messageId,
        linkMethod: input.linkMethod,
        verificationStatus: "pending" as const,
        verificationJson: null,
        issuedAt: null,
        reuseConsentAt: input.reuseConsentAt ?? now,
        updatedAt: now,
      };
      if (values.fileHash) {
        const [upserted] = await tx.insert(propertyDocuments)
          .values(values)
          .onConflictDoUpdate({
            target: [propertyDocuments.propertyKey, propertyDocuments.fileHash],
            set: {
              fileUrl: values.fileUrl,
              objectPath: values.objectPath,
              fileName: values.fileName,
              fileMime: values.fileMime,
              fileSize: values.fileSize,
              updatedAt: now,
            },
          })
          .returning();
        return upserted;
      }
      const [inserted] = await tx.insert(propertyDocuments).values(values).returning();
      return inserted;
    }));
    if (row) {
      void import("./lim-title-doc-verify").then(({ verifyLimTitleDocument }) =>
        verifyLimTitleDocument(row.id),
      );
    }
    await withDbRetry(() => deriveLimTitleDeliveryStatus(input.requestId));
  } catch (err) {
    logger.warn({ err, requestId: input.requestId, messageId: input.messageId }, "LIM/title document capture failed");
  }
}
