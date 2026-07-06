"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductDTO } from "@/lib/serialize";
import { computeMargin, formatEuro, formatPct } from "@/lib/margin";

export interface MarginSettings {
  referralFeePct: number;
  fulfillmentEur: number;
  minRoiPct: number;
}

const STORAGE_KEY = "asintracker.margin";

function withMargin(p: ProductDTO, s: MarginSettings): ProductDTO {
  return {
    ...p,
    margin: computeMargin({
      amazonPriceCents: p.amazonPriceCents,
      bestBuyPriceCents: p.bestOffer?.priceCents ?? null,
      referralFeePct: s.referralFeePct,
      fulfillmentFeeCents: Math.round((s.fulfillmentEur || 0) * 100),
      minRoiPct: s.minRoiPct,
    }),
  };
}

function offerFor(p: ProductDTO, source: "idealo" | "billiger") {
  return p.offers.find((o) => o.source === source) ?? null;
}

export function ProductTable({
  initialProducts,
  defaultSettings,
  liveSources,
}: {
  initialProducts: ProductDTO[];
  defaultSettings: MarginSettings;
  liveSources: { idealo: boolean; billiger: boolean };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState(initialProducts);
  const [settings, setSettings] = useState<MarginSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyOpportunities, setOnlyOpportunities] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [addValue, setAddValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isPending, startTransition] = useTransition();

  // Restore saved margin settings.
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const computed = useMemo(
    () => products.map((p) => withMargin(p, settings)),
    [products, settings],
  );

  const opportunities = computed.filter((p) => p.margin.isBuyOpportunity).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computed
      .filter((p) => {
        if (onlyOpportunities && !p.margin.isBuyOpportunity) return false;
        if (!q) return true;
        return [p.asin, p.title, p.brand, p.category, p.ean]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          (b.margin.roiPct ?? -Infinity) - (a.margin.roiPct ?? -Infinity),
      );
  }, [computed, search, onlyOpportunities]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function patch(id: string, product: ProductDTO) {
    setProducts((prev) => prev.map((p) => (p.id === id ? product : p)));
  }

  async function refreshOne(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/asins/${id}`, { method: "POST" });
      const data = await res.json();
      if (data.product) patch(id, data.product);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function setGtin(id: string, current: string | null) {
    const input = window.prompt(
      "GTIN/EAN für die idealo-Suche eintragen (13-stellig):",
      current ?? "",
    );
    if (input == null) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/asins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ean: input }),
      });
      const data = await res.json();
      if (data.product) patch(id, data.product);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function reload() {
    const res = await fetch("/api/asins");
    const data = await res.json();
    if (data.products) setProducts(data.products);
  }

  function refreshSelected() {
    const ids = selected.size > 0 ? [...selected] : products.map((p) => p.id);
    startTransition(async () => {
      await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await reload();
      router.refresh();
    });
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`${ids.length} Produkt(e) entfernen?`)) return;
    await Promise.all(
      ids.map((id) => fetch(`/api/asins/${id}`, { method: "DELETE" })),
    );
    setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
  }

  async function removeOne(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    await fetch(`/api/asins/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  function addAsins(text: string) {
    if (!text.trim()) return;
    startTransition(async () => {
      const res = await fetch("/api/asins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotice(
          `${data.added?.length ?? 0} hinzugefügt · ${data.skipped?.length ?? 0} bereits vorhanden`,
        );
        setAddValue("");
        await reload();
      } else {
        setNotice(data.error ?? "Fehler beim Hinzufügen.");
      }
    });
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addAsins(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  function exportCsv() {
    const rows = filtered.map((p) => ({
      asin: p.asin,
      titel: p.title ?? "",
      marke: p.brand ?? "",
      kategorie: p.category ?? "",
      bsr: p.salesRank ?? "",
      amazon_eur: p.amazonPriceCents != null ? p.amazonPriceCents / 100 : "",
      idealo_eur: offerFor(p, "idealo")
        ? offerFor(p, "idealo")!.priceCents / 100
        : "",
      billiger_eur: offerFor(p, "billiger")
        ? offerFor(p, "billiger")!.priceCents / 100
        : "",
      bester_ek_eur:
        p.bestOffer != null ? p.bestOffer.priceCents / 100 : "",
      gewinn_eur:
        p.margin.profitCents != null ? p.margin.profitCents / 100 : "",
      roi_pct: p.margin.roiPct != null ? p.margin.roiPct.toFixed(1) : "",
    }));
    const header = Object.keys(
      rows[0] ?? { asin: "", titel: "", marke: "" },
    );
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        header
          .map((h) => `"${String((r as any)[h]).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asintracker-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pageIds = pageItems.map((p) => p.id);
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-slate-400">
          <span className="font-medium text-slate-200">{products.length}</span>{" "}
          getrackt ·{" "}
          <span className="font-medium text-emerald-400">{opportunities}</span>{" "}
          Einkaufs-Chance(n)
        </div>

        <input
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAsins(addValue)}
          placeholder="ASIN oder Amazon-URL"
          className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => addAsins(addValue)}
          disabled={isPending}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          + Hinzufügen
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={onImportFile}
          className="hidden"
        />
        <button
          onClick={exportCsv}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Export
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {notice}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Produkte suchen (ASIN, Titel, Marke, Kategorie, EAN)"
          className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlyOpportunities}
            onChange={(e) => {
              setOnlyOpportunities(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4"
          />
          Nur Chancen
        </label>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-sm ${
            showSettings
              ? "border-emerald-500 text-emerald-400"
              : "border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          ⚙ Marge
        </button>
        <button
          onClick={refreshSelected}
          disabled={isPending}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Aktualisiere…" : "Preise aktualisieren"}
        </button>
      </div>

      {/* Margin settings */}
      {showSettings && (
        <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-3">
          <NumberField
            label="Amazon-Gebühr (%)"
            hint="Verkaufsprovision vom VK"
            value={settings.referralFeePct}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, referralFeePct: v }))}
          />
          <NumberField
            label="Versand/FBA (€)"
            hint="Pauschale pro Einheit"
            value={settings.fulfillmentEur}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, fulfillmentEur: v }))}
          />
          <NumberField
            label="Mindest-ROI (%)"
            hint="Ab hier gilt es als Kauf-Chance"
            value={settings.minRoiPct}
            step={1}
            onChange={(v) => setSettings((s) => ({ ...s, minRoiPct: v }))}
          />
          <p className="text-xs text-slate-500 sm:col-span-3">
            Gewinn = Amazon-VK − Gebühr − Versand − bester EK (idealo/billiger).
            Einstellungen werden lokal gespeichert und live angewendet.
          </p>
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm">
          <span>{selected.size} ausgewählt</span>
          <button onClick={refreshSelected} className="underline">
            Aktualisieren
          </button>
          <button onClick={removeSelected} className="text-rose-400 underline">
            Entfernen
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-slate-400"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[1240px] text-sm">
          <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  className="h-4 w-4"
                />
              </th>
              <th className="px-3 py-3">ASIN / Titel</th>
              <th className="px-3 py-3">Marke</th>
              <th className="px-3 py-3">Kategorie</th>
              <th className="px-3 py-3 text-right">BSR</th>
              <th className="px-3 py-3 text-right">Amazon</th>
              <th className="px-3 py-3 text-right">idealo</th>
              <th className="px-3 py-3 text-right">billiger</th>
              <th className="px-3 py-3 text-right">Bester EK</th>
              <th className="px-3 py-3 text-right">Gewinn</th>
              <th className="px-3 py-3 text-right">ROI</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pageItems.map((p) => {
              const idealo = offerFor(p, "idealo");
              const billiger = offerFor(p, "billiger");
              const idealoDemo = !liveSources.idealo;
              const billigerDemo = !liveSources.billiger;
              const profit = p.margin.profitCents;

              // Which LIVE source is cheaper (demo prices are not trusted).
              const live: Array<["idealo" | "billiger", number]> = [];
              if (idealo && !idealoDemo) live.push(["idealo", idealo.priceCents]);
              if (billiger && !billigerDemo)
                live.push(["billiger", billiger.priceCents]);
              const cheaper =
                live.length > 0
                  ? live.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
                  : null;
              return (
                <tr
                  key={p.id}
                  className={`hover:bg-slate-900/60 ${
                    p.margin.isBuyOpportunity ? "bg-emerald-950/30" : ""
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                          return next;
                        })
                      }
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-9 w-9 flex-shrink-0 rounded bg-white object-contain"
                        />
                      ) : (
                        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded bg-slate-800 text-[10px] text-slate-500">
                          IMG
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="max-w-[280px] truncate">
                            {p.title ?? p.asin}
                          </span>
                          {p.margin.isBuyOpportunity && (
                            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                              KAUFEN
                            </span>
                          )}
                        </div>
                        <a
                          href={`https://www.amazon.de/dp/${p.asin}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-slate-500 hover:text-emerald-400"
                        >
                          {p.asin}
                        </a>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{p.brand ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {p.category ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {p.salesRank != null
                      ? p.salesRank.toLocaleString("de-DE")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatEuro(p.amazonPriceCents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {idealo ? (
                      <span className="inline-flex items-center gap-1.5">
                        <OfferCell offer={idealo} demo={idealoDemo} />
                        <button
                          onClick={() => setGtin(p.id, p.manualEan ?? p.ean)}
                          disabled={busy[p.id]}
                          title="GTIN korrigieren"
                          className="text-slate-500 hover:text-emerald-400"
                        >
                          ✎
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setGtin(p.id, p.manualEan ?? p.ean)}
                        disabled={busy[p.id]}
                        title="GTIN für idealo-Suche eintragen"
                        className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        {busy[p.id] ? "…" : "+ GTIN"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <OfferCell offer={billiger} demo={billigerDemo} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatEuro(p.bestOffer?.priceCents ?? null)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      profit == null
                        ? "text-slate-500"
                        : profit > 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }`}
                    title={`Netto nach Gebühren: ${formatEuro(
                      p.margin.netProceedsCents,
                    )} (Gebühren ${formatEuro(p.margin.feesCents)})`}
                  >
                    {formatEuro(profit)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      p.margin.roiPct != null && p.margin.roiPct > 0
                        ? "text-emerald-400"
                        : "text-slate-500"
                    }`}
                  >
                    {formatPct(p.margin.roiPct)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <BuyButton
                        label="idealo"
                        variant="blue"
                        offer={idealo}
                        demo={idealoDemo}
                        cheaper={cheaper === "idealo"}
                      />
                      <BuyButton
                        label="billiger.de"
                        variant="white"
                        offer={billiger}
                        demo={billigerDemo}
                        cheaper={cheaper === "billiger"}
                      />
                      <button
                        onClick={() => refreshOne(p.id)}
                        disabled={busy[p.id]}
                        title="Aktualisieren"
                        className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
                      >
                        {busy[p.id] ? "…" : "↻"}
                      </button>
                      <button
                        onClick={() => removeOne(p.id)}
                        disabled={busy[p.id]}
                        title="Entfernen"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <div>
          {filtered.length === 0
            ? "Keine Treffer"
            : `${(currentPage - 1) * pageSize + 1}–${Math.min(
                currentPage * pageSize,
                filtered.length,
              )} von ${filtered.length}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          >
            ‹
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          >
            ›
          </button>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / Seite
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-200">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}

function OfferCell({
  offer,
  demo,
}: {
  offer: ProductDTO["offers"][number] | null;
  demo?: boolean;
}) {
  if (!offer) return <span className="text-slate-600">—</span>;
  const price = (
    <span
      className={
        offer.inStock
          ? demo
            ? "text-amber-400/80"
            : ""
          : "text-slate-500 line-through"
      }
    >
      {formatEuro(offer.priceCents)}
    </span>
  );
  const content = demo ? (
    <span className="inline-flex items-center gap-1">
      {price}
      <span className="rounded bg-amber-500/20 px-1 text-[9px] font-medium text-amber-400">
        DEMO
      </span>
    </span>
  ) : (
    price
  );
  return offer.url && !demo ? (
    <a
      href={offer.url}
      target="_blank"
      rel="noreferrer"
      className="hover:text-emerald-400"
    >
      {content}
    </a>
  ) : (
    content
  );
}

/** Direct-buy button for one source. Blue = idealo, white = billiger.de. */
function BuyButton({
  label,
  variant,
  offer,
  demo,
  cheaper,
}: {
  label: string;
  variant: "blue" | "white";
  offer: ProductDTO["offers"][number] | null;
  demo?: boolean;
  cheaper?: boolean;
}) {
  const base =
    "relative inline-flex flex-col items-center rounded-md px-2.5 py-1 text-xs font-medium leading-tight min-w-[74px]";
  const palette =
    variant === "blue"
      ? "bg-blue-600 text-white hover:bg-blue-500"
      : "bg-white text-slate-900 hover:bg-slate-100 border border-slate-300";

  // No offer, or a demo/mock price → not a real buy target.
  if (!offer || demo || !offer.url) {
    return (
      <span
        title={
          demo
            ? `${label}: Demo-Daten (keine echte API konfiguriert)`
            : `${label}: kein Angebot gefunden`
        }
        className={`${base} ${palette} cursor-not-allowed opacity-40`}
      >
        <span>{label}</span>
        <span className="text-[10px]">
          {demo ? "Demo" : offer ? formatEuro(offer.priceCents) : "—"}
        </span>
      </span>
    );
  }

  return (
    <a
      href={offer.url}
      target="_blank"
      rel="noreferrer"
      title={`Bei ${label} kaufen`}
      className={`${base} ${palette} ${
        cheaper ? "ring-2 ring-emerald-400" : ""
      }`}
    >
      <span>{label}</span>
      <span className="text-[10px] font-semibold">
        {formatEuro(offer.priceCents)}
      </span>
      {cheaper && (
        <span className="absolute -top-2 -right-2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950 shadow">
          günstiger
        </span>
      )}
    </a>
  );
}
