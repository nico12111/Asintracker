"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductDTO } from "@/lib/serialize";
import { computeMargin, formatEuro, formatPct } from "@/lib/margin";
import { refreshIdsInBatches } from "@/lib/client-refresh";
import type { MarginSettings } from "./ProductTable";

const STORAGE_KEY = "asintracker.margin";

export function ShopsTable({
  initialProducts,
  defaultSettings,
  scraperLive,
}: {
  initialProducts: ProductDTO[];
  defaultSettings: MarginSettings;
  scraperLive: boolean;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [settings, setSettings] = useState<MarginSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyOpportunities, setOnlyOpportunities] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
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

  const computed = useMemo(
    () =>
      products.map((p) => {
        const best = p.bestShopOffer;
        const margin = computeMargin({
          amazonPriceCents: p.amazonPriceCents,
          bestBuyPriceCents: best?.priceCents ?? null,
          referralFeePct: settings.referralFeePct,
          fulfillmentFeeCents: Math.round((settings.fulfillmentEur || 0) * 100),
          minRoiPct: settings.minRoiPct,
        });
        return { p, best, margin };
      }),
    [products, settings],
  );

  const opportunities = computed.filter((r) => r.margin.isBuyOpportunity).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computed
      .filter((r) => {
        if (onlyOpportunities && !r.margin.isBuyOpportunity) return false;
        if (!q) return true;
        return [r.p.asin, r.p.title, r.p.brand, r.p.category]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q));
      })
      .sort(
        (a, b) => (b.margin.roiPct ?? -Infinity) - (a.margin.roiPct ?? -Infinity),
      );
  }, [computed, search, onlyOpportunities]);

  async function reload() {
    const res = await fetch("/api/asins");
    const data = await res.json();
    if (data.products) setProducts(data.products);
  }

  async function scrapeOne(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/asins/${id}?shops=1`, { method: "POST" });
      const data = await res.json();
      if (data.product) {
        setProducts((prev) => prev.map((p) => (p.id === id ? data.product : p)));
        if (data.errors?.length) setNotice(data.errors.join(" · "));
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  function scrapeAll() {
    const ids = products.map((p) => p.id);
    startTransition(async () => {
      setNotice(`Durchsuche Shops (0/${ids.length})…`);
      const errors = await refreshIdsInBatches(
        ids,
        async (done, total) => {
          await reload();
          if (done < total) setNotice(`Durchsuche Shops (${done}/${total})…`);
        },
        1,
        false,
        true,
      );
      setNotice(
        errors.length
          ? `⚠ ${errors.join(" · ")}`
          : `Shop-Preise für ${ids.length} Produkt(e) aktualisiert.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {!scraperLive && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Scraping-Dienst nicht konfiguriert – Shop-Preise sind Demo-Daten.
          Trage <code className="rounded bg-slate-800 px-1">SCRAPER_API_TEMPLATE</code>{" "}
          in Vercel ein (z. B. ScraperAPI) für echte Preise.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-slate-400">
          <span className="font-medium text-slate-200">{products.length}</span>{" "}
          getrackt ·{" "}
          <span className="font-medium text-emerald-400">{opportunities}</span>{" "}
          Shop-Chance(n)
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Produkte suchen"
          className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlyOpportunities}
            onChange={(e) => setOnlyOpportunities(e.target.checked)}
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
          onClick={scrapeAll}
          disabled={isPending}
          title="Alle Produkte in den Shops nachschlagen (Scraping-Dienst)"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Durchsuche…" : "Shops durchsuchen"}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {notice}
        </div>
      )}

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
            hint="Ab hier gilt es als Chance"
            value={settings.minRoiPct}
            step={1}
            onChange={(v) => setSettings((s) => ({ ...s, minRoiPct: v }))}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[1300px] text-sm">
          <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">ASIN / Titel</th>
              <th className="px-3 py-3">Marke</th>
              <th className="px-3 py-3 text-right">Amazon (VK)</th>
              <th className="px-3 py-3 text-right">Ø30T</th>
              <th className="px-3 py-3">Shop-Preise</th>
              <th className="px-3 py-3 text-right">Bester EK</th>
              <th className="px-3 py-3 text-right">Gewinn</th>
              <th className="px-3 py-3 text-right">Marge %</th>
              <th className="px-3 py-3 text-right">ROI</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.map(({ p, best, margin }) => {
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
                          <span className="max-w-[240px] truncate">
                            {p.title ?? p.asin}
                          </span>
                          {margin.isBuyOpportunity && (
                            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                              KAUFEN
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs text-slate-500">
                          {p.asin}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{p.brand ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatEuro(p.amazonPriceCents)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {formatEuro(p.amazonAvg30Cents)}
                  </td>
                  <td className="px-3 py-2">
                    {p.shopOffers.length === 0 ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.shopOffers.slice(0, 6).map((s) => {
                          const isBest = best?.shopKey === s.shopKey;
                          const chip = (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                                isBest
                                  ? "bg-emerald-500 font-semibold text-slate-950"
                                  : "bg-slate-800 text-slate-300"
                              }`}
                            >
                              {s.shopName}: {formatEuro(s.priceCents)}
                            </span>
                          );
                          return s.url ? (
                            <a
                              key={s.shopKey}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {chip}
                            </a>
                          ) : (
                            <span key={s.shopKey}>{chip}</span>
                          );
                        })}
                        {p.shopOffers.length > 6 && (
                          <span className="text-[11px] text-slate-500">
                            +{p.shopOffers.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatEuro(best?.priceCents ?? null)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      profit == null
                        ? "text-slate-500"
                        : profit > 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }`}
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
                      {best?.url && (
                        <a
                          href={best.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Bei ${best.shopName} kaufen`}
                          className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                        >
                          Kaufen
                        </a>
                      )}
                      <button
                        onClick={() => scrapeOne(p.id)}
                        disabled={busy[p.id]}
                        title="Shops für dieses Produkt durchsuchen"
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
