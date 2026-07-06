import { NextResponse } from "next/server";
import { amazonProvider, idealoProvider } from "@/lib/providers";
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

  const query: ComparisonQuery = {
    asin,
    ean: amazon.ean,
    eans: amazon.eans,
    title: amazon.title,
  };

  const idealo = await idealoProvider.debug(query);

  return NextResponse.json({
    keepa: {
      enabled: !amazon.mock,
      title: amazon.title,
      brand: amazon.brand,
      ean: amazon.ean,
      eans: amazon.eans,
      amazonPriceCents: amazon.priceCents,
    },
    idealo,
  });
}
