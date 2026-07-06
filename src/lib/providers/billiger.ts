import { env } from "../env";
import type {
  ComparisonProvider,
  ComparisonOffer,
  ComparisonQuery,
} from "../types";
import { mockAmazonPriceCents, mockComparisonPriceCents } from "./mock";

/**
 * billiger.de provider.
 *
 * billiger.de exposes product data through its partner/affiliate programme
 * (shopping API). The exact request shape depends on the account you get, so
 * this client is written against a generic "search by EAN/keyword returns
 * products with a min price" contract and parses the response defensively.
 * Configure BILLIGER_API_URL + BILLIGER_API_KEY to switch from mock to live.
 */

function extractEuro(value: unknown, depth = 0): number | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "number" && value > 0) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3})/g, "");
    const n = Number(cleaned.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (Array.isArray(value)) {
    let min: number | null = null;
    for (const v of value) {
      const e = extractEuro(v, depth + 1);
      if (e != null && (min == null || e < min)) min = e;
    }
    return min;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["min_price", "price", "minPrice", "amount"]) {
      if (key in obj) {
        const e = extractEuro(obj[key], depth + 1);
        if (e != null) return e;
      }
    }
    for (const v of Object.values(obj)) {
      const e = extractEuro(v, depth + 1);
      if (e != null) return e;
    }
  }
  return null;
}

class BilligerProvider implements ComparisonProvider {
  readonly source = "billiger" as const;

  get enabled() {
    return env.billiger.enabled;
  }

  async findBestOffer(query: ComparisonQuery): Promise<ComparisonOffer | null> {
    if (!this.enabled) {
      return this.mockOffer(query);
    }

    const term = query.ean || query.eans[0] || query.title;
    if (!term) return null;

    const url = new URL(`${env.billiger.apiUrl}/search`);
    url.searchParams.set("q", term);
    if (env.billiger.apiKey) url.searchParams.set("apikey", env.billiger.apiKey);

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `billiger.de search failed: ${res.status} ${res.statusText}`,
      );
    }

    const json = (await res.json()) as unknown;
    const euro = extractEuro(json);
    if (euro == null) return null;

    return {
      source: this.source,
      priceCents: Math.round(euro * 100),
      url: `https://www.billiger.de/search?searchstring=${encodeURIComponent(term)}`,
      inStock: true,
      matchedName: query.title,
      mock: false,
    };
  }

  private mockOffer(query: ComparisonQuery): ComparisonOffer {
    const amazon = mockAmazonPriceCents(query.asin);
    return {
      source: this.source,
      priceCents: mockComparisonPriceCents(amazon, query.asin, this.source),
      url: query.ean
        ? `https://www.billiger.de/search?searchstring=${query.ean}`
        : null,
      inStock: true,
      matchedName: query.title,
      mock: true,
    };
  }
}

export const billigerProvider = new BilligerProvider();
