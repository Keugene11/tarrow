import Link from "next/link";
import { Logo } from "./Logo";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="term min-h-[100dvh] bg-white">
      <div className="pt-safe mx-auto max-w-[720px] px-5 py-4">
        <Link href="/" className="press inline-block">
          <Logo size={24} />
        </Link>
      </div>
      <article className="md mx-auto max-w-[720px] px-5 pb-20 pt-6">
        <h1>{title}</h1>
        {children}
      </article>
    </div>
  );
}
