import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "@/lib/sms/phone";
import { complianceKeyword } from "@/lib/sms/keywords";
import { isValidTwilioRequest, twilioSignature } from "@/lib/sms/twilio-signature";

describe("phone numbers", () => {
  it.each([
    ["(555) 201-3344", "+15552013344"],
    ["555.201.3344", "+15552013344"],
    ["1 555 201 3344", "+15552013344"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("normalizes %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it("rejects junk", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("055 201 3344")).toBeNull();
  });

  it("formats US numbers for display", () => expect(formatPhone("+15552013344")).toBe("(555) 201-3344"));
});

describe("compliance keywords", () => {
  it.each(["STOP", "stop", " Stop. ", "unsubscribe", "CANCEL", "quit"])("%s opts out", (b) => expect(complianceKeyword(b)).toBe("stop"));
  it("START and HELP", () => {
    expect(complianceKeyword("start")).toBe("start");
    expect(complianceKeyword("HELP")).toBe("help");
  });
  it("ignores normal replies", () => {
    expect(complianceKeyword("YES")).toBeNull();
    expect(complianceKeyword("please stop texting me so early")).toBeNull();
  });
});

describe("twilio signature", () => {
  const url = "https://example.test/api/sms/inbound";
  const params = { From: "+15552013344", Body: "STOP", To: "+15550001111" };
  it("accepts a correctly signed request and rejects tampering", () => {
    const sig = twilioSignature("secret", url, params);
    expect(isValidTwilioRequest("secret", url, params, sig)).toBe(true);
    expect(isValidTwilioRequest("secret", url, { ...params, Body: "START" }, sig)).toBe(false);
    expect(isValidTwilioRequest("secret", url, params, null)).toBe(false);
  });
});
