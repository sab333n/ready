import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, Shell } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { currentStudent } from "@/lib/auth/session";
import { supabaseAuthEnabled } from "@/lib/env";
import { SignInForm } from "./SignInForm";

export default function Home(props: PageProps<"/">) {
  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Know when you&apos;re not ready — before it&apos;s too late.</h1>
          <p className="text-muted">
            {APP_NAME} learns your deadlines and goals, texts you when a topic is shaky, and gets you ready by having you teach it to
            AI classmates who ask questions and push back.
          </p>
        </div>
        <Card>
          <Suspense fallback={null}>
            <SignInGate searchParams={props.searchParams} />
          </Suspense>
        </Card>
        <p className="text-xs text-muted">
          Your study data stays yours. We never ask for logins to homework sites, never share your work, and you can delete
          everything at any time.
        </p>
      </div>
    </Shell>
  );
}

async function SignInGate({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const student = await currentStudent();
  if (student) redirect(student.onboardingDoneAt ? "/map" : "/onboarding");
  const params = await searchParams;
  return (
    <div className="space-y-3">
      {params.deleted && <p className="text-sm">Your data has been deleted.</p>}
      {typeof params.error === "string" && <p className="text-sm text-[var(--red)]">{params.error}</p>}
      <SignInForm magicLink={supabaseAuthEnabled()} />
    </div>
  );
}
