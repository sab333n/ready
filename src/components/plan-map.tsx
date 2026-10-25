import type { PlanNode, PlanStatus } from "@/lib/learn/plan";

const LABEL: Record<PlanStatus, string> = {
  current: "Now",
  held: "Holds",
  gap: "Gap",
  upcoming: "Ahead",
  goal: "Goal",
};

const DOT: Record<PlanStatus, string> = {
  current: "bg-gold",
  held: "bg-[var(--green)]",
  gap: "bg-[var(--red)]",
  upcoming: "bg-border",
  goal: "bg-foreground",
};

export function PlanMap({ nodes }: { nodes: PlanNode[] }) {
  if (nodes.length === 0) return <p className="text-sm text-muted">The lesson map appears once a topic is chosen.</p>;
  return (
    <ol className="flex flex-col">
      {nodes.map((node, i) => (
        <li key={node.id}>
          {i > 0 && <div className="ml-[7px] h-5 w-px bg-border" />}
          <div className={`rounded-xl border px-3 py-2 ${node.status === "current" ? "border-gold bg-card" : "border-transparent"}`}>
            <div className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${DOT[node.status]}`} />
              <span className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">{LABEL[node.status]}</span>
            </div>
            <p className={`mt-0.5 pl-4 text-sm leading-snug ${node.status === "upcoming" ? "text-muted" : ""}`}>{node.name}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
