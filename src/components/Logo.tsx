export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-t-inv" />
      <path d="M9 10.5h14" className="stroke-t-inv-fg" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 10.5v11.5" className="stroke-t-inv-fg" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12.2 18.4 16 22.2l3.8-3.8" className="stroke-t-inv-fg" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-[17px] font-bold tracking-tight">tarrow</span>
    </span>
  );
}
