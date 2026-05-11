# Mobile Web Builder

Replit is no longer required to develop, test, or deploy this app. The stack
is:

- Postgres on Supabase
- API on Vercel (or any Node host) as stateless serverless functions
- Expo mobile app, scanned with a LAN QR code in Expo Go for day-to-day
  testing, and built natively via EAS for TestFlight / internal testing

## Create tables on Supabase (Drizzle)

Schema lives in `lib/db/src/schema`. The `push` script loads **`DATABASE_URL` from the repo root `.env.local`** (you do not need to export it in the shell).

1. **Where to copy `DATABASE_URL` in Supabase:** open your project → **Project Settings** (gear icon) → **Database** → scroll to **Connection string**. Set the format to **URI**. Choose **Session pooler** or **Direct connection** (port `5432`) for local development and for `drizzle-kit push`. Replace `[YOUR-PASSWORD]` with the database user password from the same page (or reset it under **Database password**). If the password contains characters like `@`, `#`, `%`, or spaces, [URL-encode](https://developer.mozilla.org/en-US/docs/Glossary/Percent-encoding) them in the URI.
2. From the repo root:

   ```bash
   pnpm --filter @workspace/db run push
   ```

If `push` prints `Invalid URL`, the connection string is still a placeholder or has an unescaped password.

## Expo Go QR code testing (the "scan and go" flow)

1. Connect your phone and your computer to the **same Wi-Fi** network.
2. Copy `.env.example` to `.env.local` and fill in at least `DATABASE_URL` and
   `SESSION_SECRET`.
3. Copy `artifacts/mobile/.env.example` to `artifacts/mobile/.env.local`.
   Leave `EXPO_PUBLIC_API_URL` empty for LAN auto-detection, or set it to
   `http://<your-lan-ip>:8080/api` explicitly.
4. Start the API:

   ```bash
   pnpm --filter @workspace/api-server run dev
   ```

5. Start Expo in Expo Go mode (this forces the QR to open in Expo Go, not a
   dev client):

   ```bash
   pnpm --filter @workspace/mobile run dev
   ```

6. Scan the QR code with Expo Go on your phone. Hot reload works; the API
   auto-detects your Metro LAN host unless you override it.

If your phone isn't on the same Wi-Fi (coffee shop, cellular, etc.), use:

```bash
pnpm --filter @workspace/mobile run dev:tunnel
```

That produces a public URL QR via Expo's tunnel.

## Environment setup

Create:

- `./.env.local` from [`.env.example`](.env.example) for the API server,
  shared libraries, and scripts.
- `artifacts/mobile/.env.local` from
  [`artifacts/mobile/.env.example`](artifacts/mobile/.env.example) for Expo.

**Troubleshooting `pnpm --filter @workspace/db run push`:** If you update
`.env.local` but still see `password authentication failed`, check **Windows
User or System environment variables** for a stale `DATABASE_URL`. The API,
scripts, and Drizzle config now load `.env.local` with **override**, so the
repo file wins over the OS — run `push` again after pulling the latest config.
Also prefer copying the connection string from Supabase after a password reset.

Minimum API env for a usable local stack:

- `DATABASE_URL` (Supabase connection string; SSL is auto-enabled)
- `SESSION_SECRET`
- `PUBLIC_APP_URL`
- `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`
- Provider keys for any flow you exercise (Stripe, Twilio, Google Maps,
  RevenueCat, Gemini, etc.)

Minimum mobile env for device testing:

- `EXPO_PUBLIC_API_URL` (or leave empty to auto-detect LAN)
- RevenueCat public keys for native builds

If your phone tests against your local API, put your machine's LAN IP in
`EXPO_PUBLIC_API_URL`, not `localhost`.

## Supabase notes

- Use the **Session pooler** (`...pooler.supabase.com:5432`) for local dev.
- Use the **Transaction pooler** (`...pooler.supabase.com:6543`) for
  Vercel / serverless deploys.
- SSL is required; `DATABASE_URL` should include `sslmode=require`. The
  client auto-enables SSL when it sees a Supabase URL; override with
  `PGSSL=true|false` if needed.
- Tune `PGPOOL_MAX` (default 5) so each serverless instance doesn't
  exhaust Supabase's per-project connection budget.

## Vercel deployment (API)

This API is a long-lived Express server by default, but it ships a
Vercel-compatible serverless entry:

- `api/index.mjs` at the **repo root** exports the Express app as a
  serverless handler (Vercel only matches the `api/` directory here, not
  `artifacts/api-server/api/`).
- `vercel.json` at the repo root rewrites `/api/*` to that handler and sets
  `ENABLE_SOCKET_IO=false` so Socket.IO never initializes on Vercel.
- The mobile DM context falls back to REST polling when
  `EXPO_PUBLIC_ENABLE_SOCKETS=false` or when the socket can't connect.

Caveats:

- **Socket.IO does not run on Vercel.** Live DMs work via polling; push
  notifications continue to work for the "not connected" recipient path.
- **Playwright-based scraper routes need a browser backend on Vercel.** Set
  `PLAYWRIGHT_CDP_ENDPOINT` / `BROWSERLESS_WS_ENDPOINT` to a remote browser
  service, or keep those flows on a long-lived host with local Chromium.
- **The `/analyse` route streams long-running work**; it may hit Vercel's
  function-duration cap. Increase `maxDuration` in `vercel.json` or
  refactor to async jobs + polling for production.

### Vercel env variables to set in the dashboard

- `DATABASE_URL` (Supabase transaction pooler)
- `SESSION_SECRET`, `PHONE_VERIFICATION_SECRET`
- `PUBLIC_APP_URL` (your Vercel URL)
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `TWILIO_*`
- `GOOGLE_CLOUD_PROJECT_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`,
  `PRIVATE_OBJECT_DIR`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` (paste the whole service-account
  JSON; the server will parse it at runtime)
- `AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`
- `PLAYWRIGHT_CDP_ENDPOINT` or `BROWSERLESS_WS_ENDPOINT` for hosted scraper data
  on Vercel. A Browserless-style endpoint is expected, e.g.
  `wss://<browserless-host>?token=<token>`. You may instead set
  `BROWSERLESS_TOKEN` plus optional `BROWSERLESS_HOST`.
- `ENABLE_SOCKET_IO=false`
- `TRUST_PROXY=1`

Then point the mobile app at the Vercel URL via
`EXPO_PUBLIC_API_URL=https://<your-app>.vercel.app/api` and set
`EXPO_PUBLIC_ENABLE_SOCKETS=false` in the mobile env for hosted builds.

## Expo Go vs native billing

Expo Go supports UI and API testing plus the simulated subscription flow in
`artifacts/mobile/lib/revenuecat.ts`. Real Apple/Google IAP requires a
dev-client or store build:

```bash
eas build --profile development
eas build --profile preview
eas build --profile production
```

Use `development-simulator` when you specifically want an iOS simulator
client.

## Pre-TestFlight checklist

1. Confirm App Store Connect products match RevenueCat offerings and the
   `Pro` entitlement in
   [`artifacts/mobile/lib/revenuecat.ts`](artifacts/mobile/lib/revenuecat.ts).
2. Confirm Google Play products match the Android RevenueCat app.
3. Put RevenueCat + API URL secrets in EAS (not just local `.env`).
4. Bump `ios.buildNumber` and `android.versionCode` in
   [`artifacts/mobile/app.json`](artifacts/mobile/app.json) per upload.
5. Verify a real sandbox purchase in a native build, not Expo Go.
6. Verify `PUBLIC_APP_URL` and Stripe webhook URL match the Vercel
   deployment.

## Local validation commands

These passed on this workstation after the migration:

```bash
pnpm install
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/mobile run typecheck
pnpm --filter @workspace/scripts run typecheck
```

The repo-wide `pnpm run typecheck` is still blocked by pre-existing React
typing issues inside `artifacts/mockup-sandbox`, which are unrelated to the
API / mobile migration.
