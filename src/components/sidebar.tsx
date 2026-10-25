"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { deleteMyData, signOut } from "@/app/auth/actions";

export type StudioSession = {
  id: string;
  topicName: string;
  stage: string;
  type: "teach" | "practice";
  when: string;
};

export function Sidebar({ sessions, mode }: { sessions: StudioSession[]; mode: "teach" | "practice" | "all" }) {
  const path = usePathname();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(mode);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => (filter === "all" || s.type === filter) && (!q || s.topicName.toLowerCase().includes(q)));
  }, [sessions, filter, query]);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Link href="/learn" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-full border border-border text-[11px]">R</span>
          Ready
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 text-sm">
        <SideLink href="/learn" active={path === "/learn" && mode !== "practice"}>
          Teaching
        </SideLink>
        <SideLink href="/learn?mode=practice" active={mode === "practice"}>
          Practice
        </SideLink>
      </nav>
      <div className="px-3 pt-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted focus:border-foreground/40"
        />
        <div className="mt-2 flex rounded-lg border border-border p-0.5 text-[11px] font-semibold tracking-wide" role="group" aria-label="Filter sessions">
          {(
            [
              ["teach", "Teaching"],
              ["practice", "Practice"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`flex-1 rounded-md px-1.5 py-1 ${filter === id ? "bg-card text-foreground" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-2 flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && (
          <li className="px-2 py-3 text-xs text-muted" suppressHydrationWarning>
            No sessions yet.
          </li>
        )}
        {shown.map((s) => {
          const active = path === `/session/${s.id}`;
          return (
            <li key={s.id} suppressHydrationWarning>
              <Link href={`/session/${s.id}`} className={`block rounded-lg px-2.5 py-2 ${active ? "bg-card" : "hover:bg-card/60"}`}>
                <div className="truncate text-sm">{s.topicName}</div>
                <div className="truncate text-xs text-muted">
                  {blurb(s)} · {s.when}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border p-2">
        <details className="rounded-lg">
          <summary className="cursor-pointer list-none rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-card/60 [&::-webkit-details-marker]:hidden">
            Settings
          </summary>
          <div className="flex flex-col px-2 pb-2 text-sm">
            <Link href="/map" className="rounded-md px-2 py-1.5 hover:bg-card">
              Semester
            </Link>
            <Link href="/connect" className="rounded-md px-2 py-1.5 hover:bg-card">
              Add materials
            </Link>
            <form action={signOut}>
              <button className="w-full rounded-md px-2 py-1.5 text-left hover:bg-card">Sign out</button>
            </form>
            <form action={deleteMyData}>
              <button className="w-full rounded-md px-2 py-1.5 text-left text-[var(--red)] hover:bg-card">Delete my data</button>
            </form>
          </div>
        </details>
      </div>
    </aside>
  );
}

function SideLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 ${active ? "bg-card text-foreground" : "text-muted hover:bg-card/50"}`}>
      {children}
    </Link>
  );
}

function blurb(s: StudioSession) {
  if (s.stage === "diagnostic") return s.type === "practice" ? "Practice question waiting" : "Waiting for your answer";
  if (s.stage === "teach") return "Teaching";
  if (s.stage === "teach_back") return "Teach-back";
  if (s.type === "practice") return "Practice finished";
  return "Reflection ready";
}

