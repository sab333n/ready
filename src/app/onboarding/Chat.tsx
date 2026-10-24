"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { restartOnboarding, sendAnswer } from "./actions";
import type { ChatView } from "./view";
import { useDictation } from "./useDictation";

export function Chat({ initial }: { initial: ChatView }) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const [speak, setSpeak] = useState(false);
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const dictation = useDictation((text) => setDraft(text));

  const lastBot = [...view.lines].reverse().find((l) => l.from === "bot")?.text;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view]);

  // Optional voice mode: read each new question aloud.
  useEffect(() => {
    if (!speak || !lastBot || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(lastBot));
  }, [speak, lastBot]);

  function send(text: string) {
    if (!text.trim() || pending) return;
    setDraft("");
    setView((v) => ({ ...v, lines: [...v.lines, { from: "me", text }], chips: [], error: undefined }));
    startTransition(async () => {
      const next = await sendAnswer(text);
      setView(next);
      if (next.error) setDraft(text); // let them fix the reply instead of retyping it
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ol className="flex flex-col gap-2" aria-live="polite">
        {view.lines.map((line, i) => (
          <li
            key={i}
            className={
              line.from === "bot"
                ? "max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5"
                : "max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-3.5 py-2.5 text-accent-fg"
            }
          >
            {line.text}
          </li>
        ))}
        {pending && <li className="self-start px-2 text-muted">…</li>}
      </ol>
      {view.error && <p className="text-sm text-[var(--red)]">{view.error}</p>}

      {view.done ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/connect" className={buttonClass}>
            Next: add my deadlines
          </Link>
          <button className={secondaryButtonClass} onClick={() => startTransition(async () => setView(await restartOnboarding()))}>
            Start over
          </button>
        </div>
      ) : (
        <div className="sticky bottom-0 flex flex-col gap-2 bg-background pt-2 pb-3">
          {view.chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {view.chips.map((chip) => (
                <button key={chip} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm" onClick={() => send(chip)} disabled={pending}>
                  {chip}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={dictation.listening ? "Listening…" : "Type your answer"}
              aria-label="Your answer"
              autoFocus
            />
            {dictation.supported && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={dictation.listening ? dictation.stop : dictation.start}
                aria-pressed={dictation.listening}
                title="Answer by voice"
              >
                {dictation.listening ? "Stop" : "🎤"}
              </button>
            )}
            <button className={buttonClass} disabled={pending || !draft.trim()}>
              Send
            </button>
          </form>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read questions aloud
          </label>
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}
