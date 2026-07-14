import Link from "next/link";
import { prisma } from "@/lib/db";
import { serializeProduct } from "@/lib/serialize";
import { env } from "@/lib/env";
import { A2ATable } from "@/components/A2ATable";

export const metadata = { title: "A2A Flips – AsinTracker" };
export const dynamic = "force-dynamic";

export default async function A2APage() {
  const productsRaw = await prisma.product.findMany({
    include: { offers: true },
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">A2A Flips</h1>
          <p className="text-sm text-slate-400">
            Gleiche ASIN auf amazon.es / .fr / .it einkaufen, in Deutschland
            lagern und auf amazon.de verkaufen. EU-Preise via Keepa.
          </p>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-10 text-center">
          <p className="text-slate-400">
            Noch keine ASINs. Füge welche hinzu, um EU-Preise zu vergleichen.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-block rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400"
          >
            ASINs importieren
          </Link>
        </div>
      ) : (
        <A2ATable
          initialProducts={products}
          defaultSettings={defaultSettings}
        />
      )}
    </div>
  );
}
