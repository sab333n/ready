import { Suspense } from "react";
import { redirect } from "next/navigation";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { Studio } from "@/components/studio";
import { currentStudent } from "@/lib/auth/session";
import { placeGraph } from "@/lib/learn/layout";
import { learnOverview } from "@/lib/lesson/service";

export default function LearnPage(props: PageProps<"/learn">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Building your map…</p>}>
      <Home searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/learn">["searchParams"] }) {
  const student = await currentStudent();
  if (!student) redirect("/");
  if (!student.onboardingDoneAt) redirect("/onboarding");
  const params = await searchParams;
  const mode = params.mode === "practice" ? "practice" : "teach";
  const miss = typeof params.miss === "string" ? params.miss : "";
  const notice = !miss ? null : `No topic matched “${miss}”. Type it again and Ready will write the outline.`;
  const overview = await learnOverview(student);
  const placed = placeGraph(
    overview.map((c) => ({
      id: c.course.id,
      code: c.course.displayCode,
      color: c.course.color,
      topics: c.topics.map((t) => ({ id: t.id, name: t.name })),
      edges: c.edges,
    })),
  );
  return (
    <Studio mode={mode}>
      <KnowledgeGraph nodes={placed.nodes} links={placed.links} height={placed.height} mode={mode} notice={notice} />
    </Studio>
  );
}
