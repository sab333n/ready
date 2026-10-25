"use client";

import { useActionState, useEffect, useState } from "react";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { removePushAction, savePushAction, saveTextSettings, saveTimezone, textMeNow, type TextState } from "./actions";

export function TextSettingsForm({ consentText, phone, window }: { consentText: string; phone: string; window: string }) {
  const [state, action, pending] = useActionState<TextState, FormData>(saveTextSettings, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input name="phone" defaultValue={phone} required inputMode="tel" placeholder="(555) 123-4567" aria-label="Phone number" className={inputClass} />
        <input name="window" defaultValue={window} required placeholder="5pm–9pm" aria-label="Texting hours" className={`${inputClass} sm:w-40`} />
      </div>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>{consentText}</span>
      </label>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : "Turn on texts"}
      </button>
      {state?.error && <p className="text-sm text-[var(--red)]">{state.error}</p>}
      {state?.ok && <p className="text-sm text-[var(--green)]">{state.ok}</p>}
    </form>
  );
}

export function TextMeNow() {
  const [state, action, pending] = useActionState<TextState, FormData>(() => textMeNow(), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <button className={secondaryButtonClass} disabled={pending}>
        {pending ? "Sending…" : "Nudge me now"}
      </button>
      {state?.error && <span className="text-sm text-[var(--red)]">{state.error}</span>}
      {state?.ok && <span className="text-sm text-[var(--green)]">{state.ok}</span>}
    </form>
  );
}

/** Saves the browser's time zone once, so texting hours mean local hours. */
export function TimezoneSync({ current }: { current: string }) {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) void saveTimezone(tz);
  }, [current]);
  return null;
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type PushState = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

/** What this device can do: iPhones need Ready on the home screen before notifications exist. */
async function detectPush(): Promise<PushState> {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios && !standalone ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    return (await reg.pushManager.getSubscription()) ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

/** Turns notifications on for this device. iPhones only allow it once Ready is on the home screen. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detectPush().then(setState);
  }, []);

  async function turnOn() {
    if (!publicKey) return setError("Notifications aren't set up on the server yet.");
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await savePushAction(JSON.parse(JSON.stringify(sub)), navigator.userAgent);
      setState("on");
    } catch {
      setState(Notification.permission === "denied" ? "blocked" : "off");
      if (Notification.permission !== "denied") setError("Couldn't turn on notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
    await removePushAction(sub?.endpoint ?? null);
    setState("off");
    setBusy(false);
  }

  if (state === "checking") return <p className="text-sm text-muted">Checking this device…</p>;
  if (state === "ios-install")
    return (
      <p className="rounded-xl border border-border p-3 text-sm">
        On iPhone, add Ready to your home screen first: tap <span className="font-medium">Share</span>, then <span className="font-medium">Add to Home Screen</span>. Open
        Ready from the new icon and turn on notifications here.
      </p>
    );
  if (state === "unsupported") return <p className="text-sm text-muted">This browser can&apos;t show notifications. Try Chrome, or Safari from your home screen.</p>;
  if (state === "blocked") return <p className="text-sm text-muted">Notifications are blocked for Ready. Allow them in your browser&apos;s site settings, then reload.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "on" ? (
        <>
          <span className="text-sm text-[var(--green)]">Notifications are on for this device.</span>
          <button type="button" className="text-xs text-muted underline" onClick={turnOff} disabled={busy}>
            Turn off here
          </button>
        </>
      ) : (
        <button type="button" className={buttonClass} onClick={turnOn} disabled={busy}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      )}
      {error && <span className="text-sm text-[var(--red)]">{error}</span>}
    </div>
  );
}
