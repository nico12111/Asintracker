"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshIdsInBatches } from "@/lib/client-refresh";

export function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(payload: string) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/asins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Fehler beim Import.");
        return;
      }
      const added = data.added?.length ?? 0;
      const skipped = data.skipped?.length ?? 0;
      const ids: string[] = data.ids ?? [];
      setText("");
      // The list updates instantly; Amazon data streams in batch by batch.
      router.refresh();
      if (ids.length > 0) {
        setResult(`${added} hinzugefügt – lade Amazon-Daten (0/${ids.length})…`);
        await refreshIdsInBatches(ids, (done, total) => {
          setResult(
            done < total
              ? `${added} hinzugefügt – lade Amazon-Daten (${done}/${total})…`
              : `${added} neu hinzugefügt, ${skipped} bereits vorhanden (${data.total} erkannt). Amazon-Daten geladen.`,
          );
          router.refresh();
        });
      } else {
        setResult(
          `${added} neu hinzugefügt, ${skipped} bereits vorhanden (${data.total} erkannt).`,
        );
      }
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => submit(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={"B0DVGW1KF8\nB0DVGWCGD4\nhttps://www.amazon.de/dp/B08N5WRWNW"}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-sm outline-none focus:border-emerald-500"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => submit(text)}
          disabled={isPending || !text.trim()}
          className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {isPending ? "Importiere…" : "Importieren & Preise laden"}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isPending}
          className="rounded-lg border border-slate-700 px-4 py-2 hover:bg-slate-800"
        >
          Datei (CSV/TXT) wählen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={onFile}
          className="hidden"
        />
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {result}{" "}
          <button
            onClick={() => router.push("/")}
            className="underline underline-offset-2"
          >
            Zum Dashboard →
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}
