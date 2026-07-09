import { env } from "../env";
import type { AmazonProvider, AmazonProductData } from "../types";
import {
  mockAmazonPriceCents,
  mockTitle,
  mockEan,
  mockCategory,
  mockSalesRank,
} from "./mock";

/**
 * Keepa product endpoint returns prices in integer cents, using -1 for
 * "no data". `stats.current` is an array indexed by price type:
 *   0 = Amazon, 1 = New (3rd party), 18 = Buy Box.
 * Docs: https://keepa.com/#!discuss/t/product-object/116
 */
interface KeepaStats {
  current?: number[];
  avg30?: number[];
  avg90?: number[];
  buyBoxPrice?: number;
  buyBoxShipping?: number;
  buyBoxIsUsed?: boolean;
  salesRankDrops30?: number;
  salesRankDrops90?: number;
}

interface KeepaProduct {
  asin: string;
  title?: string;
  brand?: string;
  eanList?: string[];
  upcList?: string[];
  imagesCSV?: string;
  salesRankReference?: number;
  salesRanks?: Record<string, number[]>;
  categoryTree?: { catId: number; name: string }[];
  stats?: KeepaStats;
}

interface KeepaResponse {
  products?: KeepaProduct[];
  error?: { message?: string };
}

function firstImageUrl(imagesCSV?: string): string | null {
  if (!imagesCSV) return null;
  const first = imagesCSV.split(",")[0]?.trim();
  if (!first) return null;
  return `https://m.media-amazon.com/images/I/${first}`;
}

/** Pick a price from a Keepa price array: Buy Box (18) → Amazon (0) → New (1). */
/**
 * Keepa price-type indices: 0 = AMAZON (Amazon's own offer), 1 = NEW
 * (cheapest 3rd-party new, excl. shipping), 18 = BUY_BOX_SHIPPING (buy box
 * landed price incl. shipping). Prefer Amazon's own price, then the buy box.
 */
