import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { limTitleRequests } from "./lim_title_requests";
import { dmMessages } from "./dm_messages";

export type PropertyDocumentType = "lim_report" | "title" | "combined";
export type PropertyDocumentLinkMethod =
  | "auto_single_open"
  | "agent_picker"
  | "card_upload"
  | "admin";
export type PropertyDocumentVerificationStatus =
  | "pending"
  | "text_match"
  | "mismatch"
  | "no_text_layer"
  | "admin_confirmed"
  | "rejected";

export type PropertyDocumentVerification = {
  classifiedDocType?: PropertyDocumentType | null;
  extractedAddress?: string | null;
  titleIdentifier?: string | null;
  issueDate?: string | null;
  matchedMarkers?: string[];
  sha256?: string;
  error?: string;
};

/** Canonical, reusable LIM/title library keyed by the normalized property address. */
export const propertyDocuments = pgTable(
  "property_documents",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    propertyKey: text("property_key").notNull(),
    propertyAddress: text("property_address").notNull(),
    docType: text("doc_type").$type<PropertyDocumentType>().notNull(),
    objectPath: text("object_path").notNull(),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name"),
    fileMime: text("file_mime"),
    fileSize: bigint("file_size", { mode: "number" }),
    fileHash: text("file_hash"),
    sourceAgentUserId: text("source_agent_user_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    sourceRequestId: text("source_request_id").references(
      () => limTitleRequests.id,
      { onDelete: "set null" },
    ),
    sourceMessageId: text("source_message_id").references(
      () => dmMessages.id,
      { onDelete: "set null" },
    ),
    linkMethod: text("link_method").$type<PropertyDocumentLinkMethod>().notNull(),
    verificationStatus: text("verification_status")
      .$type<PropertyDocumentVerificationStatus>()
      .default("pending")
      .notNull(),
    verificationJson: jsonb("verification_json").$type<PropertyDocumentVerification>(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    reuseConsentAt: timestamp("reuse_consent_at", { withTimezone: true }),
    supersededById: text("superseded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("property_documents_property_hash_unique").on(
      table.propertyKey,
      table.fileHash,
    ),
    index("property_documents_property_type_idx").on(
      table.propertyKey,
      table.docType,
    ),
    index("property_documents_source_request_idx").on(table.sourceRequestId),
  ],
);

export type PropertyDocument = typeof propertyDocuments.$inferSelect;
export type InsertPropertyDocument = typeof propertyDocuments.$inferInsert;
