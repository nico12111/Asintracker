/** Comparison sources we can buy from. */
export const PRICE_SOURCES = ["idealo", "billiger"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Result of looking up Amazon data for one ASIN. */
export interface AmazonProductData {
  asin: string;
  title: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  ean: string | null;
  /** Amazon Best Sellers Rank in the main category. */
  salesRank: number | null;
  /** Buy-Box / current sell price in cents, or null if unknown. */
  priceCents: number | null;
  /** True when the values are demo/mock data (no API key configured). */
  mock: boolean;
}

/** A single offer found on a comparison source. */
export interface ComparisonOffer {
  source: PriceSource;
  priceCents: number;
  url: string | null;
  inStock: boolean;
  matchedName: string | null;
  /** True when this is demo/mock data. */
  mock: boolean;
}

/** Query passed to a comparison provider to find the same product. */
export interface ComparisonQuery {
  asin: string;
  ean: string | null;
  title: string | null;
}

export interface AmazonProvider {
  readonly name: "keepa";
  readonly enabled: boolean;
  fetchProduct(asin: string): Promise<AmazonProductData>;
}

export interface ComparisonProvider {
  readonly source: PriceSource;
  readonly enabled: boolean;
  findBestOffer(query: ComparisonQuery): Promise<ComparisonOffer | null>;
}
