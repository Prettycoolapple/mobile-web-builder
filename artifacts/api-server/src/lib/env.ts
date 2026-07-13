function trim(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readRequired(name: string): string {
  const value = trim(process.env[name]);
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function readOptional(name: string): string | null {
  return trim(process.env[name]);
}

export function getPublicAppUrl(): string {
  const explicitUrl =
    readOptional("PUBLIC_APP_URL") ??
    readOptional("APP_URL") ??
    readOptional("WEB_APP_URL");

  if (explicitUrl) return explicitUrl.replace(/\/+$/, "");

  return "http://localhost:8080";
}

/**
 * Origins allowed to call the API from a *browser* context. CORS is a browser
 * protection only — it does not stop a server-side scraper — but it cheaply
 * blocks another website (e.g. a competitor's web app) from calling our API
 * directly. Native clients (React Native fetch) send no Origin and are allowed
 * by the app.ts callback, so this never affects the mobile app.
 *
 * Defaults to the public app URL; extend with CORS_ALLOWED_ORIGINS (comma
 * separated) and/or ADMIN_ORIGIN.
 */
export function getAllowedOrigins(): string[] {
  const stripSlash = (s: string) => s.replace(/\/+$/, "");
  const origins = new Set<string>();
  origins.add(stripSlash(getPublicAppUrl()));

  const adminOrigin = readOptional("ADMIN_ORIGIN");
  if (adminOrigin) origins.add(stripSlash(adminOrigin));

  const configured = readOptional("CORS_ALLOWED_ORIGINS");
  if (configured) {
    for (const entry of configured.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) origins.add(stripSlash(trimmed));
    }
  }
  return Array.from(origins);
}

export function getTrustProxySetting(): boolean | number | string {
  const value = readOptional("TRUST_PROXY");
  if (!value) return true;
  if (value === "true") return true;
  if (value === "false") return false;

  const asNumber = Number(value);
  return Number.isNaN(asNumber) ? value : asNumber;
}

export function getTwilioAccountSid(): string {
  return readRequired("TWILIO_ACCOUNT_SID");
}

export function getTwilioApiKey(): string {
  return readRequired("TWILIO_API_KEY");
}

export function getTwilioApiSecret(): string {
  return readRequired("TWILIO_API_SECRET");
}

export function getTwilioPhoneNumber(): string {
  return readRequired("TWILIO_PHONE_NUMBER");
}

/** Auth token used only to validate Twilio webhook signatures. */
export function getTwilioAuthToken(): string {
  return readRequired("TWILIO_AUTH_TOKEN");
}

export function isLimTitleFeatureEnabled(): boolean {
  const value = readOptional("LIM_TITLE_FEATURE_ENABLED");
  return value ? !["0", "false", "off", "no"].includes(value.toLowerCase()) : true;
}

export function isLimTitleProactiveEnabled(): boolean {
  const value = readOptional("LIM_TITLE_PROACTIVE_ENABLED");
  return value ? !["0", "false", "off", "no"].includes(value.toLowerCase()) : true;
}

/** SMS is opt-in at deployment time so a code deploy cannot contact agents accidentally. */
export function isLimTitleSmsEnabled(): boolean {
  const value = readOptional("LIM_TITLE_SMS_ENABLED");
  return value ? ["1", "true", "on", "yes"].includes(value.toLowerCase()) : false;
}

/**
 * Short branded URL displayed in the one-segment lead SMS. The formatter
 * always emits an explicit HTTPS URL so mobile clients can linkify it safely.
 */
export function getLeadShortBaseUrl(): string {
  const explicit = readOptional("LEAD_SHORT_BASE_URL");
  const value = explicit ?? `${getPublicAppUrl()}/l`;
  return value.replace(/\/+$/, "");
}

export function getTwilioLeadStatusCallbackUrl(): string {
  return `${getPublicAppUrl()}/api/webhooks/twilio/sms-status`;
}

export function getTwilioInboundSmsUrl(): string {
  return `${getPublicAppUrl()}/api/webhooks/twilio/inbound`;
}

export function getGoogleCloudProjectId(): string | undefined {
  return readOptional("GOOGLE_CLOUD_PROJECT_ID") ?? undefined;
}

/** Public URL of the static sales portal (used for Stripe Checkout return URLs). */
export function getSalesPortalUrl(): string {
  return `${getPublicAppUrl()}/sales-portal/`;
}

/**
 * Temporary account-first sales-agent registration mode. Enabled by default so
 * agents can create a free account; set false to restore the legacy signup-time
 * Stripe/invitation gate.
 */
export function isSalesAgentFreeSignupEnabled(): boolean {
  const value = readOptional("SALES_AGENT_FREE_SIGNUP_ENABLED");
  if (!value) return true;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

export function getIosAppStoreUrl(): string {
  return readOptional("IOS_APP_STORE_URL") ?? "https://apps.apple.com/nz/app/project-alpha/id6762080292";
}

export function getAndroidPlayStoreUrl(): string {
  return readOptional("ANDROID_PLAY_STORE_URL") ?? "https://play.google.com/store/apps/details?id=nz.devfeasible.app&hl=en";
}

export function getStripeSecretKey(): string {
  return readRequired("STRIPE_SECRET_KEY");
}

export function getStripeWebhookSecret(): string {
  return readRequired("STRIPE_WEBHOOK_SECRET");
}

/** The $199/month recurring Price id configured in the Stripe dashboard. */
export function getStripeAgentPriceId(): string {
  return readRequired("STRIPE_AGENT_PRICE_ID");
}

/** Shared invitation code agents can enter to bypass the subscription. */
export function getAgentInvitationCode(): string {
  return readOptional("AGENT_INVITATION_CODE") ?? "projectalpha26";
}

/** Public URL of the static provider portal (used for Stripe Checkout return URLs). */
export function getProviderPortalUrl(): string {
  return `${getPublicAppUrl()}/provider-portal/`;
}

/** The $127.50/month recurring Price id for provider portal subscriptions. */
export function getStripeProviderPriceId(): string {
  return readRequired("STRIPE_PROVIDER_PRICE_ID");
}

/** Shared invitation code providers can enter to bypass the subscription. */
export function getProviderInvitationCode(): string {
  return readOptional("PROVIDER_INVITATION_CODE") ?? "arch140326!";
}
