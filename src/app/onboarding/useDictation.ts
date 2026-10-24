"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Browser speech-to-text (Web Speech API) for voice answers during onboarding.
// Free and on-device where supported; the realtime voice module comes in Phase 2.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noopSubscribe = () => () => {};

export function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(noopSubscribe, () => Boolean(recognitionCtor()), () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  useEffect(() => {
    callback.current = onText;
  });

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = (rec.current ??= new Ctor());
    r.interimResults = true;
    r.continuous = false;
    r.lang = "en-US";
    r.onresult = (e) => callback.current(Array.from(e.results, (res) => res[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.start();
    setListening(true);
  }

  return { supported, listening, start, stop: () => rec.current?.stop() };
}
