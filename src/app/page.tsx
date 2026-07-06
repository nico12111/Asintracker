import Link from "next/link";
import { prisma } from "@/lib/db";
import { serializeProduct } from "@/lib/serialize";
import { env } from "@/lib/env";
import { ProductTable } from "@/components/ProductTable";
import { ProviderStatus } from "@/components/ProviderStatus";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const productsRaw = await prisma.product.findMany({
    include: { offers: true },
    orderBy: { createdAt: "desc" },
  });
  const products = productsRaw.map(serializeProduct);

  const defaultSettings = {
    referralFeePct: env.margin.referralFeePct,
    fulfillmentEur: env.margin.fulfillmentFeeCents / 100,
    minRoiPct: env.margin.buyOpportunityMinRoiPct,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Preiswecker</h1>
          <p className="text-sm text-slate-400">
            Amazon-Preise via Keepa gegen idealo &amp; billiger.de – mit
            Margen-Analyse.
          </p>
        </div>
        <ProviderStatus
          keepa={env.keepa.enabled}
          idealo={env.idealo.enabled}
          billiger={env.billiger.enabled}
        />
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-10 text-center">
          <p className="text-slate-400">
            Noch keine ASINs. Füge welche hinzu, um Preise zu vergleichen.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-block rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400"
          >
            ASINs importieren
          </Link>
        </div>
      ) : (
        <ProductTable
          initialProducts={products}
          defaultSettings={defaultSettings}
          liveSources={{
            idealo: env.idealo.enabled,
            billiger: env.billiger.enabled,
          }}
        />
      )}
    </div>
  );
}
