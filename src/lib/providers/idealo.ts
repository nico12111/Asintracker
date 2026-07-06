import { env } from "../env";
import type {
  ComparisonProvider,
  ComparisonOffer,
  ComparisonQuery,
} from "../types";
import { mockAmazonPriceCents, mockComparisonPriceCents } from "./mock";

/**
 * idealo provider using the documented endpoints:
 *   POST /api/idealo/search   { query, country }        -> array of items
 *   POST /api/idealo/product  { itemId, itemType, country }
 *
 * The search response items expose a best offer under `prices` /
 * `bestAvailableOffer.prices`. Because the exact numeric shape can vary
 * (string "1.099,00", number 1099.0, nested { price, totalPrice }), we parse
 * prices defensively.
 */

interface IdealoSearchItem {
  itemId?: string;
  itemType?: string;
  name?: string;
  url?: string;
  prices?: unknown;
  bestAvailableOffer?: { prices?: unknown; deliveryStatus?: string };
}

/** Recursively find the first plausible price (in EUR) inside an object. */
function extractEuro(value: unknown, depth = 0): number | null {
  if (value == null || depth > 4) return null;

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    // Handle "1.099,00 €", "1099.00", "1,099.00"
    const cleaned = value.replace(/[^\d.,]/g, "");
    if (!cleaned) return null;
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      // Last separator is the decimal separator.
      normalized =
        cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
          ? cleaned.replace(/\./g, "").replace(",", ".")
          : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      const found = extractEuro(v, depth + 1);
      if (found != null) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Prefer keys that look like a total/price.
    const priorityKeys = ["price", "totalPrice", "total", "amount", "value"];
    for (const key of priorityKeys) {
      if (key in obj) {
        const found = extractEuro(obj[key], depth + 1);
        if (found != null) return found;
      }
    }
    for (const v of Object.values(obj)) {
      const found = extractEuro(v, depth + 1);
      if (found != null) return found;
    }
  }

  return null;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (env.idealo.apiKey) {
    const value =
      env.idealo.keyHeader.toLowerCase() === "authorization"
        ? `Bearer ${env.idealo.apiKey}`
        : env.idealo.apiKey;
    headers[env.idealo.keyHeader] = value;
  }
  if (env.idealo.host) {
    headers["X-RapidAPI-Host"] = env.idealo.host;
  }
  return headers;
}

class IdealoProvider implements ComparisonProvider {
  readonly source = "idealo" as const;

  get enabled() {
    return env.idealo.enabled;
  }

  async findBestOffer(query: ComparisonQuery): Promise<ComparisonOffer | null> {
    if (!this.enabled) {
      return this.mockOffer(query);
    }

    // Prefer the GTIN/EAN for an exact match, fall back to the title.
    const term = query.ean || query.title;
    if (!term) return null;

    const res = await fetch(`${env.idealo.apiUrl}/api/idealo/search`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ query: term, country: env.idealo.country }),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`idealo search failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as unknown;
    // Response may be a bare array, { data: [...] } or { success, data: [...] }.
    const items: IdealoSearchItem[] = Array.isArray(json)
      ? (json as IdealoSearchItem[])
      : ((json as { data?: IdealoSearchItem[] })?.data ?? []);

    if (!items.length) return null;

    // Case 1: the search result already carries a price → cheapest match.
    let best: { euro: number; item: IdealoSearchItem } | null = null;
    for (const item of items.slice(0, 5)) {
      const euro =
        extractEuro(item.bestAvailableOffer?.prices) ?? extractEuro(item.prices);
      if (euro != null && (best == null || euro < best.euro)) {
        best = { euro, item };
      }
    }

    if (best) {
      return {
        source: this.source,
        priceCents: Math.round(best.euro * 100),
        url: best.item.url ?? null,
        inStock: true,
        matchedName: best.item.name ?? null,
        mock: false,
      };
    }

    // Case 2: search returned no price (e.g. only itemId/name/url). Fetch the
    // product detail for the top match to read its best available offer price.
    const top = items[0];
    if (top?.itemId) {
      const euro = await this.fetchProductPrice(top);
      if (euro != null) {
        return {
          source: this.source,
          priceCents: Math.round(euro * 100),
          url: top.url ?? null,
          inStock: true,
          matchedName: top.name ?? null,
          mock: false,
        };
      }
    }

    return null;
  }

  /** Resolve a price via POST /api/idealo/product for a single item. */
  private async fetchProductPrice(
    item: IdealoSearchItem,
  ): Promise<number | null> {
    try {
      const res = await fetch(`${env.idealo.apiUrl}/api/idealo/product`, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          itemId: item.itemId,
          itemType: item.itemType ?? "PRODUCT",
          country: env.idealo.country,
        }),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      // Detail may be under { data: { item: {...} } } or a flat object.
      const detail =
        (json as { data?: { item?: unknown }; item?: unknown })?.data?.item ??
        (json as { data?: unknown })?.data ??
        json;
      const d = detail as {
        bestAvailableOffer?: { prices?: unknown };
        pricesByCondition?: unknown;
      };
      return (
        extractEuro(d?.bestAvailableOffer?.prices) ??
        extractEuro(d?.pricesByCondition)
      );
    } catch {
      return null;
    }
  }

  private mockOffer(query: ComparisonQuery): ComparisonOffer {
    const amazon = mockAmazonPriceCents(query.asin);
    return {
      source: this.source,
      priceCents: mockComparisonPriceCents(amazon, query.asin, this.source),
      url: query.ean
        ? `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${query.ean}`
        : null,
      inStock: true,
      matchedName: query.title,
      mock: true,
    };
  }
}

export const idealoProvider = new IdealoProvider();
