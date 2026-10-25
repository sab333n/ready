import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass, Card, Shell } from "@/components/ui";
import { currentStudent } from "@/lib/auth/session";
import { canvasLink, semesterMap } from "@/lib/db/repo";
import { CalendarForm, CanvasForm, UploadForm } from "./forms";

export default function ConnectPage() {
  return (
    <Shell step="Step 2 of 2 · Your deadlines">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s map your semester</h1>
          <p className="text-muted">Connect Canvas to pull due dates, the syllabus, and posted readings. A calendar feed or a PDF still works on its own.</p>
        </div>
        <Card>
          <h2 className="font-medium">1. Canvas</h2>
          <p className="mb-3 text-sm text-muted">
            On the Canvas website, open Account, then Settings, and scroll to Approved Integrations. Add New Access Token is there only if your school allows it. Paste your school address and that token. Ready then reads due dates, the syllabus page, and posted PDFs, PowerPoint, and Word files. If the button is missing or greyed out, the school has blocked student tokens. Use the calendar feed and the upload box below. Ready never asks for your Canvas password.
          </p>
          <Suspense fallback={null}>
            <CanvasSlot />
          </Suspense>
        </Card>
        <Card>
          <h2 className="font-medium">2. Course calendar</h2>
          <p className="mb-3 text-sm text-muted">
            Canvas: Calendar → Calendar Feed. Moodle: Calendar → Export calendar → Get calendar URL. Blackboard: Calendar →
            Share calendar. Copy the link and paste it here.
          </p>
          <CalendarForm />
        </Card>
        <Card>
          <h2 className="font-medium">3. Syllabus, slides or screenshots</h2>
          <p className="mb-3 text-sm text-muted">
            PDFs, PowerPoint, Word files, or screenshots (like a Pearson assignment list). We pull out deadlines and topics. We never ask for your
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

async function CanvasSlot() {
  const student = await currentStudent();
  if (!student) return null;
  const link = await canvasLink(student.id);
  return <CanvasForm connected={link?.baseUrl ?? null} />;
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
