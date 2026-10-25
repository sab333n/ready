import { Suspense } from "react";
import Link from "next/link";
import { currentFaculty } from "@/lib/auth/faculty";
import { classLabel, facultyClasses } from "@/lib/db/classes";
import { secondaryButtonClass } from "@/components/ui";
import { facultySignOut } from "./actions";
import { CreateClassForm, FacultyAuthForm } from "./forms";

export default function FacultyHome(props: PageProps<"/faculty">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading…</p>}>
      <Home searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/faculty">["searchParams"] }) {
  const faculty = await currentFaculty();
  if (!faculty) {
    const mode = (await searchParams).mode === "signup" ? "signup" : "signin";
    return (
      <main className="mx-auto grid w-full max-w-[1000px] flex-1 items-center gap-10 px-5 py-12 md:grid-cols-2">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">See who isn&apos;t ready, before the exam does.</h1>
          <p className="text-[#5a5a5a]">
            Your students teach each topic to AI students. Ready turns that into readiness per topic and per test, and shows you who needs help this week and
            which ideas the class is confidently wrong about.
          </p>
          <p className="text-sm text-[#5a5a5a]">Students choose to share, see exactly what you&apos;ll see, and can stop any time. You never see their notes or what they said.</p>
        </div>
        <section className="rounded-2xl border border-black/8 bg-white p-6 shadow-[0_24px_50px_rgba(17,17,17,0.06)]">
          <h2 className="mb-4 text-xl font-semibold tracking-[-0.03em]">{mode === "signup" ? "Create an instructor account" : "Instructor sign-in"}</h2>
          <FacultyAuthForm key={mode} mode={mode} />
        </section>
      </main>
    );
  }

  const classes = await facultyClasses(faculty.id);
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">Your classes</h1>
          <p className="text-[#5a5a5a]">
            {faculty.displayName}
            {faculty.school ? ` · ${faculty.school}` : ""}
          </p>
        </div>
        <form action={facultySignOut}>
          <button className={secondaryButtonClass}>Sign out</button>
        </form>
      </div>

      {classes.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/faculty/class/${c.id}`} className="block rounded-2xl border border-black/8 p-5 hover:border-black/25">
                <p className="text-xs font-semibold tracking-wide text-[#5a5a5a] uppercase">{c.displayCode}</p>
                <p className="mt-1 text-lg font-semibold">{classLabel(c)}</p>
                <p className="mt-2 text-sm text-[#5a5a5a]">
                  {c.sharing} of {c.members} students sharing · join code <span className="font-mono text-[#111]">{c.joinCode}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-black/8 p-5">
        <h2 className="mb-1 text-lg font-semibold">{classes.length ? "Add a class" : "Create your first class"}</h2>
        <p className="mb-4 text-sm text-[#5a5a5a]">Use the course code from Canvas, so Ready matches the deadlines and topics students already imported.</p>
        <CreateClassForm />
      </section>
    </main>
  );
}
