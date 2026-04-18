// Twilio integration via Replit Connectors blueprint
// Do not cache the client object; tokens may expire.
import twilio from "twilio";
import type { Twilio } from "twilio";

interface TwilioCredentials {
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  phoneNumber: string;
}

async function getCredentials(): Promise<TwilioCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector credentials are not available");
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=twilio`,
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
  );
  const data = (await resp.json()) as { items?: Array<{ settings: Record<string, string> }> };
  const settings = data.items?.[0]?.settings;

  if (
    !settings ||
    !settings.account_sid ||
    !settings.api_key ||
    !settings.api_key_secret
  ) {
    throw new Error("Twilio not connected");
  }

  return {
    accountSid: settings.account_sid,
    apiKey: settings.api_key,
    apiKeySecret: settings.api_key_secret,
    phoneNumber: settings.phone_number,
  };
}

export async function getTwilioClient(): Promise<Twilio> {
  const { accountSid, apiKey, apiKeySecret } = await getCredentials();
  return twilio(apiKey, apiKeySecret, { accountSid });
}

export async function getTwilioFromPhoneNumber(): Promise<string> {
  const { phoneNumber } = await getCredentials();
  return phoneNumber;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const client = await getTwilioClient();
  const from = await getTwilioFromPhoneNumber();
  await client.messages.create({ to, from, body });
}
