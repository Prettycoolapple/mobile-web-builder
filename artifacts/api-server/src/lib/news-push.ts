import { pool } from "@workspace/db";
import { logger } from "./logger";

type ExpoTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts";

export async function runNewsDispatch(): Promise<{ claimed: number; accepted: number; failed: number }> {
  // An expired in-flight lease is intentionally not retried: Expo has no
  // idempotency key, so a worker crash after acceptance would otherwise risk a
  // duplicate notification. Admins can explicitly requeue these unknown rows.
  await pool.query(`update news_post_deliveries set status='unknown',lease_expires_at=null,last_error_code='LEASE_EXPIRED_AMBIGUOUS',last_error_message='Worker ended before the Expo result was recorded' where status='dispatching' and lease_expires_at < now()`);
  const client = await pool.connect();
  let rows: Array<{ id: string; token: string; locale: string; titleEn: string; titleZh: string; postId: string }> = [];
  try {
    await client.query("begin");
    const claimed = await client.query<{
      id: string; token: string; locale: string; title_en: string; title_zh: string; post_id: string;
    }>(`
      with candidates as (
        select d.id
        from news_post_deliveries d
        join push_tokens t on t.id = d.push_token_id
        where d.status = 'queued'
        order by d.created_at
        for update of d skip locked
        limit 100
      )
      update news_post_deliveries d
      set status = 'dispatching', lease_expires_at = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
      from candidates c, push_tokens t, news_posts p
      where d.id = c.id and t.id = d.push_token_id and p.id = d.post_id
      returning d.id, t.token, d.locale, p.title_en, p.title_zh, d.post_id
    `);
    rows = claimed.rows.map((row) => ({
      id: row.id,
      token: row.token,
      locale: row.locale,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      postId: row.post_id,
    }));
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (rows.length === 0) return { claimed: 0, accepted: 0, failed: 0 };
  let tickets: ExpoTicket[];
  try {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows.map((row) => ({
        to: row.token,
        title: row.locale === "zh" ? row.titleZh : row.titleEn,
        sound: "default",
        data: { type: "news_post", postId: row.postId },
      }))),
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      await markAmbiguous(rows.map((row) => row.id), `HTTP_${response.status}`, message);
      return { claimed: rows.length, accepted: 0, failed: rows.length };
    }
    const payload = await response.json() as { data?: ExpoTicket[] };
    tickets = payload.data ?? [];
  } catch (err) {
    await markAmbiguous(rows.map((row) => row.id), "NETWORK_AMBIGUOUS", err instanceof Error ? err.message : String(err));
    return { claimed: rows.length, accepted: 0, failed: rows.length };
  }

  let accepted = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const ticket = tickets[i];
    if (ticket?.status === "ok" && ticket.id) {
      accepted += 1;
      await pool.query(
        `update news_post_deliveries set status='ticket_ok', expo_ticket_id=$2, dispatched_at=now(), lease_expires_at=null, last_error_code=null, last_error_message=null where id=$1 and status='dispatching'`,
        [row.id, ticket.id],
      );
    } else {
      const code = ticket?.details?.error ?? "EXPO_TICKET_ERROR";
      await pool.query(
        `update news_post_deliveries set status='ticket_error', dispatched_at=now(), lease_expires_at=null, last_error_code=$2, last_error_message=$3 where id=$1 and status='dispatching'`,
        [row.id, code, ticket?.message ?? "Expo did not return a ticket"],
      );
      if (code === "DeviceNotRegistered") await pool.query(`delete from push_tokens where token=$1`, [row.token]);
    }
  }
  await refreshPostStatuses();
  return { claimed: rows.length, accepted, failed: rows.length - accepted };
}

async function markAmbiguous(ids: string[], code: string, message: string): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `update news_post_deliveries set status='unknown', lease_expires_at=null, last_error_code=$2, last_error_message=$3 where id = any($1::text[]) and status='dispatching'`,
    [ids, code, message],
  );
  await refreshPostStatuses();
}

export async function runNewsReceiptCheck(): Promise<{ checked: number; ok: number; failed: number }> {
  const result = await pool.query<{ id: string; expo_ticket_id: string; push_token_id: string | null }>(`
    select id, expo_ticket_id, push_token_id
    from news_post_deliveries
    where status='ticket_ok' and dispatched_at <= now() - interval '15 minutes'
    order by dispatched_at limit 1000
  `);
  if (result.rows.length === 0) return { checked: 0, ok: 0, failed: 0 };

  let receipts: Record<string, ExpoTicket>;
  try {
    const response = await fetch(RECEIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: result.rows.map((row) => row.expo_ticket_id) }),
    });
    if (!response.ok) throw new Error(`Receipt HTTP ${response.status}`);
    const payload = await response.json() as { data?: Record<string, ExpoTicket> };
    receipts = payload.data ?? {};
  } catch (err) {
    logger.warn({ err }, "News push receipt check failed");
    return { checked: 0, ok: 0, failed: 0 };
  }

  let ok = 0;
  let failed = 0;
  for (const row of result.rows) {
    const receipt = receipts[row.expo_ticket_id];
    if (!receipt) continue;
    const success = receipt.status === "ok";
    if (success) ok += 1; else failed += 1;
    const code = receipt.details?.error ?? null;
    await pool.query(
      `update news_post_deliveries set status=$2, receipt_checked_at=now(), last_error_code=$3, last_error_message=$4 where id=$1 and status='ticket_ok'`,
      [row.id, success ? "receipt_ok" : "receipt_error", code, receipt.message ?? null],
    );
    if (code === "DeviceNotRegistered" && row.push_token_id) {
      await pool.query(`delete from push_tokens where id=$1`, [row.push_token_id]);
    }
  }
  await refreshPostStatuses();
  return { checked: ok + failed, ok, failed };
}

async function refreshPostStatuses(): Promise<void> {
  await pool.query(`
    update news_posts p set status = summary.next_status,
      published_at = case when summary.next_status in ('sent','partially_failed') then coalesce(p.published_at, now()) else p.published_at end,
      updated_at = now()
    from (
      select post_id,
        case
          when bool_or(status in ('queued','dispatching','ticket_ok')) then 'sending'
          when bool_or(status in ('ticket_error','receipt_error','unknown')) then 'partially_failed'
          else 'sent'
        end as next_status
      from news_post_deliveries group by post_id
    ) summary
    where p.id=summary.post_id and p.status in ('queued','sending','partially_failed')
  `);
}
