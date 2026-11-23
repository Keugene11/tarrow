"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { Markdown } from "@/components/Markdown";

type Memory = { id: string; category: string; content: string; source: string; created_at: string };

const LABELS: Record<string, string> = {
  identity: "About you",
  work: "Work",
  money: "Money",
  goals: "Goals",
  blockers: "Blockers",
  people: "People",
  health: "Health & routine",
  routine: "Routine",
  interests: "Interests",
  preferences: "Preferences",
  other: "Other",
};

export function MemoryClient({ initialMemories, initialLifeFile }: { initialMemories: Memory[]; initialLifeFile: string }) {
  const [memories, setMemories] = useState(initialMemories);
  const [lifeFile, setLifeFile] = useState(initialLifeFile);
  const [tab, setTab] = useState<"file" | "facts">(initialLifeFile ? "file" : "facts");
  const [rebuilding, setRebuilding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [newCat, setNewCat] = useState("identity");
  const [error, setError] = useState("");

  const rebuild = async () => {
    setRebuilding(true);
    setError("");
    try {
      const d = await api<{ lifeFile: string }>("/api/memories", { body: { rebuild: true } });
      setLifeFile(d.lifeFile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRebuilding(false);
    }
  };

  const save = async (m: Memory) => {
    const content = draft.trim();
    if (content.length < 3) return;
    setMemories((all) => all.map((x) => (x.id === m.id ? { ...x, content } : x)));
    setEditing(null);
    await api(`/api/memories/${m.id}`, { method: "PATCH", body: { content } }).catch((err) => setError(err.message));
  };

  const remove = async (m: Memory) => {
    setMemories((all) => all.filter((x) => x.id !== m.id));
    await api(`/api/memories/${m.id}`, { method: "DELETE" }).catch((err) => setError(err.message));
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newFact.trim();
    if (content.length < 3) return;
    setError("");
    try {
      const d = await api<{ memory: Memory }>("/api/memories", { body: { content, category: newCat } });
      setMemories((all) => [d.memory, ...all]);
      setNewFact("");
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const groups = Object.keys(LABELS)
    .map((cat) => ({ cat, items: memories.filter((m) => m.category === cat) }))
    .filter((g) => g.items.length);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-4">
      <div className="mb-4 inline-flex rounded-full bg-neutral-100 p-1">
        {(["file", "facts"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`press rounded-full px-4 py-1.5 text-[13.5px] font-medium ${tab === t ? "bg-white shadow-sm" : "text-neutral-500"}`}>
            {t === "file" ? "Life file" : `Memories (${memories.length})`}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px]">{error}</p>}

      {tab === "file" ? (
        <div className="rounded-3xl border border-neutral-200 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[13px] text-neutral-500">Tarrow&apos;s running notes on your life, rewritten as it learns.</p>
            <button type="button" onClick={rebuild} disabled={rebuilding} className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${rebuilding ? "animate-spin" : ""}`} /> {rebuilding ? "Rewriting" : "Refresh"}
            </button>
          </div>
          {lifeFile ? (
            <Markdown text={lifeFile} />
          ) : (
            <p className="text-[14px] text-neutral-500">
              Nothing yet. <Link href="/onboarding" className="underline">Do the interview</Link> or just chat — Tarrow writes this as it learns about you.
            </p>
          )}
        </div>
      ) : (
        <>
          {adding ? (
            <form onSubmit={add} className="mb-4 rounded-3xl border border-neutral-200 p-3">
              <select value={newCat} onChange={(e) => setNewCat(e.target.value)} className="mb-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[13px] outline-none">
                {Object.entries(LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <textarea value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Something Tarrow should know about you" rows={2} maxLength={400} autoFocus className="w-full resize-none rounded-2xl border border-neutral-200 px-3 py-2 text-[15px] outline-none focus:border-neutral-900" />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="press rounded-full px-3.5 py-2 text-[13.5px]">
                  Cancel
                </button>
                <button type="submit" disabled={newFact.trim().length < 3} className="press rounded-full bg-neutral-900 px-4 py-2 text-[13.5px] font-medium text-white disabled:bg-neutral-200">
                  Save
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="press mb-4 inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-[13.5px] font-medium text-white">
              <Plus className="h-4 w-4" /> Add memory
            </button>
          )}
          {groups.length === 0 && <p className="text-[14px] text-neutral-500">No memories yet.</p>}
          {groups.map((g) => (
            <div key={g.cat} className="mb-5">
              <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{LABELS[g.cat]}</h3>
              <div className="overflow-hidden rounded-3xl border border-neutral-200">
                {g.items.map((m, i) => (
                  <div key={m.id} className={`flex items-start gap-2 px-4 py-2.5 ${i ? "border-t border-neutral-100" : ""}`}>
                    {editing === m.id ? (
                      <>
                        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={400} autoFocus className="min-w-0 flex-1 resize-none rounded-xl border border-neutral-300 px-2 py-1 text-[14.5px] outline-none" />
                        <button type="button" onClick={() => save(m)} aria-label="Save" className="press flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white">
                          <Check className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" className="press flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="min-w-0 flex-1 py-1 text-[14.5px] leading-snug">{m.content}</p>
                        <button type="button" onClick={() => { setEditing(m.id); setDraft(m.content); }} aria-label="Edit memory" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => remove(m)} aria-label="Delete memory" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
