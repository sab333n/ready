import Link from "next/link";
import { buttonClass, Card, secondaryButtonClass } from "@/components/ui";
import { EDGE_LABEL } from "@/lib/diagnostic/engine";
import type { Reflection } from "@/lib/lesson/service";

const VERDICT = {
  correct: { label: "Explained well", color: "var(--green)" },
  wrong: { label: "Explained with an error", color: "var(--red)" },
  skipped: { label: "Skipped", color: "var(--yellow)" },
} as const;

export function ReflectionView({ reflection: r }: { reflection: Reflection; sessionId: string }) {
  const correct = r.keyPoints.filter((k) => k.verdict === "correct");
  const missed = r.keyPoints.filter((k) => k.verdict !== "correct");
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Reflection</p>
        <h1 className="text-2xl font-semibold tracking-tight">{r.topic}</h1>
        <p className="text-muted">
          You explained {correct.length} of {r.keyPoints.length} key points correctly ({r.teachScore}%).
          {r.mistake && (r.mistake.caught ? " You caught the planted mistake." : " The planted mistake slipped past you.")}
        </p>
      </header>

      {r.confidentWrong.length > 0 && (
        <Card className="border-[var(--red)]">
          <h2 className="font-medium text-[var(--red)]">Sure, but wrong</h2>
          <p className="text-sm text-muted">These are the riskiest: you felt confident, so you wouldn&apos;t have rechecked them before an exam.</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {r.confidentWrong.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
      )}

      {r.mistake && (
        <Card>
          <h2 className="font-medium">Teach-back: {r.mistake.caught ? <span className="text-[var(--green)]">caught ✓</span> : <span className="text-[var(--red)]">missed</span>}</h2>
          <p className="mt-1 text-sm">
            <span className="text-muted">The student said:</span> {r.mistake.claim}
          </p>
          <p className="text-sm">
            <span className="text-muted">Your notes say:</span> {r.mistake.correction}
            {r.mistake.source && <span className="text-xs text-muted"> ({r.mistake.source})</span>}
          </p>
          {r.mistake.evidence && <p className="mt-1 text-sm text-muted">You said: “{r.mistake.evidence}”</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium">Key points</h2>
        <ol className="flex flex-col gap-3">
          {[...correct, ...missed].map((k) => (
            <li key={k.point} className="text-sm">
              <span className="text-xs font-semibold" style={{ color: VERDICT[k.verdict].color }}>
                {VERDICT[k.verdict].label}
                {k.confidence ? ` · you said ${k.confidence === "sure" ? "sure" : "not sure"}` : ""}
              </span>
              <p>{k.point}</p>
              {k.quote && <p className="text-muted">You: “{k.quote}”</p>}
              {k.note && <p className="text-muted">{k.note}</p>}
              {k.source && <p className="text-xs text-muted">Source: {k.source}</p>}
            </li>
          ))}
        </ol>
      </Card>

      {(r.strengths.length > 0 || r.improve.length > 0) && (
        <Card>
          {r.strengths.length > 0 && (
            <>
              <h2 className="font-medium">What went well</h2>
              <ul className="mt-1 mb-3 list-disc pl-5 text-sm">
                {r.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {r.improve.length > 0 && (
            <>
              <h2 className="font-medium">Next time</h2>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {r.improve.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {r.diagnostic.some((d) => d.edge !== "untested") && (
        <Card>
          <h2 className="mb-1 font-medium">Quick check</h2>
          <ul className="text-sm">
            {r.diagnostic
              .filter((d) => d.edge !== "untested")
              .map((d) => (
                <li key={d.topicId}>
                  {d.name}: <span className="text-muted">{EDGE_LABEL[d.edge]}</span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {!r.usedLlm && <p className="text-xs text-muted">Graded by the offline engine (word matching against your notes). Turn on the AI grader for a closer read.</p>}

      <div className="flex flex-wrap gap-2">
        <Link href="/learn" className={buttonClass}>
          Teach another topic
        </Link>
        <Link href="/map" className={secondaryButtonClass}>
          Back to my semester
        </Link>
      </div>
    </div>
  );
}
