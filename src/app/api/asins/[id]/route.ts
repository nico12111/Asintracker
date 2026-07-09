import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { refreshProduct } from "@/lib/refresh";
import { serializeProduct } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** DELETE /api/asins/:id — stop tracking a product. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  await prisma.product.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({ ean: z.string() });

/**
 * PATCH /api/asins/:id — set a manual GTIN/EAN override, then re-match idealo.
 * Clears the cached idealo offer so the new GTIN is used from scratch.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const json = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const manualEan = parsed.data.ean.replace(/\s+/g, "").trim() || null;

  await prisma.product.update({
    where: { id: params.id },
    data: { manualEan },
  });
  // Drop the stale idealo offer so the new GTIN resolves fresh.
  await prisma.offer.deleteMany({
    where: { productId: params.id, source: "idealo" },
  });

  const result = await refreshProduct(params.id, { comparison: true });
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { offers: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    product: serializeProduct(product),
    errors: result.errors,
  });
}

/**
 * POST /api/asins/:id — refresh a single product and return its new state.
 * By default only Amazon/Keepa data is refreshed (cheap). Pass ?comparison=1
 * to also re-query idealo (uses the limited third-party API quota).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const comparison =
    new URL(req.url).searchParams.get("comparison") === "1";
  const result = await refreshProduct(params.id, { comparison });
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { offers: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    product: serializeProduct(product),
    errors: result.errors,
  });
}
