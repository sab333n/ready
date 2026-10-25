"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlanMap } from "@/components/plan-map";
import { EDGE_LABEL } from "@/lib/diagnostic/engine";
import { useDictation } from "@/app/onboarding/useDictation";
import {
  answerDiagnosticAction,
  finishAction,
  nextQuestionAction,
  sayAction,
  setModeAction,
  skipDiagnosticAction,
  tagConfidenceAction,
  teachBackAction,
  type ActionResult,
} from "../actions";
import type { LessonView } from "../view";
import { Studio } from "./Studio";
import { useVoiceClass } from "./useVoiceClass";

export function Lesson({ initial }: { initial: LessonView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const shownStage = useRef(initial.stage);

  // The sidebar is rendered on the server; refresh it when the session moves to a new stage.
  useEffect(() => {
    if (shownStage.current === view.stage) return;
    shownStage.current = view.stage;
    router.refresh();
  }, [view.stage, router]);

  function run(action: () => Promise<ActionResult>, after?: (r: ActionResult) => void) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      setView(r.view);
      if (r.error) setError(r.error);
      after?.(r);
    });
  }

  const phase = phaseLabel(view);
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-4 px-6 pt-6 md:px-10">
          <div>
            <p className="text-xs tracking-wide text-muted uppercase">{view.course}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{view.topic}</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-pressed={planOpen}
              onClick={() => setPlanOpen((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] ${planOpen ? "border-foreground/50" : "border-border text-muted"}`}
            >
              PLAN
            </button>
            <span className="rounded-full border border-foreground/50 px-3 py-1 text-[11px] font-semibold tracking-[0.14em]">{phase}</span>
          </div>
        </header>
        {view.generatedOutline && view.stage !== "done" && (
          <p className="mx-6 mt-4 rounded-xl border border-border px-3 py-2 text-sm text-[var(--yellow)] md:mx-10">
            Ready wrote this study outline. Teach from it, or upload your own notes if you want the class to use your course instead.
          </p>
        )}
        {!view.hasNotes && !view.generatedOutline && view.stage !== "done" && (
          <p className="mx-6 mt-4 rounded-xl border border-border px-3 py-2 text-sm text-[var(--yellow)] md:mx-10">
            This topic is only in your syllabus. Upload notes or slides so questions come from the real material.
          </p>
        )}
        {error && <p className="mx-6 mt-3 text-sm text-[var(--red)] md:mx-10">{error}</p>}
        {view.stage === "done" ? (
          <PracticeSummary view={view} />
        ) : view.stage === "diagnostic" ? (
          <Probe view={view} pending={pending} run={run} />
        ) : (
          <Classroom view={view} pending={pending} run={run} setView={setView} setError={setError} />
        )}
      </div>
      {planOpen && (
        <aside className="w-full shrink-0 border-t border-border px-6 py-4 lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-4 lg:py-6">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Lesson map</p>
          <PlanMap nodes={view.plan} />
        </aside>
      )}
    </div>
  );
}

function phaseLabel(view: LessonView) {
  if (view.kind === "practice") return view.stage === "done" ? "DONE" : "PRACTICE";
  if (view.stage === "diagnostic") return "PROBE";
  if (view.stage === "teach_back") return "CHECK";
  return "TEACHING";
}

type RunFn = (action: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => void;

function Probe({ view, pending, run }: { view: LessonView; pending: boolean; run: RunFn }) {
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(50);
  // An untouched slider says nothing about confidence; only a deliberate setting counts.
  const [rated, setRated] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const dictation = useDictation(setAnswer);
  const q = view.diagnostic.current;
  const last = view.diagnostic.answered.at(-1);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (q || pending || asked.current === view.id) return;
    asked.current = view.id;
    run(() => nextQuestionAction(view.id));
  }, [q, pending, run, view.id]);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6 md:px-10">
      <div className="space-y-3 text-[15px] leading-7">
        <p>
          {view.kind === "practice"
            ? `Practice on ${view.topic}. The question will not walk you to the answer. Say what comes to mind, including what you are unsure about.`
            : `Before teaching ${view.topic}, this finds where your understanding ends. Answer from what you can explain, not from a guess you would not defend.`}
        </p>
        {last && (
          <p>
            <span className="font-medium">{last.score >= 7 ? "That holds." : last.score >= 4 ? "Partly there." : "Not yet."}</span> {last.rationale}{" "}
            <span className="text-muted">From your notes: {last.answerKey}</span>
          </p>
        )}
      </div>
      {q ? (
        <form
          className="rounded-2xl border border-border bg-card/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const text = unknown ? "I don't know" : answer;
            const stance = unknown ? "unsure" : rated ? (confidence >= 50 ? "sure" : "unsure") : null;
            run(() => answerDiagnosticAction(view.id, q.id, text, stance), () => {
              setAnswer("");
              setUnknown(false);
              setConfidence(50);
              setRated(false);
            });
          }}
        >
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Prediction</p>
          <p className="mt-2 text-sm text-muted">
            Question {q.number} · {q.strand}
          </p>
          <p className="mt-1 leading-7">{q.question}</p>
          <label className={`mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2 text-sm ${unknown ? "border-foreground/40" : "border-border text-muted"}`}>
            <input type="radio" name="stance" checked={unknown} onChange={() => setUnknown(true)} />
            I don&apos;t know
          </label>
          <label className={`mt-2 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${!unknown ? "border-foreground/30" : "border-border text-muted"}`}>
            <input type="radio" name="stance" checked={!unknown} onChange={() => setUnknown(false)} />
            I&apos;ll explain it
          </label>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
              <span>Confidence</span>
              <span className="text-gold">{unknown || !rated ? "—" : `${confidence}%`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              disabled={unknown}
              aria-label="Confidence"
              onChange={(e) => {
                setConfidence(Number(e.target.value));
                setRated(true);
              }}
              className={`mt-2 w-full accent-[var(--gold)] ${rated ? "" : "opacity-50"}`}
            />
          </div>
          <label className="mt-4 block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
            Your thinking
            <textarea
              value={answer}
              disabled={unknown}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Whatever comes to mind."
              aria-label="Your thinking"
              className="mt-2 min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal tracking-normal text-foreground normal-case outline-none placeholder:text-muted focus:border-foreground/40 disabled:opacity-50"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {dictation.supported && !unknown && (
              <button type="button" className="rounded-full border border-border px-3 py-1.5 text-xs text-muted" onClick={dictation.listening ? dictation.stop : dictation.start}>
                {dictation.listening ? "Stop" : "Dictate"}
              </button>
            )}
            <span className="text-xs text-muted">↵ submits</span>
            <button className="ml-auto rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40" disabled={pending || (!unknown && !answer.trim())}>
              {pending ? "Checking…" : "Submit answer"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-muted">{pending ? "Writing the next question from your notes…" : "Preparing the next question…"}</p>
      )}
      {view.kind === "teach" && (
        <button className="self-start text-xs text-muted underline" disabled={pending} onClick={() => run(() => skipDiagnosticAction(view.id))}>
          Skip the probe and start teaching
        </button>
      )}
    </article>
  );
}

function PracticeSummary({ view }: { view: LessonView }) {
  const answered = view.diagnostic.answered;
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6 md:px-10">
      <p className="leading-7">
        Practice on {view.topic} is finished. {answered.filter((a) => a.score >= 7).length} of {answered.length} answers held up. These scores update how ready you
        are for this topic.
      </p>
      <ul className="flex flex-col gap-3">
        {answered.map((a) => (
          <li key={a.question} className="rounded-xl border border-border px-3 py-2 text-sm">
            <span className="text-muted">{a.strand} · </span>
            {a.score >= 7 ? "Holds" : a.score >= 4 ? "Partly" : "Not yet"}
            {a.confidence === "sure" && a.score <= 3 ? " · you were sure" : ""}
            <p className="mt-1 text-muted">{a.rationale}</p>
          </li>
        ))}
      </ul>
      <Link href="/learn?mode=practice" className="text-sm underline">
        Practice something else
      </Link>
    </article>
  );
}

function Classroom({
  view,
  pending,
  run,
  setView,
  setError,
}: {
  view: LessonView;
  pending: boolean;
  run: RunFn;
  setView: (v: LessonView) => void;
  setError: (e: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [confidence, setConfidence] = useState(50);
  const [rated, setRated] = useState(false);
  const dictation = useDictation(setDraft);
  const bottom = useRef<HTMLDivElement>(null);
  const voice = useVoiceClass({ view, onView: setView, onError: setError });
  const persona = (id: string) => view.personas.find((p) => p.id === id);
  const learnerTurns = view.turns.filter((t) => t.speaker === "learner");
  const lastLearner = learnerTurns.at(-1);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view.turns.length, voice.live]);

  function send(text: string) {
    if (!text.trim()) return;
    setDraft("");
    // Unrated turns get the Sure / Unsure buttons afterwards instead of a guessed tag.
    const stance = rated ? (confidence >= 50 ? "sure" : "unsure") : null;
    setRated(false);
    run(() => sayAction(view.id, text, stance), (r) => r.voice && voice.speak(r.voice.speaker, text, r.voice.note));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <article className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-6 py-6 md:px-10">
        <div className="flex flex-wrap gap-2">
          {view.personas.map((p) => (
            <span key={p.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${voice.speaking === p.id ? "border-gold" : "border-border"}`}>
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.name}
              <span className="text-xs text-muted">{p.role}</span>
            </span>
          ))}
        </div>
        {view.turns.map((t) =>
          t.speaker === "system" ? (
            <p key={t.seq} className="text-sm text-muted">
              {t.text}
            </p>
          ) : t.speaker === "learner" ? (
            <blockquote key={t.seq} className="border-l-2 border-foreground/30 pl-3 leading-7">
              {t.text}
              {t.confidence && <span className="mt-1 block text-xs text-muted">{t.confidence === "sure" ? "Sure" : "Not sure"}</span>}
            </blockquote>
          ) : (
            <p key={t.seq} className="leading-7">
              <span className="mr-2 text-xs font-semibold tracking-wide uppercase" style={{ color: persona(t.speaker)?.color }}>
                {persona(t.speaker)?.name ?? t.speaker}
              </span>
              {t.text}
              {t.interrupted && <span className="text-muted"> …</span>}
            </p>
          ),
        )}
        {voice.live && (
          <p className="leading-7 text-muted">
            <span className="mr-2 text-xs font-semibold tracking-wide uppercase">{persona(voice.live.persona)?.name}</span>
            {voice.live.text || "…"}
          </p>
        )}
        {voice.hearing && <p className="text-muted">{voice.hearing}</p>}
        {pending && !voice.on && <p className="text-muted">…</p>}
        {view.mistake?.caught === true && <p className="text-sm text-[var(--green)]">You caught the planted mistake.</p>}
        {view.diagnostic.results.some((r) => r.edge !== "untested") && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Probe results</summary>
            <ul className="mt-2 space-y-1">
              {view.diagnostic.results
                .filter((r) => r.edge !== "untested")
                .map((r) => (
                  <li key={r.topicId}>
                    {r.name}: {EDGE_LABEL[r.edge]}
                    {r.confidentWrong && <span className="text-[var(--red)]"> · sure, but wrong</span>}
                  </li>
                ))}
            </ul>
          </details>
        )}
        <div ref={bottom} />
      </article>

      <div className="border-t border-border px-6 py-3 md:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {lastLearner && !lastLearner.confidence && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">How sure were you?</span>
              <button type="button" className="rounded-full border border-border px-3 py-1" onClick={() => run(() => tagConfidenceAction(view.id, "sure"))}>
                Sure
              </button>
              <button type="button" className="rounded-full border border-border px-3 py-1" onClick={() => run(() => tagConfidenceAction(view.id, "unsure"))}>
                Not sure
              </button>
            </div>
          )}
          {voice.on ? (
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <Studio voice={voice} />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p>
                  {voice.status}
                  {voice.idle !== null && <span className="block text-[var(--yellow)]">Are you still there? Voice turns off in {voice.idle}s.</span>}
                </p>
                <button type="button" className="rounded-full border border-border px-3 py-1.5" onClick={() => voice.stop()}>
                  Switch to typing
                </button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="h-full bg-gold transition-[width]" style={{ width: `${Math.min(100, Math.round(voice.level * 500))}%` }} />
              </div>
              {voice.hearing && <p className="mt-2 text-muted">You: {voice.hearing}</p>}
              <p className="mt-2 text-xs text-muted">They can hear you. Interrupt them anytime. Headphones keep the class from hearing itself.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                placeholder={view.stage === "teach_back" ? "Was that right? Correct anything that's off." : `Explain ${view.topic} in your own words`}
                aria-label="Your explanation"
                className="min-h-20 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  Confidence
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={confidence}
                    aria-label="Confidence"
                    onChange={(e) => {
                      setConfidence(Number(e.target.value));
                      setRated(true);
                    }}
                    className={`accent-[var(--gold)] ${rated ? "" : "opacity-50"}`}
                  />
                  <span className="text-gold">{rated ? `${confidence}%` : "—"}</span>
                </label>
                {dictation.supported && (
                  <button type="button" className="rounded-full border border-border px-3 py-1 text-xs text-muted" onClick={dictation.listening ? dictation.stop : dictation.start}>
                    {dictation.listening ? "Stop" : "Dictate"}
                  </button>
                )}
                <button className="ml-auto rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40" disabled={pending || !draft.trim()}>
                  Send
                </button>
              </div>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {!voice.on &&
              (view.voiceAvailable ? (
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1.5 text-sm"
                  disabled={pending}
                  onClick={() => {
                    voice.prepareMic();
                    run(() => setModeAction(view.id, "voice"), () => void voice.start());
                  }}
                >
                  Teach out loud
                </button>
              ) : (
                <span className="self-center text-xs text-muted">Voice needs a Gemini key. Typing works.</span>
              ))}
            {view.stage === "teach" && (
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1.5 text-sm"
                disabled={pending || learnerTurns.length === 0}
                onClick={() => run(() => teachBackAction(view.id), (r) => r.voice && voice.speak(r.voice.speaker, null, r.voice.note))}
              >
                Ask {view.personas[0]?.name} to teach it back
              </button>
            )}
            <form action={finishAction.bind(null, view.id)} onSubmit={() => voice.stop()}>
              <button className="rounded-full border border-border px-3 py-1.5 text-sm" disabled={pending || learnerTurns.length === 0}>
                End and see the reflection
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
