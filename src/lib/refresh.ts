import { prisma } from "./db";
import { amazonProvider, comparisonProviders } from "./providers";
import type { ComparisonQuery } from "./types";

/**
 * Refresh Amazon data and all comparison offers for a single product.
 * Every fetch is isolated so one failing provider never blocks the others.
 */
export async function refreshProduct(productId: string): Promise<void> {
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
  try {
    const amazon = await amazonProvider.fetchProduct(product.asin);
    ean = amazon.ean ?? ean;
    keepaEans = amazon.eans;
    title = amazon.title ?? title;

    await prisma.product.update({
      where: { id: product.id },
      data: {
        title: amazon.title ?? product.title,
        brand: amazon.brand ?? product.brand,
        category: amazon.category ?? product.category,
        imageUrl: amazon.imageUrl ?? product.imageUrl,
        ean: amazon.ean ?? product.ean,
        salesRank: amazon.salesRank ?? product.salesRank,
        amazonPriceCents: amazon.priceCents ?? product.amazonPriceCents,
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
  }

  // 2) Comparison sources. Manual GTIN override is tried first, then Keepa's.
  const eans = [product.manualEan, ean, ...keepaEans].filter(
    (e): e is string => Boolean(e),
  );
  const query: ComparisonQuery = {
    asin: product.asin,
    ean: product.manualEan ?? ean,
    eans,
    title,
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
      }
    }),
  );
}

/** Refresh a batch of products sequentially (gentle on rate limits). */
export async function refreshProducts(productIds: string[]): Promise<void> {
  for (const id of productIds) {
    await refreshProduct(id);
  }
}
