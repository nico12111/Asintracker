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
  buyBoxPrice?: number;
}

interface KeepaProduct {
  asin: string;
  title?: string;
  brand?: string;
  eanList?: string[];
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

function pickPriceCents(stats?: KeepaStats): number | null {
  if (!stats) return null;
  if (typeof stats.buyBoxPrice === "number" && stats.buyBoxPrice > 0) {
    return stats.buyBoxPrice;
  }
  const current = stats.current;
  if (!Array.isArray(current)) return null;
  // Prefer Buy Box (18), then Amazon (0), then New (1).
  for (const idx of [18, 0, 1]) {
    const v = current[idx];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
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
    url.searchParams.set("stats", "1");
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
        salesRank: null,
        priceCents: null,
        mock: false,
      };
    }

    return {
      asin,
      title: product.title ?? null,
      brand: product.brand ?? null,
      category: pickCategory(product),
      imageUrl: firstImageUrl(product.imagesCSV),
      ean: product.eanList?.[0] ?? null,
      salesRank: pickSalesRank(product),
      priceCents: pickPriceCents(product.stats),
      mock: false,
    };
  }

  private mockProduct(asin: string): AmazonProductData {
    return {
      asin,
      title: mockTitle(asin),
      brand: "DemoBrand",
      category: mockCategory(asin),
      imageUrl: null,
      ean: mockEan(asin),
      salesRank: mockSalesRank(asin),
      priceCents: mockAmazonPriceCents(asin),
      mock: true,
    };
  }
}

export const keepaProvider = new KeepaProvider();
