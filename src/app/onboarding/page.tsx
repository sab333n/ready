import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/components/ui";
import { currentStudent } from "@/lib/auth/session";
import { onboardingState } from "@/lib/db/repo";
import { viewFor } from "./view";
import { Chat } from "./Chat";

export default function OnboardingPage() {
  return (
    <Shell step="Step 1 of 2 · About you">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <OnboardingChat />
      </Suspense>
    </Shell>
  );
}

async function OnboardingChat() {
  const student = await currentStudent();
  if (!student) redirect("/");
  const view = viewFor(onboardingState(student));
  return <Chat initial={view} />;
}
