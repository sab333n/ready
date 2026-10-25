import Link from "next/link";

// Instructors get the light frame: this is a work tool read at a desk, often projected.
export default function FacultyLayout({ children }: LayoutProps<"/faculty">) {
  return (
    <div className="marketing flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-black/6">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-5 py-4">
          <Link href="/faculty" className="text-[1.05rem] font-semibold tracking-[-0.04em]">
            ready <span className="font-normal text-[#5a5a5a]">for instructors</span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
