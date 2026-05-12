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