function pickFromArray(arr?: number[]): number | null {
  if (!Array.isArray(arr)) return null;
  for (const idx of [0, 18, 1]) {
    const v = arr[idx];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

function pickPriceCents(stats?: KeepaStats): number | null {
  if (!stats) return null;
  // The stats buy box price matches what a customer sees — but only when it
  // is a NEW buy box; a used buy box would report a misleadingly low price.
  if (
    typeof stats.buyBoxPrice === "number" &&
    stats.buyBoxPrice > 0 &&
    stats.buyBoxIsUsed !== true
  ) {
    return stats.buyBoxPrice;
  }
  return pickFromArray(stats.current);
}

function pickSalesRank(product: KeepaProduct): number | null {
  // stats.current[3] is the current sales rank (SALES index).
  const fromStats = product.stats?.current?.[3];
  if (typeof fromStats === "number" && fromStats > 0) return fromStats;
  const ref = product.salesRankReference;
  if (ref != null && product.salesRanks?.[String(ref)]) {
    const arr = product.salesRanks[String(ref)];
    const last = arr[arr.length - 1];
    if (typeof last === "number" && last > 0) return last;
  }
  return null;
}

function pickCategory(product: KeepaProduct): string | null {
  const tree = product.categoryTree;
  if (Array.isArray(tree) && tree.length > 0) {
    return tree[tree.length - 1]?.name ?? tree[0]?.name ?? null;
  }
  return null;
}

class KeepaProvider implements AmazonProvider {
  readonly name = "keepa" as const;

  get enabled() {
    return env.keepa.enabled;
  }

  async fetchProduct(asin: string): Promise<AmazonProductData> {
    if (!this.enabled) {
      return this.mockProduct(asin);
    }

    const product = await this.fetchRawProduct(asin);
    if (!product) {
      return {
        asin,
        title: null,
        brand: null,
        category: null,
        imageUrl: null,
        ean: null,
        eans: [],
        salesRank: null,
        salesRankDrops30: null,
        salesRankDrops90: null,
        priceCents: null,
        avgPrice30Cents: null,
        avgPrice90Cents: null,
        rating: null,
        reviewCount: null,
        offerCountNew: null,
        mock: false,
      };
    }

    const cur = product.stats?.current;
    const ratingRaw = cur?.[16];
    const rating =
      typeof ratingRaw === "number" && ratingRaw > 0 ? ratingRaw / 10 : null;
    const reviewCount =
      typeof cur?.[17] === "number" && cur[17] >= 0 ? cur[17] : null;
    const offerCountNew =
      typeof cur?.[11] === "number" && cur[11] >= 0 ? cur[11] : null;

    const eans = [...(product.eanList ?? []), ...(product.upcList ?? [])].filter(
      Boolean,
    );

    return {
      asin,
      title: product.title ?? null,
      brand: product.brand ?? null,
      category: pickCategory(product),
      imageUrl: firstImageUrl(product.imagesCSV),
      ean: eans[0] ?? null,
      eans,
      salesRank: pickSalesRank(product),
      salesRankDrops30: product.stats?.salesRankDrops30 ?? null,
      salesRankDrops90: product.stats?.salesRankDrops90 ?? null,
      priceCents: pickPriceCents(product.stats),
      avgPrice30Cents: pickFromArray(product.stats?.avg30),
      avgPrice90Cents: pickFromArray(product.stats?.avg90),
      rating,
      reviewCount,
      offerCountNew,
      mock: false,
    };
  }

  /** Raw Keepa product (or null) — also used by /api/debug diagnostics. */
  async fetchRawProduct(asin: string): Promise<KeepaProduct | null> {
    const url = new URL("https://api.keepa.com/product");
    url.searchParams.set("key", env.keepa.apiKey);
    url.searchParams.set("domain", env.keepa.domain);
    url.searchParams.set("asin", asin);
    // A day interval makes Keepa include avg30/avg90 + salesRankDrops30/90.
    url.searchParams.set("stats", "90");
    url.searchParams.set("buybox", "1");
    // Include rating & review-count history so stats.current[16]/[17] are set.
    url.searchParams.set("rating", "1");

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Keepa request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as KeepaResponse;
    if (data.error?.message) {
      throw new Error(`Keepa error: ${data.error.message}`);
    }
    return data.products?.[0] ?? null;
  }

  /** Raw price fields for diagnostics: which Keepa value we pick and why. */
  async debugPrices(asin: string): Promise<unknown> {
    if (!this.enabled) return { enabled: false };
    const p = await this.fetchRawProduct(asin);
    if (!p) return { found: false };
    const s = p.stats;
    return {
      picked: pickPriceCents(s),
      buyBoxPrice: s?.buyBoxPrice ?? null,
      buyBoxShipping: s?.buyBoxShipping ?? null,
      buyBoxIsUsed: s?.buyBoxIsUsed ?? null,
      current_AMAZON_0: s?.current?.[0] ?? null,
      current_NEW_1: s?.current?.[1] ?? null,
      current_BUYBOX_SHIPPING_18: s?.current?.[18] ?? null,
      avg30_AMAZON_0: s?.avg30?.[0] ?? null,
      avg30_NEW_1: s?.avg30?.[1] ?? null,
      avg30_BUYBOX_18: s?.avg30?.[18] ?? null,
    };
  }

  private mockProduct(asin: string): AmazonProductData {
    const ean = mockEan(asin);
    return {
      asin,
      title: mockTitle(asin),
      brand: "DemoBrand",
      category: mockCategory(asin),
      imageUrl: null,
      ean,
      eans: [ean],
      salesRank: mockSalesRank(asin),
      salesRankDrops30: 20 + (mockSalesRank(asin) % 400),
      salesRankDrops90: 60 + (mockSalesRank(asin) % 1000),
      priceCents: mockAmazonPriceCents(asin),
      avgPrice30Cents: Math.round(mockAmazonPriceCents(asin) * 1.04),
      avgPrice90Cents: Math.round(mockAmazonPriceCents(asin) * 1.07),
      rating: 3.5 + (mockSalesRank(asin) % 15) / 10,
      reviewCount: 5 + (mockSalesRank(asin) % 5000),
      offerCountNew: 1 + (mockSalesRank(asin) % 25),
      mock: true,
    };
  }
}

export const keepaProvider = new KeepaProvider();
