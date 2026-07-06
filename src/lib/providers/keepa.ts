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
  buyBoxPrice?: number;
  salesRankDrops30?: number;
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
function pickFromArray(arr?: number[]): number | null {
  if (!Array.isArray(arr)) return null;
  for (const idx of [18, 0, 1]) {
    const v = arr[idx];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

function pickPriceCents(stats?: KeepaStats): number | null {
  if (!stats) return null;
  if (typeof stats.buyBoxPrice === "number" && stats.buyBoxPrice > 0) {
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

    const url = new URL("https://api.keepa.com/product");
    url.searchParams.set("key", env.keepa.apiKey);
    url.searchParams.set("domain", env.keepa.domain);
    url.searchParams.set("asin", asin);
    // A day interval makes Keepa include avg30/avg90 + salesRankDrops30/90.
    url.searchParams.set("stats", "90");
    url.searchParams.set("buybox", "1");

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Keepa request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as KeepaResponse;
    if (data.error?.message) {
      throw new Error(`Keepa error: ${data.error.message}`);
    }

    const product = data.products?.[0];
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
        priceCents: null,
        avgPrice30Cents: null,
        mock: false,
      };
    }

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
      priceCents: pickPriceCents(product.stats),
      avgPrice30Cents: pickFromArray(product.stats?.avg30),
      mock: false,
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
      priceCents: mockAmazonPriceCents(asin),
      avgPrice30Cents: Math.round(mockAmazonPriceCents(asin) * 1.04),
      mock: true,
    };
  }
}

export const keepaProvider = new KeepaProvider();
