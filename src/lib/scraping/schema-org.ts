/**
 * Generic extractor for schema.org Product/Offer data embedded as JSON-LD in a
 * page's <script type="application/ld+json"> blocks. The vast majority of
 * German shops (Shopware, Magento, Shopify, JTL, …) ship this, so one parser
 * covers many stores without a per-shop scraper.
 */

export interface ScrapedOffer {
  priceCents: number;
  currency: string | null;
  name: string | null;
  gtin: string | null;
  availability: string | null;
}

function toCents(price: unknown): number | null {
  if (typeof price === "number" && price > 0) return Math.round(price * 100);
  if (typeof price === "string") {
    const cleaned = price.replace(/[^\d.,]/g, "");
    if (!cleaned) return null;
    let n = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      n =
        cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
          ? cleaned.replace(/\./g, "").replace(",", ".")
          : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      n = cleaned.replace(",", ".");
    }
    const val = Number(n);
    return Number.isFinite(val) && val > 0 ? Math.round(val * 100) : null;
  }
  return null;
}

function firstGtin(node: Record<string, unknown>): string | null {
  for (const key of ["gtin13", "gtin", "gtin14", "gtin12", "gtin8", "mpn"]) {
    const v = node[key];
    if (typeof v === "string" && v.trim()) return v.replace(/\D/g, "") || v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Pull an offer (cheapest, in-stock preferred) from one Product JSON-LD node. */
function offerFromProduct(node: Record<string, unknown>): ScrapedOffer | null {
  const gtin = firstGtin(node);
  const name = typeof node.name === "string" ? node.name : null;

  let offers = node.offers as unknown;
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];

  let best: ScrapedOffer | null = null;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    // AggregateOffer uses lowPrice; Offer uses price.
    const priceCents = toCents(o.price ?? o.lowPrice);
    if (priceCents == null) continue;
    const availability =
      typeof o.availability === "string" ? o.availability : null;
    const currency =
      typeof o.priceCurrency === "string" ? o.priceCurrency : null;
    if (best == null || priceCents < best.priceCents) {
      best = { priceCents, currency, name, gtin, availability };
    }
  }
  return best;
}

/** Recursively collect Product nodes from arbitrary JSON-LD structures. */
function collectProducts(
  node: unknown,
  acc: Record<string, unknown>[],
  depth = 0,
): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, acc, depth + 1);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const isProduct = Array.isArray(type)
      ? type.includes("Product")
      : type === "Product";
    if (isProduct && obj.offers) acc.push(obj);
    if (Array.isArray(obj["@graph"])) collectProducts(obj["@graph"], acc, depth + 1);
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") collectProducts(v, acc, depth + 1);
    }
  }
}

/** Parse all schema.org Product offers found in a page's HTML. */
export function extractSchemaOrgOffers(html: string): ScrapedOffer[] {
  const offers: ScrapedOffer[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const json = match[1]?.trim();
    if (!json) continue;
    try {
      const data = JSON.parse(json);
      const products: Record<string, unknown>[] = [];
      collectProducts(data, products);
      for (const p of products) {
        const offer = offerFromProduct(p);
        if (offer) offers.push(offer);
      }
    } catch {
      /* malformed JSON-LD — skip */
    }
  }
  return offers;
}

function inStock(availability: string | null): boolean {
  if (!availability) return true;
  return /instock|in_stock|preorder|limited/i.test(availability);
}

/** Cheapest in-stock offer whose GTIN matches (when a GTIN is provided). */
export function bestMatchingOffer(
  offers: ScrapedOffer[],
  gtin: string | null,
): ScrapedOffer | null {
  const usable = offers.filter((o) => inStock(o.availability));
  const pool =
    gtin && usable.some((o) => o.gtin && o.gtin.includes(gtin.replace(/^0+/, "")))
      ? usable.filter(
          (o) => o.gtin && o.gtin.includes(gtin.replace(/^0+/, "")),
        )
      : usable;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
}
