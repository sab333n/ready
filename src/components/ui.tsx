import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export function Shell({ children, step }: { children: React.ReactNode; step?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-10">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        {step && <span className="text-sm text-muted">{step}</span>}
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-4 sm:p-5 ${className}`}>{children}</section>;
}

export const buttonClass =
  "inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-50";
export const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-base outline-none focus:border-accent";
