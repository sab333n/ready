import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio signs webhooks: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
// https://www.twilio.com/docs/usage/security#validating-requests
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function isValidTwilioRequest(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
