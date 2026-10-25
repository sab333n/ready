import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingNav } from "@/components/marketing";
import { currentStudent } from "@/lib/auth/session";

const FEED = [
  { mark: "CD", topic: "Cardiac Drugs", badge: "Holds", detail: "Teach-back landed · just now" },
  { mark: "AH", topic: "Antihypertensives", badge: "Probe", detail: "Waiting on your answer · 4m ago" },
  { mark: "PK", topic: "Pharmacokinetics", badge: "Gap", detail: "Last explanation slipped · 12m ago" },
] as const;

const STEPS = [
  { n: "01", title: "Find the edge.", body: "A few questions walk the topic until the explanation stops holding." },
  { n: "02", title: "Teach it out loud.", body: "Classmates ask, interrupt, and push back. You repair the gap in the moment." },
  { n: "03", title: "Bring it back.", body: "The same idea returns in practice until you can defend it without notes." },
] as const;

const CARDS = [
  { n: "1", tone: "bg-[#f6e7df]", title: "Tell it the course", body: "Drop a syllabus or your notes. Ready builds the topic map from what you actually have." },
  { n: "2", tone: "bg-[#e5f2ea]", title: "It finds the gap", body: "The probe stops at the last idea you can explain, not at a score you guessed." },
  { n: "3", tone: "bg-[#f4f0e4]", title: "You teach the class", body: "One classmate speaks at a time. Name them, or let them catch a planted mistake." },
  { n: "4", tone: "bg-[#e7eef8]", title: "You stay in control", body: "Nothing is submitted for you. The session ends when the explanation holds." },
] as const;

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="marketing min-h-dvh p-8 text-[#5a5a5a]">Loading…</p>}>
      <Landing searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Landing({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const student = await currentStudent();
  if (student) redirect(student.onboardingDoneAt ? "/learn" : "/onboarding");
  const params = await searchParams;

  return (
    <div className="marketing flex min-h-dvh flex-1 flex-col">
      <MarketingNav />
      <main>
        {params.deleted === "1" && <p className="mx-auto w-full max-w-[1180px] px-5 pt-6 text-sm text-[#5a5a5a]">Your data has been deleted.</p>}
        <section className="relative isolate overflow-hidden" aria-labelledby="hero-heading">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background: [
                "linear-gradient(105deg, rgba(255,255,255,.82) 0%, rgba(255,255,255,.5) 38%, rgba(255,255,255,.16) 70%, rgba(255,255,255,.05) 100%)",
                "radial-gradient(ellipse at 18% 42%, #ff5005 0%, transparent 52%)",
                "radial-gradient(ellipse at 78% 28%, #1a00e1 0%, transparent 48%)",
                "radial-gradient(ellipse at 55% 88%, #dbba95 0%, transparent 46%)",
                "#120a18",
              ].join(","),
            }}
          />
          <div className="relative z-10 mx-auto grid w-full max-w-[1180px] items-center gap-12 px-5 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-16 lg:py-24">
            <div>
              <p className="mb-4 text-[clamp(2.75rem,8vw,5rem)] leading-[0.9] font-medium tracking-[-0.06em] text-[#c1121f]">ready</p>
              <h1 id="hero-heading" className="max-w-[16ch] text-[clamp(1.85rem,4.4vw,3rem)] leading-[1.05] font-medium tracking-[-0.05em]">
                Know when you&apos;re not ready. Skip the cram.
              </h1>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link href="/login?mode=signup" className="rounded-lg bg-[#c1121f] px-5 py-3 text-sm font-medium text-white hover:bg-[#a40e19]">
                  Get started free
                </Link>
                <a href="#how" className="border-b border-black/35 pb-0.5 text-sm font-medium hover:border-[#111]">
                  See the workflow
                </a>
              </div>
            </div>
            <aside className="overflow-hidden rounded-[18px] border border-black/8 bg-white/95 shadow-[0_24px_50px_rgba(17,17,17,0.08)]">
              <div className="flex items-center gap-2 border-b border-black/8 bg-[#fafafa] px-3.5 py-3 text-xs font-semibold">
                <span className="size-2 rounded-full bg-[#c1121f]" />
                Topics finding you
                <span className="ml-auto text-[11px] font-normal text-[#5a5a5a]">live</span>
              </div>
              <ul className="flex flex-col gap-2 bg-[#f7f6f3] p-3">
                {FEED.map((row) => (
                  <li key={row.topic} className="grid grid-cols-[40px_1fr] gap-3 rounded-sm border border-black/8 bg-white p-3">
                    <span className="grid size-10 place-items-center rounded-lg border border-black/8 bg-[#f4f4f2] text-[11px] font-semibold">{row.mark}</span>
                    <span>
                      <span className="flex items-center gap-2 text-[13px] font-semibold">
                        {row.topic}
                        <span className="rounded-sm border border-[#c1121f]/30 px-1.5 text-[10px] tracking-wide text-[#c1121f] uppercase">{row.badge}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-[#5a5a5a]">{row.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        <section id="how" className="mx-auto w-full max-w-[1180px] px-5 py-20" aria-labelledby="how-heading">
          <h2 id="how-heading" className="max-w-[16ch] text-[clamp(1.8rem,4vw,2.6rem)] leading-tight font-medium tracking-[-0.04em]">
            Every session has a rhythm.
          </h2>
          <ol className="mt-10 grid gap-8 lg:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n}>
                <div className="mb-4 grid h-28 place-items-center rounded-2xl border border-black/8 bg-[#fafafa] text-[#c1121f]" aria-hidden>
                  <StepMark n={step.n} />
                </div>
                <p className="text-xs font-semibold tracking-wide text-[#5a5a5a]">Step {step.n}</p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5a5a5a]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="teach" className="border-t border-black/8 bg-[#fafafa]">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-20">
            <h2 className="max-w-[22ch] text-[clamp(1.8rem,4vw,2.6rem)] leading-tight font-medium tracking-[-0.04em]">
              Give the explanation a real audience.
              <span className="mt-2 block text-[#5a5a5a]">Probe, teach, and practice from your own notes.</span>
            </h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2">
              {CARDS.map((card) => (
                <li key={card.n} className={`rounded-3xl p-5 ${card.tone}`}>
                  <h3 className="text-lg font-semibold tracking-[-0.03em]">
                    <span className="mr-2 text-[#5a5a5a]">{card.n}</span>
                    {card.title}
                  </h3>
                  <p className="mt-2 max-w-prose text-sm leading-relaxed text-[#3a3a3a]">{card.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <footer className="mt-auto border-t border-black/8 px-5 py-8 text-center text-xs text-[#5a5a5a]">
        Your study data stays yours. You can delete everything at any time.
      </footer>
    </div>
  );
}

function StepMark({ n }: { n: string }) {
  if (n === "01") {
    return (
      <svg width="120" height="48" viewBox="0 0 120 48" fill="none">
        <path d="M8 36 C28 36 32 12 52 12 C72 12 76 28 96 28" stroke="currentColor" strokeWidth="2" />
        <circle cx="96" cy="28" r="4" fill="currentColor" />
      </svg>
    );
  }
  if (n === "02") {
    return (
      <svg width="120" height="48" viewBox="0 0 120 48" fill="none">
        <rect x="16" y="10" width="36" height="22" rx="6" stroke="currentColor" strokeWidth="2" />
        <rect x="68" y="18" width="36" height="22" rx="6" stroke="#111" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width="120" height="48" viewBox="0 0 120 48" fill="none">
      <circle cx="28" cy="24" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="24" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="92" cy="24" r="6" fill="currentColor" />
    </svg>
  );
}
