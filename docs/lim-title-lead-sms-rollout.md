# Archived LIM/Title automated SMS rollout

Automated listing-agent lead SMS is not part of the current production flow.
LIM/title consent no longer queues a Twilio lead message, even when the legacy
`LIM_TITLE_SMS_ENABLED` flag is changed. The delivery tables, webhook handlers,
and sender code remain dormant so automation can be reconsidered later through
a deliberate code rollout.

Use [lim-title-lead-manual-rollout.md](./lim-title-lead-manual-rollout.md) for
the active human-managed process. Twilio is still used for account phone OTPs;
do not remove the existing account SID, API key, API secret, or sending number.

Before automated lead messaging is restored, independently complete the New
Zealand consent, short-code, unsubscribe, delivery, retention, and operational
review. Restoring it requires a code change as well as approved configuration.
