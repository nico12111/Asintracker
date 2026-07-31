import { env } from "../env";
import { scrapeHtml } from "../scraping/client";
import {
  extractSchemaOrgOffers,
  bestMatchingOffer,
} from "../scraping/schema-org";
import { SHOPS, type ShopEntry } from "../scraping/shops-registry";
import { seededUnit, mockAmazonPriceCents } from "./mock";
import type { ComparisonQuery } from "../types";

export interface ShopOfferResult {
  shopKey: string;
  shopName: string;
  priceCents: number;
  url: string;
  mock: boolean;
}

/** How many shops to scrape per product (each is one scraping-service call). */
const MAX_SHOPS_PER_PRODUCT = Number(process.env.SHOPS_PER_PRODUCT) || 8;

class ShopsProvider {
  get enabled() {
    return env.scraper.enabled;
  }

  /** Scrape a single shop's search page and return the best matching offer. */
  private async scrapeShop(
    shop: ShopEntry,
    term: string,
    gtin: string | null,
  ): Promise<ShopOfferResult | null> {
    const searchUrl = shop.searchUrl(encodeURIComponent(term));
    const html = await scrapeHtml(searchUrl);
    if (!html) return null;
    const offers = extractSchemaOrgOffers(html);
    const best = bestMatchingOffer(offers, gtin);
    if (!best) return null;
    return {
      shopKey: shop.key,
      shopName: shop.name,
      priceCents: best.priceCents,
      url: searchUrl,
      mock: false,
    };
  }

  async findOffers(query: ComparisonQuery): Promise<ShopOfferResult[]> {
    if (!this.enabled) return this.mockOffers(query);

    const term = query.ean || query.eans[0] || query.title;
    if (!term) return [];
    const gtin = query.ean || query.eans[0] || null;

    const shops = SHOPS.slice(0, MAX_SHOPS_PER_PRODUCT);
    const results = await Promise.all(
      shops.map((shop) =>
        this.scrapeShop(shop, term, gtin).catch(() => null),
      ),
    );
    return results.filter((r): r is ShopOfferResult => r !== null);
  }

  /** Deterministic demo offers for a subset of shops (no scraper configured). */
  private mockOffers(query: ComparisonQuery): ShopOfferResult[] {
    const base = mockAmazonPriceCents(query.asin);
    return SHOPS.slice(0, 6)
      .filter((s) => seededUnit(`${query.asin}:${s.key}`) > 0.35)
      .map((s) => {
        const factor = 0.72 + seededUnit(`${query.asin}:shop:${s.key}`) * 0.4;
        return {
          shopKey: s.key,
          shopName: s.name,
          priceCents: Math.max(199, Math.round((base * factor) / 10) * 10 - 1),
          url: s.searchUrl(encodeURIComponent(query.ean ?? query.asin)),
          mock: true,
        };
      });
  }
}

export const shopsProvider = new ShopsProvider();
