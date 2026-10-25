import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Studio } from "@/components/studio";
import { buttonClass, Card, secondaryButtonClass } from "@/components/ui";
import { currentStudent } from "@/lib/auth/session";
import { classByJoinCode, classLabel } from "@/lib/db/classes";
import { sharingConsentText } from "@/lib/classes/report";
import { joinClassAction } from "./actions";

export default function JoinPage(props: PageProps<"/join">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Looking up the class…</p>}>
      <Join searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Join({ searchParams }: { searchParams: PageProps<"/join">["searchParams"] }) {
  const student = await currentStudent();
  if (!student) redirect("/login");
  const raw = (await searchParams).code;
  const code = typeof raw === "string" ? raw.trim() : "";
  const cls = code ? await classByJoinCode(code) : null;

  return (
    <Studio>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-10">
        {!cls ? (
          <Card>
            <h1 className="text-xl font-semibold">That code didn&apos;t match a class</h1>
            <p className="mt-1 text-muted">Check the code your instructor gave you{code ? ` (you typed ${code.toUpperCase()})` : ""}. It looks like PHARM-7KQ2.</p>
            <Link href="/map" className={`${secondaryButtonClass} mt-4`}>
              Back to my semester
            </Link>
          </Card>
        ) : (
          <Card className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">Share with your instructor</p>
              <h1 className="mt-1 text-2xl font-semibold">{classLabel(cls)}</h1>
              <p className="text-muted">{cls.instructor}</p>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm leading-6">{sharingConsentText(cls.instructor, classLabel(cls))}</div>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              <li className="rounded-xl border border-border p-3">
                <p className="font-medium text-[var(--green)]">They will see</p>
                <p className="text-muted">Readiness per topic and per test in {cls.displayCode}, &ldquo;sure but wrong&rdquo; flags, when you last studied.</p>
              </li>
              <li className="rounded-xl border border-border p-3">
                <p className="font-medium">They won&apos;t see</p>
                <p className="text-muted">Your notes and files, what you said in sessions, your answers, other courses, or your phone number.</p>
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <form action={joinClassAction}>
                <input type="hidden" name="classId" value={cls.id} />
                <button className={buttonClass}>I agree, share my progress</button>
              </form>
              <Link href="/map" className={secondaryButtonClass}>
                Not now
              </Link>
            </div>
          </Card>
        )}
      </div>
    </Studio>
  );
}
