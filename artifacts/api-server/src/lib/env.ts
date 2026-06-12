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

export function getGoogleCloudProjectId(): string | undefined {
  return readOptional("GOOGLE_CLOUD_PROJECT_ID") ?? undefined;
}

/** Public URL of the static sales portal (used for Stripe Checkout return URLs). */
export function getSalesPortalUrl(): string {
  return `${getPublicAppUrl()}/sales-portal/`;
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
