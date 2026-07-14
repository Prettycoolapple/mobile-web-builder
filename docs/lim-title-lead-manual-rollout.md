# Human-managed LIM/Title lead rollout

The active workflow records buyer-consented LIM/title requests for an admin to
action manually. Project Alpha does not automatically send a lead notification
to the listing agent.

## Production preparation

1. Run `pnpm --filter @workspace/db add-lim-title-leads` against production.
   The migration is idempotent and adds the prompt-allocation and admin tracking
   fields while disabling any legacy queued lead deliveries.
2. Configure Vercel production with:
   - `LIM_TITLE_FEATURE_ENABLED=true`
   - `LIM_TITLE_PROACTIVE_ENABLED=true`
   - `LIM_TITLE_SMS_ENABLED=false`
3. Keep `PUBLIC_APP_URL` set to the real production HTTPS origin.
4. Leave `LEAD_SHORT_BASE_URL` unset. It is not used by the manual workflow.
5. `TWILIO_AUTH_TOKEN` is not needed for LIM/title leads. Preserve the existing
   `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, and
   `TWILIO_PHONE_NUMBER` because phone OTP verification still uses them.

## Admin process

1. Open **LIM/Title Leads** and work from the oldest open lead that has not yet
   been contacted.
2. Use the displayed listing-agent name, mobile, buyer details, and property
   address to send the agent a manual SMS.
3. Mark **Agent SMS sent**. This stores the time of the manual action.
4. When the agent signs up with the same OTP-verified mobile, the lead is
   attached to their account and the buyer-authored facilitator message appears
   in their existing or newly created conversation.
5. The green reply tick is automatic and reflects the first in-app agent reply
   after that request. External calls, SMS, and email do not trigger it.
6. Mark **LIM/title delivered** once delivery is confirmed, including delivery
   outside the in-app chat.

Sales-agent histories are visible but read-only in **Message Hub**. Admins can
continue replying as the existing demo service-provider accounts.

## Rollback

Set `LIM_TITLE_FEATURE_ENABLED=false` and redeploy. This disables proactive and
organic LIM/title lead creation without affecting analysis, property listings,
service-provider recommendations, account login, OTP, or existing messages.
