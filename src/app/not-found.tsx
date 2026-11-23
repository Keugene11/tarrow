import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="term flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <LogoMark size={40} />
      <h1 className="mt-5 text-[22px] font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-1 text-[15px] text-neutral-500">That page doesn&apos;t exist or was deleted.</p>
      <Link href="/c/new" className="press mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-[14px] font-medium text-white">
        Go home
      </Link>
    </div>
  );
}
