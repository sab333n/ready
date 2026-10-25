import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MarketingNav } from "@/components/marketing";
import { currentStudent } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense fallback={<p className="marketing min-h-dvh p-8 text-[#5a5a5a]">Opening sign-in…</p>}>
      <Gate searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const student = await currentStudent();
  if (student) redirect(student.onboardingDoneAt ? "/learn" : "/onboarding");
  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : "signin";
  const error = typeof params.error === "string" ? params.error : undefined;
  return (
    <div className="marketing flex min-h-dvh flex-1 flex-col">
      <MarketingNav />
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <section className="w-full max-w-md space-y-4 rounded-2xl border border-black/8 bg-white p-6 shadow-[0_24px_50px_rgba(17,17,17,0.06)]">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.04em]">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
            <p className="text-sm text-[#5a5a5a]">Continue with Google, or use an email and password.</p>
          </div>
          <LoginForm key={mode} mode={mode} error={error} />
        </section>
      </main>
    </div>
  );
}
