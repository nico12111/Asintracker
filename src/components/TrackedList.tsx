"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TrackedItem {
  id: string;
  asin: string;
  title: string | null;
}

export function TrackedList({ items }: { items: TrackedItem[] }) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function remove(id: string, asin: string) {
    if (!confirm(`ASIN ${asin} entfernen?`)) return;
    setBusy((b) => ({ ...b, [id]: true }));
    await fetch(`/api/asins/${id}`, { method: "DELETE" });
    setList((prev) => prev.filter((p) => p.id !== id));
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="font-semibold">
          Bereits getrackt <span className="text-slate-400">({list.length})</span>
        </h2>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          Noch keine ASINs gespeichert.
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-slate-800 overflow-y-auto">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <a
                href={`https://www.amazon.de/dp/${p.asin}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-slate-400 hover:text-emerald-400"
              >
                {p.asin}
              </a>
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {p.title ?? ""}
              </span>
              <button
                onClick={() => remove(p.id, p.asin)}
                disabled={busy[p.id]}
                title="ASIN entfernen"
                className="rounded border border-slate-700 px-2 py-1 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-50"
              >
                {busy[p.id] ? "…" : "✕ Entfernen"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
