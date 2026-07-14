"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductDTO } from "@/lib/serialize";
import { computeMargin, formatEuro, formatPct } from "@/lib/margin";
import { refreshIdsInBatches } from "@/lib/client-refresh";
import type { MarginSettings } from "./ProductTable";

const STORAGE_KEY = "asintracker.margin";

interface EuMarket {
  key: "ES" | "FR" | "IT";
  priceCents: number;
  url: string;
}

function euMarkets(p: ProductDTO): EuMarket[] {
  const list: EuMarket[] = [];
  if (p.amazonEsCents != null)
    list.push({ key: "ES", priceCents: p.amazonEsCents, url: `https://www.amazon.es/dp/${p.asin}` });
  if (p.amazonFrCents != null)
    list.push({ key: "FR", priceCents: p.amazonFrCents, url: `https://www.amazon.fr/dp/${p.asin}` });
  if (p.amazonItCents != null)
    list.push({ key: "IT", priceCents: p.amazonItCents, url: `https://www.amazon.it/dp/${p.asin}` });
  return list;
}

export function A2ATable({
  initialProducts,
  defaultSettings,
}: {
  initialProducts: ProductDTO[];
  defaultSettings: MarginSettings;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [settings, setSettings] = useState<MarginSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyOpportunities, setOnlyOpportunities] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isPending, startTransition] = useTransition();

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

  const shipCents = Math.round((settings.a2aShipEur || 0) * 100);

  const computed = useMemo(
    () =>
      products.map((p) => {
        const markets = euMarkets(p);
        const bestEu =
          markets.length > 0
            ? markets.reduce((a, b) => (b.priceCents < a.priceCents ? b : a))
            : null;
        const margin = computeMargin({
          amazonPriceCents: p.amazonPriceCents,
          bestBuyPriceCents: bestEu ? bestEu.priceCents + shipCents : null,
          referralFeePct: settings.referralFeePct,
          fulfillmentFeeCents: Math.round((settings.fulfillmentEur || 0) * 100),
          minRoiPct: settings.minRoiPct,
        });
        return { p, markets, bestEu, margin };
      }),
    [products, settings, shipCents],
  );

  const opportunities = computed.filter((r) => r.margin.isBuyOpportunity).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computed
      .filter((r) => {
        if (onlyOpportunities && !r.margin.isBuyOpportunity) return false;
        if (!q) return true;
        return [r.p.asin, r.p.title, r.p.brand, r.p.category, r.p.ean]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q));
      })
      .sort(
        (a, b) => (b.margin.roiPct ?? -Infinity) - (a.margin.roiPct ?? -Infinity),
      );
  }, [computed, search, onlyOpportunities]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  async function reload() {
    const res = await fetch("/api/asins");
    const data = await res.json();
    if (data.products) setProducts(data.products);
  }

  async function refreshOne(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/asins/${id}`, { method: "POST" });
      const data = await res.json();
      if (data.product) {
        setProducts((prev) =>
          prev.map((p) => (p.id === id ? data.product : p)),
        );
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  function refreshAll() {
    const ids = products.map((p) => p.id);
    startTransition(async () => {
      setNotice(`Aktualisiere DE + EU-Preise (0/${ids.length})…`);
      const errors = await refreshIdsInBatches(ids, async (done, total) => {
        await reload();
        if (done < total) {
          setNotice(`Aktualisiere DE + EU-Preise (${done}/${total})…`);
        }
      });
      setNotice(
        errors.length
          ? `⚠ Teilweise fehlgeschlagen: ${errors.join(" · ")}`
          : `Alle ${ids.length} Produkte aktualisiert.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-slate-400">
          <span className="font-medium text-slate-200">{products.length}</span>{" "}
          getrackt ·{" "}
          <span className="font-medium text-emerald-400">{opportunities}</span>{" "}
          A2A-Chance(n)
        </div>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Produkte suchen (ASIN, Titel, Marke)"
          className="w-72 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
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
          ⚙ AMZ Gebühren
        </button>
        <button
          onClick={refreshAll}
          disabled={isPending}
          title="Amazon DE + EU-Preise aktualisieren (nur Keepa)"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Aktualisiere…" : "Preise aktualisieren"}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {notice}
        </div>
      )}

      {showSettings && (
        <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-4">
          <NumberField
            label="Amazon-Gebühr (%)"
            hint="Verkaufsprovision vom VK"
            value={settings.referralFeePct}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, referralFeePct: v }))}
          />
          <NumberField
            label="Versand/FBA (€)"
            hint="Pauschale pro Einheit (Verkauf DE)"
            value={settings.fulfillmentEur}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, fulfillmentEur: v }))}
          />
          <NumberField
            label="A2A Versand (€)"
            hint="EK-Versand ES/FR/IT → DE pro Einheit"
            value={settings.a2aShipEur}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, a2aShipEur: v }))}
          />
          <NumberField
            label="Mindest-ROI (%)"
            hint="Ab hier gilt es als A2A-Chance"
            value={settings.minRoiPct}
            step={1}
            onChange={(v) => setSettings((s) => ({ ...s, minRoiPct: v }))}
          />
          <p className="text-xs text-slate-500 sm:col-span-4">
            Gewinn = Amazon.de-VK − Gebühr − Versand/FBA − (günstigster
            EU-Preis + A2A-Versand). Einstellungen werden lokal gespeichert.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">ASIN / Titel</th>
              <th className="px-3 py-3">Marke</th>
              <th className="px-3 py-3 text-right">★</th>
              <th className="px-3 py-3 text-right">BSR</th>
              <th className="px-3 py-3 text-right">Drops 30T</th>
              <th className="px-3 py-3 text-right">🇩🇪 DE (VK)</th>
              <th className="px-3 py-3 text-right">Ø30T</th>
              <th className="px-3 py-3 text-right">🇪🇸 ES</th>
              <th className="px-3 py-3 text-right">🇫🇷 FR</th>
              <th className="px-3 py-3 text-right">🇮🇹 IT</th>
              <th className="px-3 py-3 text-right" title="Günstigster EU-Preis + A2A-Versand">
                Bester EU-EK
              </th>
              <th className="px-3 py-3 text-right">Gewinn</th>
              <th className="px-3 py-3 text-right">Marge %</th>
              <th className="px-3 py-3 text-right">ROI</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pageItems.map(({ p, markets, bestEu, margin }) => {
              const profit = margin.profitCents;
              return (
                <tr
                  key={p.id}
                  className={`hover:bg-slate-900/60 ${
                    margin.isBuyOpportunity ? "bg-emerald-950/30" : ""
                  }`}
                >
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
                          {margin.isBuyOpportunity && (
                            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                              A2A FLIP
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
                  <td className="px-3 py-2 text-right text-amber-300">
                    {p.rating != null ? p.rating.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {p.salesRank != null
                      ? p.salesRank.toLocaleString("de-DE")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {p.salesRankDrops30 != null
                      ? p.salesRankDrops30.toLocaleString("de-DE")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatEuro(p.amazonPriceCents)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {formatEuro(p.amazonAvg30Cents)}
                  </td>
                  {(["ES", "FR", "IT"] as const).map((key) => {
                    const m = markets.find((x) => x.key === key) ?? null;
                    const isBest = bestEu != null && m?.key === bestEu.key;
                    return (
                      <td
                        key={key}
                        className={`px-3 py-2 text-right ${
                          isBest ? "font-semibold text-emerald-400" : ""
                        }`}
                      >
                        {m ? (
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-emerald-300"
                          >
                            {formatEuro(m.priceCents)}
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-medium">
                    {bestEu
                      ? formatEuro(bestEu.priceCents + shipCents)
                      : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      profit == null
                        ? "text-slate-500"
                        : profit > 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }`}
                    title={`Netto nach Gebühren: ${formatEuro(margin.netProceedsCents)} (Gebühren ${formatEuro(margin.feesCents)})`}
                  >
                    {formatEuro(profit)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      margin.marginPct != null && margin.marginPct > 0
                        ? "text-emerald-400"
                        : "text-slate-500"
                    }`}
                  >
                    {formatPct(margin.marginPct)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      margin.roiPct != null && margin.roiPct > 0
                        ? "text-emerald-400"
                        : "text-slate-500"
                    }`}
                  >
                    {formatPct(margin.roiPct)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {bestEu ? (
                        <a
                          href={bestEu.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Auf amazon.${bestEu.key.toLowerCase()} kaufen`}
                          className={`relative inline-flex min-w-[92px] flex-col items-center rounded-md bg-orange-500 px-2.5 py-1 text-xs font-medium leading-tight text-slate-950 hover:bg-orange-400 ${
                            margin.isBuyOpportunity
                              ? "ring-2 ring-emerald-400"
                              : ""
                          }`}
                        >
                          <span>amazon.{bestEu.key.toLowerCase()}</span>
                          <span className="text-[10px] font-semibold">
                            {formatEuro(bestEu.priceCents)}
                          </span>
                        </a>
                      ) : (
                        <span className="inline-flex min-w-[92px] cursor-not-allowed flex-col items-center rounded-md bg-orange-500 px-2.5 py-1 text-xs font-medium leading-tight text-slate-950 opacity-40">
                          <span>A2A</span>
                          <span className="text-[10px]">—</span>
                        </span>
                      )}
                      <button
                        onClick={() => refreshOne(p.id)}
                        disabled={busy[p.id]}
                        title="DE + EU-Preise aktualisieren"
                        className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
                      >
                        {busy[p.id] ? "…" : "↻"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
            onClick={() => setPage((v) => Math.max(1, v - 1))}
            disabled={currentPage <= 1}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          >
            ‹
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
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
