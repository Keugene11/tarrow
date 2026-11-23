"use client";

import { confirmDialog } from "@/components/Dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { api } from "@/lib/client";

export function DocActions({ id, content }: { id: string; content: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-1">
      <button
        type="button"
        aria-label="Copy document"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
        className="press flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
      <button
        type="button"
        aria-label="Delete document"
        onClick={async () => {
          if (!(await confirmDialog({ title: "Delete this document?", confirmLabel: "Delete", danger: true }))) return;
          await api(`/api/documents/${id}`, { method: "DELETE" }).catch(() => {});
          router.push("/library");
          router.refresh();
        }}
        className="press flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
