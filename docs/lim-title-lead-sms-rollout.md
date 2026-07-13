# LIM/Title lead SMS rollout

The code keeps lead SMS disabled until `LIM_TITLE_SMS_ENABLED=true`. The in-app
lead, consent, matching, and messaging flow can be tested while SMS is disabled.

## Pilot configuration

1. Run `pnpm --filter @workspace/db add-lim-title-leads` against the target database.
2. Set `PUBLIC_APP_URL` to the public HTTPS website origin.
3. Set `LEAD_SHORT_BASE_URL` to a branded short HTTPS path, ideally no longer
   than `https://projectalpha.nz/l`. The formatter keeps an explicit HTTPS link
   and refuses to send if the result cannot fit one 160-septet GSM-7 segment.
4. Set `TWILIO_AUTH_TOKEN` in addition to the existing account SID, API key,
   API secret, and sending number.
5. Configure the Twilio number's incoming-message webhook as:
   `POST {PUBLIC_APP_URL}/api/webhooks/twilio/inbound`.
6. Ensure Twilio can reach the delivery callback:
   `POST {PUBLIC_APP_URL}/api/webhooks/twilio/sms-status`.
7. Exercise STOP, START, HELP, delivered, failed, and undelivered callbacks with
   internal numbers. Invalid webhook signatures must receive HTTP 403.
8. Keep `LIM_TITLE_SMS_ENABLED=false` until the dedicated NZ short code,
   free-to-recipient unsubscribe path, and legal consent basis are confirmed.
   Then enable it only for the approved pilot.
9. Schedule `/api/cron/lead-sms-retry` at least every ten minutes with
   `Authorization: Bearer {CRON_SECRET}`. The checked-in Vercel schedule does this.
10. Monitor `/api/admin/lim-title-leads/summary` and
    `/api/admin/lim-title-leads?limit=100` with an admin token.

The exact outbound template is:

> Project Alpha: Hi {firstName}, buyer wants LIM/title: {shortAddress}. Lead: {shortUrl}.
> STOP=opt out. Reply to this SMS will be charged

No buyer identity or contact detail is present in the SMS or exposed by the
short-link token. An agent must sign in and OTP-verify the exact recipient phone
before the lead is attached to their account.

## Actions before broad production use

- Obtain New Zealand legal advice confirming the consent or deemed-consent basis
  for sending a relevant buyer enquiry to a publicly listed business mobile.
- Update the Privacy Policy and Terms to describe the buyer's explicit contact
  disclosure and the listing agent notification.
- Provision a dedicated New Zealand short code. Twilio currently describes this
  as an NZ operator requirement and quotes a 5-6 week provisioning time; do not
  treat an ordinary long code as a production fallback.
- Confirm opt-out replies are free to recipients, despite the carrier-mandated
  message wording, and that suppression records are retained and honoured
  across sender changes. DIA says a commercial TXT unsubscribe must be free.
- Obtain written approval for the consent basis. The implementation preserves
  the public listing source and restricts messages to that agent's active
  listing, but Twilio recommends end-user opt-in and this code cannot by itself
  decide whether deemed consent applies to a particular listing publication.
- Define reasonable New Zealand sending hours, retention periods, incident
  handling, and a monitored compliance/help contact. The implementation currently
  queues outbound lead messages outside 08:00–20:00 Pacific/Auckland.
- Keep evidence of the listing source, published agent phone, property relevance,
  buyer consent timestamp, delivery status, and opt-out state.

Current references:

- Twilio New Zealand SMS Guidelines: https://www.twilio.com/en-us/guidelines/nz/sms
- NZ Department of Internal Affairs spam law: https://www.dia.govt.nz/Spam-NZ-Spam-Law
- DIA three-step compliance guide: https://www.dia.govt.nz/Spam-Three-Steps
- DIA TXT-message FAQ: https://www.dia.govt.nz/spam-frequently-asked-questions
