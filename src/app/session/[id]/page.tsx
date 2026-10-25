import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Studio } from "@/components/studio";
import { currentStudent } from "@/lib/auth/session";
import { getSession } from "@/lib/db/lessons";
import type { Reflection } from "@/lib/lesson/service";
import { lessonView } from "../view";
import { Lesson } from "./Lesson";
import { ReflectionView } from "./ReflectionView";

export default function SessionPage(props: PageProps<"/session/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Opening the session…</p>}>
      <SessionContent params={props.params} />
    </Suspense>
  );
}

async function SessionContent({ params }: { params: PageProps<"/session/[id]">["params"] }) {
  const student = await currentStudent();
  if (!student) redirect("/");
  const { id } = await params;
  const session = await getSession(student.id, id).catch(() => null);
  if (!session) notFound();
  const mode = session.type === "practice" ? "practice" : "teach";
  if (session.stage === "done" && session.reflection) {
    return (
      <Studio mode={mode}>
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <ReflectionView reflection={session.reflection as Reflection} sessionId={session.id} />
        </div>
      </Studio>
    );
  }
  return (
    <Studio mode={mode}>
      <Lesson initial={await lessonView(session)} />
    </Studio>
  );
}
