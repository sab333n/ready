import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass, Card, Shell } from "@/components/ui";
import { currentStudent } from "@/lib/auth/session";
import { semesterMap } from "@/lib/db/repo";
import { CalendarForm, UploadForm } from "./forms";

export default function ConnectPage() {
  return (
    <Shell step="Step 2 of 2 · Your deadlines">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s map your semester</h1>
          <p className="text-muted">Connect your course calendar, then add a syllabus. Either one is enough to start.</p>
        </div>
        <Card>
          <h2 className="font-medium">1. Course calendar</h2>
          <p className="mb-3 text-sm text-muted">
            Canvas: Calendar → Calendar Feed. Moodle: Calendar → Export calendar → Get calendar URL. Blackboard: Calendar →
            Share calendar. Copy the link and paste it here.
          </p>
          <CalendarForm />
        </Card>
        <Card>
          <h2 className="font-medium">2. Syllabus, slides or screenshots</h2>
          <p className="mb-3 text-sm text-muted">
            PDFs or screenshots (like a Pearson assignment list). We pull out deadlines and topics. We never ask for your
            homework-site logins.
          </p>
          <UploadForm />
        </Card>
        <Suspense fallback={null}>
          <Progress />
        </Suspense>
      </div>
    </Shell>
  );
}

async function Progress() {
  const student = await currentStudent();
  if (!student) redirect("/");
  if (!student.onboardingDoneAt) redirect("/onboarding");
  const map = await semesterMap(student.id);
  const ready = map.deadlines.length > 0;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted">
        So far: {map.deadlines.length} deadlines, {map.topics.length} topics, {map.materialCount} files.
      </p>
      <Link href="/map" className={buttonClass} aria-disabled={!ready}>
        See my semester map
      </Link>
    </div>
  );
}
