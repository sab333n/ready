import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-black/6 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-6 px-5 py-4">
        <Link href="/" className="text-[1.05rem] font-semibold tracking-[-0.04em] text-[#111]">
          ready
        </Link>
        <nav className="hidden items-center gap-7 text-[0.94rem] text-[#2a2a2a] md:flex" aria-label="Marketing">
          <Link href="/#how" className="hover:text-[#111]">
            Workflow
          </Link>
          <Link href="/#teach" className="hover:text-[#111]">
            How it works
          </Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link href="/login" className="rounded-[10px] bg-[#f0eeea] px-3.5 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-[#e7e4de]">
            Log in
          </Link>
          <Link href="/login?mode=signup" className="rounded-[10px] bg-[#111] px-4 py-2 text-sm font-medium text-white hover:bg-black">
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
