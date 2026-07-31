import Link from "next/link";
import { prisma } from "@/lib/db";
import { serializeProduct } from "@/lib/serialize";
import { env } from "@/lib/env";
import { ShopsTable } from "@/components/ShopsTable";

export const metadata = { title: "Shops – AsinTracker" };
export const dynamic = "force-dynamic";

export default async function ShopsPage() {
  const productsRaw = await prisma.product.findMany({
    include: { offers: true, shopOffers: true },
    orderBy: { createdAt: "desc" },
  });
  const products = productsRaw.map(serializeProduct);

  const defaultSettings = {
    referralFeePct: env.margin.referralFeePct,
    fulfillmentEur: env.margin.fulfillmentFeeCents / 100,
    minRoiPct: env.margin.buyOpportunityMinRoiPct,
    a2aShipEur: 0,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Shops</h1>
        <p className="text-sm text-slate-400">
          Gleiche ASIN in deutschen Online-Shops (MediaMarkt, Euronics,
          Cyberport …) per Scraping-Dienst finden und mit dem Amazon-Preis
          vergleichen.
        </p>
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-10 text-center">
          <p className="text-slate-400">Noch keine ASINs.</p>
          <Link
            href="/upload"
            className="mt-4 inline-block rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400"
          >
            ASINs importieren
          </Link>
        </div>
      ) : (
        <ShopsTable
          initialProducts={products}
          defaultSettings={defaultSettings}
          scraperLive={env.scraper.enabled}
        />
      )}
    </div>
  );
}
