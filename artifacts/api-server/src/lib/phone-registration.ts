import { and, eq, sql } from "drizzle-orm";
import { phoneRegistrationHistory, profiles } from "@workspace/db";

export type RegistrationRole = "general" | "sales_agent" | "service_provider";

export type PhoneRegistrationBlock =
  | { allowed: true }
  | {
      allowed: false;
      code: "PHONE_ROLE_TAKEN" | "PHONE_REGISTRATION_BLOCKED" | "PHONE_PERMANENTLY_BANNED";
      message: string;
      status: 409 | 429;
      retryAfterSeconds?: number;
      blockedUntil?: Date | null;
    };

const DELETE_COOLDOWNS_MS = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

const ROLE_LABELS: Record<RegistrationRole, string> = {
  general: "general user",
  sales_agent: "sales agent",
  service_provider: "service provider",
};

export function normalizeRegistrationPhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "").trim();
}

export function deletionCooldownMs(nextDeletedAccountCount: number): number | null {
  if (nextDeletedAccountCount >= 4) return null;
  return DELETE_COOLDOWNS_MS[Math.max(0, nextDeletedAccountCount - 1)] ?? DELETE_COOLDOWNS_MS[DELETE_COOLDOWNS_MS.length - 1];
}

export function buildPhoneRegistrationBlock(args: {
  phoneNumber: string;
  role: RegistrationRole;
  existingRoleTaken?: boolean;
  blockedUntil?: Date | null;
  permanentlyBanned?: boolean;
  now?: Date;
}): PhoneRegistrationBlock {
  const now = args.now ?? new Date();
  if (args.permanentlyBanned) {
    return {
      allowed: false,
      code: "PHONE_PERMANENTLY_BANNED",
      status: 429,
      message: "This phone number is permanently blocked from registration due to repeated account deletions.",
      blockedUntil: null,
    };
  }
  if (args.blockedUntil && args.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((args.blockedUntil.getTime() - now.getTime()) / 1000));
    return {
      allowed: false,
      code: "PHONE_REGISTRATION_BLOCKED",
      status: 429,
      message: `This phone number is temporarily blocked from registration. Try again after ${args.blockedUntil.toISOString()}.`,
      retryAfterSeconds,
      blockedUntil: args.blockedUntil,
    };
  }
  if (args.existingRoleTaken) {
    return {
      allowed: false,
      code: "PHONE_ROLE_TAKEN",
      status: 409,
      message: `This phone number already has a ${ROLE_LABELS[args.role]} account.`,
    };
  }
  return { allowed: true };
}

type DbExecutor = {
  execute: (query: unknown) => Promise<unknown>;
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
  delete?: (...args: any[]) => any;
  insert?: (...args: any[]) => any;
};

export async function lockPhoneRegistration(tx: Pick<DbExecutor, "execute">, phoneNumber: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneNumber}, 0))`);
}

export async function checkPhoneCanRegister(
  tx: DbExecutor,
  phoneNumber: string,
  role: RegistrationRole,
  now = new Date(),
  excludeProfileId?: string | null,
): Promise<PhoneRegistrationBlock> {
  await lockPhoneRegistration(tx, phoneNumber);

  const [history] = await tx
    .select({
      blockedUntil: phoneRegistrationHistory.blockedUntil,
      permanentlyBanned: phoneRegistrationHistory.permanentlyBanned,
    })
    .from(phoneRegistrationHistory)
    .where(eq(phoneRegistrationHistory.phoneNumber, phoneNumber))
    .limit(1);

  const historyBlock = buildPhoneRegistrationBlock({
    phoneNumber,
    role,
    blockedUntil: history?.blockedUntil ?? null,
    permanentlyBanned: Boolean(history?.permanentlyBanned),
    now,
  });
  if (!historyBlock.allowed) return historyBlock;

  const existing = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(
      eq(profiles.phoneNumber, phoneNumber),
      eq(profiles.role, role),
      excludeProfileId ? sql`${profiles.id} <> ${excludeProfileId}` : sql`true`,
    ))
    .limit(1);

  return buildPhoneRegistrationBlock({
    phoneNumber,
    role,
    existingRoleTaken: existing.length > 0,
    now,
  });
}

export async function recordPhoneAccountDeletion(
  tx: Pick<DbExecutor, "execute">,
  phoneNumber: string | null | undefined,
  role: string | null | undefined,
  now = new Date(),
): Promise<void> {
  if (!phoneNumber || !role) return;
  await lockPhoneRegistration(tx, phoneNumber);
  await tx.execute(sql`
    INSERT INTO phone_registration_history (
      phone_number,
      deleted_account_count,
      blocked_until,
      permanently_banned,
      last_deleted_at,
      last_deleted_role,
      created_at,
      updated_at
    )
    VALUES (
      ${phoneNumber},
      1,
      ${now}::timestamptz + interval '1 hour',
      false,
      ${now},
      ${role},
      now(),
      now()
    )
    ON CONFLICT (phone_number) DO UPDATE SET
      deleted_account_count = phone_registration_history.deleted_account_count + 1,
      blocked_until = CASE
        WHEN phone_registration_history.deleted_account_count + 1 >= 4 THEN NULL
        WHEN phone_registration_history.deleted_account_count + 1 = 3 THEN ${now}::timestamptz + interval '7 days'
        WHEN phone_registration_history.deleted_account_count + 1 = 2 THEN ${now}::timestamptz + interval '24 hours'
        ELSE ${now}::timestamptz + interval '1 hour'
      END,
      permanently_banned = CASE
        WHEN phone_registration_history.deleted_account_count + 1 >= 4 THEN true
        ELSE phone_registration_history.permanently_banned
      END,
      last_deleted_at = ${now},
      last_deleted_role = ${role},
      updated_at = now()
  `);
}
