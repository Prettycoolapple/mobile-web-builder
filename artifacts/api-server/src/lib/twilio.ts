import twilio from "twilio";
import type { Twilio } from "twilio";
import {
  getTwilioAccountSid,
  getTwilioApiKey,
  getTwilioApiSecret,
  getTwilioPhoneNumber,
} from "./env";

let twilioClient: Twilio | null = null;

export function getTwilioClient(): Twilio {
  if (!twilioClient) {
    twilioClient = twilio(getTwilioApiKey(), getTwilioApiSecret(), {
      accountSid: getTwilioAccountSid(),
    });
  }

  return twilioClient;
}

export function getTwilioFromPhoneNumber(): string {
  return getTwilioPhoneNumber();
}

export async function sendSms(
  to: string,
  body: string,
  options: { statusCallback?: string | null } = {},
) {
  const client = getTwilioClient();
  const from = getTwilioFromPhoneNumber();
  return client.messages.create({
    to,
    from,
    body,
    ...(options.statusCallback ? { statusCallback: options.statusCallback } : {}),
  });
}
