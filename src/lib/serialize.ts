import type { Offer, Product } from "@prisma/client";
import { computeMargin, type MarginResult } from "./margin";
import { env } from "./env";
import type { PriceSource } from "./types";

/** Only offers from configured (live) sources may influence prices/margins. */
function sourceEnabled(source: string): boolean {
  if (source === "idealo") return env.idealo.enabled;
  if (source === "billiger") return env.billiger.enabled;
  return false;
}

export type ProductWithOffers = Product & { offers: Offer[] };

export interface OfferDTO {
  source: PriceSource;
  priceCents: number;
  url: string | null;
  inStock: boolean;
  matchedName: string | null;
  capturedAt: string;
}

export interface ProductDTO {
  id: string;
  asin: string;
  title: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  ean: string | null;
  manualEan: string | null;
  salesRank: number | null;
  salesRankDrops30: number | null;
  salesRankDrops90: number | null;
  amazonPriceCents: number | null;
  amazonAvg30Cents: number | null;
  amazonAvg90Cents: number | null;
  /** Same ASIN on other EU marketplaces (A2A flips). */
  amazonEsCents: number | null;
  amazonFrCents: number | null;
  amazonItCents: number | null;
  rating: number | null;
  reviewCount: number | null;
  offerCountNew: number | null;
  offers: OfferDTO[];
  /** Cheapest in-stock comparison offer. */
  bestOffer: OfferDTO | null;
  margin: MarginResult;
  lastRefreshedAt: string | null;
}

export function serializeProduct(product: ProductWithOffers): ProductDTO {
  // Drop stale offers from sources that are no longer configured (e.g. old
  // demo data), so they can't pollute Best-EK and the margin.
  const realOffers = product.offers.filter((o) => sourceEnabled(o.source));

  const offers: OfferDTO[] = realOffers.map((o) => ({
    source: o.source as PriceSource,
    priceCents: o.priceCents,
    url: o.url,
    inStock: o.inStock,
    matchedName: o.matchedName,
    capturedAt: o.capturedAt.toISOString(),
  }));

  const inStock = offers.filter((o) => o.inStock);
  const bestOffer =
    inStock.length > 0
      ? inStock.reduce((a, b) => (b.priceCents < a.priceCents ? b : a))
      : null;

  const margin = computeMargin({
    amazonPriceCents: product.amazonPriceCents,
    bestBuyPriceCents: bestOffer?.priceCents ?? null,
    referralFeePct: product.referralFeePct,
    fulfillmentFeeCents: product.fulfillmentFeeCents,
  });

  return {
    id: product.id,
    asin: product.asin,
    title: product.title,
    brand: product.brand,
    category: product.category,
    imageUrl: product.imageUrl,
    ean: product.ean,
    manualEan: product.manualEan,
    salesRank: product.salesRank,
    salesRankDrops30: product.salesRankDrops30,
    salesRankDrops90: product.salesRankDrops90,
    amazonPriceCents: product.amazonPriceCents,
    amazonAvg30Cents: product.amazonAvg30Cents,
    amazonAvg90Cents: product.amazonAvg90Cents,
    amazonEsCents: product.amazonEsCents,
    amazonFrCents: product.amazonFrCents,
    amazonItCents: product.amazonItCents,
    rating: product.rating,
    reviewCount: product.reviewCount,
    offerCountNew: product.offerCountNew,
    offers,
    bestOffer,
    margin,
    lastRefreshedAt: product.lastRefreshedAt?.toISOString() ?? null,
  };
}
