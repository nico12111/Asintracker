import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshProduct } from "@/lib/refresh";
import { serializeProduct } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** DELETE /api/asins/:id — stop tracking a product. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  await prisma.product.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

/** POST /api/asins/:id — refresh a single product and return its new state. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  await refreshProduct(params.id);
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { offers: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ product: serializeProduct(product) });
}
