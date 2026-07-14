import { prisma } from "./db";
import {
  amazonProvider,
  comparisonProviders,
  keepaProvider,
} from "./providers";
import type { ComparisonQuery } from "./types";

/** EU marketplaces checked for A2A flips: market key -> Keepa domain id. */
const EU_MARKETS = [
  ["es", "9"],
  ["fr", "4"],
  ["it", "8"],
] as const;

export interface RefreshOptions {
  /**
   * Whether to query the comparison sources (idealo/billiger). Defaults to
   * false to conserve limited third-party API quota — only enable it on add
   * or an explicit idealo refresh.
   */
  comparison?: boolean;
}

export interface RefreshResult {
  /** Human-readable provider errors (e.g. idealo rate limit) for the UI. */
  errors: { source: string; message: string }[];
}

/**
 * Refresh Amazon (Keepa) data and, if requested, the comparison offers.
 * Every fetch is isolated so one failing provider never blocks the others;
 * failures are collected and reported instead of being swallowed.
 */
export async function refreshProduct(
  productId: string,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const errors: RefreshResult["errors"] = [];
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { offers: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);

  // Reuse a previously resolved idealo item id to skip the search step.
  const idealoItemId =
    product.offers.find((o) => o.source === "idealo")?.externalId ?? null;

  // 1) Amazon data via Keepa.
  let ean = product.ean;
  let keepaEans: string[] = [];
  let title = product.title;
  let brand = product.brand;
  try {
    // Fetch the DE product data and the ES/FR/IT prices (A2A) in parallel.
    const [amazon, euPrices] = await Promise.all([
      amazonProvider.fetchProduct(product.asin),
      Promise.all(
        EU_MARKETS.map(async ([market, domain]) => {
          try {
            return await keepaProvider.fetchDomainPriceCents(
              product.asin,
              domain,
              market,
            );
          } catch (err) {
            errors.push({
              source: `amazon-${market}`,
              message: String((err as Error).message ?? err),
            });
            return null;
          }
        }),
      ),
    ]);
    const [esPrice, frPrice, itPrice] = euPrices;
    ean = amazon.ean ?? ean;
    keepaEans = amazon.eans;
    title = amazon.title ?? title;
    brand = amazon.brand ?? brand;

    await prisma.product.update({
      where: { id: product.id },
      data: {
        title: amazon.title ?? product.title,
        brand: amazon.brand ?? product.brand,
        category: amazon.category ?? product.category,
        imageUrl: amazon.imageUrl ?? product.imageUrl,
        ean: amazon.ean ?? product.ean,
        salesRank: amazon.salesRank ?? product.salesRank,
        salesRankDrops30: amazon.salesRankDrops30 ?? product.salesRankDrops30,
        salesRankDrops90: amazon.salesRankDrops90 ?? product.salesRankDrops90,
        amazonPriceCents: amazon.priceCents ?? product.amazonPriceCents,
        amazonAvg30Cents: amazon.avgPrice30Cents ?? product.amazonAvg30Cents,
        amazonAvg90Cents: amazon.avgPrice90Cents ?? product.amazonAvg90Cents,
        rating: amazon.rating ?? product.rating,
        reviewCount: amazon.reviewCount ?? product.reviewCount,
        offerCountNew: amazon.offerCountNew ?? product.offerCountNew,
        // Keep the previous value when a lookup failed (null), so a token
        // shortage doesn't wipe already-known EU prices.
        amazonEsCents: esPrice ?? product.amazonEsCents,
        amazonFrCents: frPrice ?? product.amazonFrCents,
        amazonItCents: itPrice ?? product.amazonItCents,
        euPricesAt: new Date(),
        lastRefreshedAt: new Date(),
      },
    });

    if (amazon.priceCents != null) {
      await prisma.priceSnapshot.create({
        data: {
          productId: product.id,
          source: "amazon",
          priceCents: amazon.priceCents,
        },
      });
    }
  } catch (err) {
    console.error(`[refresh] Amazon fetch failed for ${product.asin}:`, err);
    errors.push({ source: "keepa", message: String((err as Error).message ?? err) });
  }

  // 2) Comparison sources (only when explicitly requested — saves API quota).
  if (!options.comparison) return { errors };

  // Manual GTIN override is tried first, then Keepa's.
  const eans = [product.manualEan, ean, ...keepaEans].filter(
    (e): e is string => Boolean(e),
  );
  const query: ComparisonQuery = {
    asin: product.asin,
    ean: product.manualEan ?? ean,
    eans,
    title,
    brand,
    idealoItemId,
  };

  await Promise.all(
    comparisonProviders.map(async (provider) => {
      try {
        const offer = await provider.findBestOffer(query);
        if (!offer) {
          // No match found — drop any stale offer for this source.
          await prisma.offer.deleteMany({
            where: { productId: product.id, source: provider.source },
          });
          return;
        }

        await prisma.offer.upsert({
          where: {
            productId_source: {
              productId: product.id,
              source: provider.source,
            },
          },
          create: {
            productId: product.id,
            source: provider.source,
            priceCents: offer.priceCents,
            url: offer.url,
            inStock: offer.inStock,
            matchedName: offer.matchedName,
            externalId: offer.externalId ?? null,
          },
          update: {
            priceCents: offer.priceCents,
            url: offer.url,
            inStock: offer.inStock,
            matchedName: offer.matchedName,
            externalId: offer.externalId ?? undefined,
            capturedAt: new Date(),
          },
        });

        await prisma.priceSnapshot.create({
          data: {
            productId: product.id,
            source: provider.source,
            priceCents: offer.priceCents,
          },
        });
      } catch (err) {
        console.error(
          `[refresh] ${provider.source} fetch failed for ${product.asin}:`,
          err,
        );
        errors.push({
          source: provider.source,
          message: String((err as Error).message ?? err),
        });
      }
    }),
  );

  return { errors };
}

/** Refresh a batch of products sequentially (gentle on rate limits). */
export async function refreshProducts(
  productIds: string[],
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const errors: RefreshResult["errors"] = [];
  for (const id of productIds) {
    const result = await refreshProduct(id, options);
    errors.push(...result.errors);
  }
  return { errors };
}
