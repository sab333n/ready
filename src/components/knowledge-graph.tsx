"use client";

import { useMemo, useState } from "react";
import { useDictation } from "@/app/onboarding/useDictation";
import { startGoalAction } from "@/app/session/actions";
import type { PlacedNode } from "@/lib/learn/layout";

export function KnowledgeGraph({
  nodes,
  links,
  height,
  mode,
  notice,
}: {
  nodes: PlacedNode[];
  links: { from: string; to: string }[];
  height: number;
  mode: "teach" | "practice";
  notice: string | null;
}) {
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState(mode);
  const [hover, setHover] = useState<string | null>(null);
  const dictation = useDictation(setGoal);
  const q = goal.trim().toLowerCase();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const active = hover ? nodes.find((n) => n.id === hover) : q ? nodes.find((n) => n.name.toLowerCase().includes(q)) : null;

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 md:px-6">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Search topics"
          aria-label="Search topics"
          className="w-full max-w-sm rounded-full border border-border bg-card/80 px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-foreground/40"
        />
        <a href="/connect" className="rounded-full border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Import notes
        </a>
      </div>

      <div className="relative min-h-0 flex-1">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <p className="text-lg">Your map is empty.</p>
              <p className="mt-1 text-sm text-muted">Upload a syllabus and your notes. Topics land here, joined by what they build on.</p>
            </div>
          </div>
        ) : (
          <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="img" aria-label="Topics and what they build on">
            <defs>
              <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#3a3428" stopOpacity="0.45" />
                <stop offset="55%" stopColor="#1a2430" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#141413" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="1000" height="720" fill="url(#glow)" />
            {links.map((link) => {
              const a = byId.get(link.from);
              const b = byId.get(link.to);
              if (!a || !b) return null;
              const dim = q && !a.name.toLowerCase().includes(q) && !b.name.toLowerCase().includes(q);
              return <line key={`${link.from}-${link.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#8d8a80" strokeOpacity={dim ? 0.12 : 0.45} strokeWidth="1.25" />;
            })}
            {nodes.map((node) => {
              const dim = q.length > 0 && !node.name.toLowerCase().includes(q);
              const on = active?.id === node.id;
              return (
                <g
                  key={node.id}
                  opacity={dim ? 0.18 : 1}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(node.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setGoal(node.name)}
                >
                  <circle cx={node.x} cy={node.y} r={on ? 7 : 4.5} fill={node.color} />
                  <text x={node.x} y={node.y + 16} textAnchor="middle" fill="#eceae4" fontSize="11">
                    {node.name.length > 22 ? `${node.name.slice(0, 20)}…` : node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {active && (
          <p className="pointer-events-none absolute bottom-3 left-6 text-xs text-muted">
            {active.course} · {active.name}
          </p>
        )}
      </div>

      <form action={startGoalAction} className="border-t border-border px-4 py-4 md:px-6">
        {notice && <p className="mb-2 text-sm text-[var(--yellow)]">{notice}</p>}
        <input type="hidden" name="kind" value={kind} />
        <div className="flex items-center gap-2">
          <input
            name="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What do you want to learn?"
            aria-label="What do you want to learn?"
            className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-base outline-none placeholder:text-muted focus:border-foreground/40"
          />
          <button
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-lg text-accent-fg disabled:opacity-40"
            disabled={!goal.trim()}
            aria-label="Start"
          >
            ↵
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-border p-0.5 text-xs font-semibold tracking-wide" role="group" aria-label="Session kind">
            {(["teach", "practice"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={kind === id}
                onClick={() => setKind(id)}
                className={`rounded-full px-3 py-1.5 ${kind === id ? "bg-card text-foreground" : "text-muted"}`}
              >
                {id === "teach" ? "Teach" : "Practice"}
              </button>
            ))}
          </div>
          {dictation.supported && (
            <button type="button" className="rounded-full border border-border px-3 py-1.5 text-xs text-muted" onClick={dictation.listening ? dictation.stop : dictation.start}>
              {dictation.listening ? "Stop dictation" : "Dictate"}
            </button>
          )}
          <span className="text-xs text-muted">{kind === "teach" ? "Probe, then teach it back." : "Problems from what this topic depends on."}</span>
        </div>
      </form>
    </div>
  );
}
