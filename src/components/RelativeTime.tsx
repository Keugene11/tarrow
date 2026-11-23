"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/client";

/** Renders relative time on the client only, avoiding server/client hydration mismatches. */
export function RelativeTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(timeAgo(iso));
    const t = setInterval(() => setText(timeAgo(iso)), 60_000);
    return () => clearInterval(t);
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}

/** Formats a timestamp in the viewer's timezone after hydration. */
export function LocalTime({ iso, options }: { iso: string; options: Intl.DateTimeFormatOptions }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}
