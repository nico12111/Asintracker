import { NextResponse } from "next/server";
import { amazonProvider, idealoProvider, keepaProvider } from "@/lib/providers";
import type { ComparisonQuery } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/debug?asin=B0... — diagnostic view of the ASIN → Keepa → idealo
 * flow. Shows which GTINs Keepa returns and what idealo does with them, so a
 * missing idealo price can be pinpointed. Safe to remove once matching is
 * confirmed working.
 */
export async function GET(req: Request) {
  const asin = new URL(req.url).searchParams.get("asin")?.trim();
  if (!asin) {
    return NextResponse.json(
      { error: "Pass ?asin=B0XXXXXXXX" },
      { status: 400 },
    );
  }

  const amazon = await amazonProvider.fetchProduct(asin);
  const keepaPrices = await keepaProvider
    .debugPrices(asin)
    .catch((e) => ({ error: String(e) }));

  const query: ComparisonQuery = {
    asin,
    ean: amazon.ean,
    eans: amazon.eans,
    title: amazon.title,
    brand: amazon.brand,
  };

  // idealo costs real API quota (100/month plans) — only run when asked.
  const runIdealo = new URL(req.url).searchParams.get("idealo") === "1";
  const idealo = runIdealo
    ? await idealoProvider.debug(query)
    : { skipped: "idealo-Abfrage nur mit &idealo=1 (schont das API-Limit)" };

  return NextResponse.json({
    keepa: {
      enabled: !amazon.mock,
      title: amazon.title,
      brand: amazon.brand,
      ean: amazon.ean,
      eans: amazon.eans,
      imageUrl: amazon.imageUrl,
      amazonPriceCents: amazon.priceCents,
      avgPrice30Cents: amazon.avgPrice30Cents,
      avgPrice90Cents: amazon.avgPrice90Cents,
      salesRank: amazon.salesRank,
      salesRankDrops30: amazon.salesRankDrops30,
      salesRankDrops90: amazon.salesRankDrops90,
      rating: amazon.rating,
      reviewCount: amazon.reviewCount,
      offerCountNew: amazon.offerCountNew,
    },
    keepaPrices,
    idealo,
  });
}
