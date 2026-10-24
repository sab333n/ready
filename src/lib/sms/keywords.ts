import { APP_NAME } from "@/lib/brand";

// Carrier-standard opt-out / opt-in keywords. These must work no matter what
// state the conversation is in, so they are checked before any other intent.
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START = new Set(["START", "UNSTOP", "YES START", "OPTIN"]);
const HELP = new Set(["HELP", "INFO"]);

export type ComplianceKeyword = "stop" | "start" | "help";

export function complianceKeyword(body: string): ComplianceKeyword | null {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP.has(word)) return "stop";
  if (START.has(word)) return "start";
  if (HELP.has(word)) return "help";
  return null;
}

export const SMS_REPLIES = {
  stop: `${APP_NAME}: You're unsubscribed and won't get more texts. Reply START to opt back in.`,
  start: `${APP_NAME}: You're subscribed again. Up to 2 study texts a day. Reply STOP to opt out, HELP for help.`,
  help: `${APP_NAME}: Study reminders based on your readiness. Up to 2 msgs/day. Msg & data rates may apply. Reply STOP to opt out.`,
};

export function smsConsentText(phoneDisplay: string, window: string): string {
  return (
    `Can ${APP_NAME} text you study reminders at ${phoneDisplay}? ` +
    `Up to 2 texts a day, only ${window} unless something is urgent. ` +
    `Msg & data rates may apply. Reply STOP anytime to opt out.`
  );
}
