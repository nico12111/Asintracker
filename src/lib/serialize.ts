import type { Offer, Product } from "@prisma/client";
import { computeMargin, type MarginResult } from "./margin";
import type { PriceSource } from "./types";

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
  amazonPriceCents: number | null;
  amazonAvg30Cents: number | null;
  offers: OfferDTO[];
  /** Cheapest in-stock comparison offer. */
  bestOffer: OfferDTO | null;
  margin: MarginResult;
  lastRefreshedAt: string | null;
}

export function serializeProduct(product: ProductWithOffers): ProductDTO {
  const offers: OfferDTO[] = product.offers.map((o) => ({
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
    amazonPriceCents: product.amazonPriceCents,
    amazonAvg30Cents: product.amazonAvg30Cents,
    offers,
    bestOffer,
    margin,
    lastRefreshedAt: product.lastRefreshedAt?.toISOString() ?? null,
  };
}
