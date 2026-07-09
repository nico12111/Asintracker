import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseAsins } from "@/lib/asin";
import { serializeProduct } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().optional(),
  asins: z.array(z.string()).optional(),
});

/** GET /api/asins — all tracked products with computed margins. */
export async function GET() {
  const products = await prisma.product.findMany({
    include: { offers: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ products: products.map(serializeProduct) });
}

/** POST /api/asins — add ASINs (from text/URLs or an array), then refresh. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const raw = [parsed.data.text ?? "", ...(parsed.data.asins ?? [])].join("\n");
  const asins = parseAsins(raw);

  if (asins.length === 0) {
    return NextResponse.json(
      { error: "Keine gültigen ASINs gefunden." },
      { status: 400 },
    );
  }

  const existing = await prisma.product.findMany({
    where: { asin: { in: asins } },
    select: { asin: true },
  });
  const existingSet = new Set(existing.map((e) => e.asin));
  const newAsins = asins.filter((a) => !existingSet.has(a));

  const created = await Promise.all(
    newAsins.map((asin) => prisma.product.create({ data: { asin } })),
  );

  // Respond immediately — the rows appear in the UI right away. The client
  // then loads Keepa data for the returned ids in small batches, and idealo
  // stays a manual per-row action (limited quota).
  return NextResponse.json({
    added: newAsins,
    skipped: [...existingSet],
    total: asins.length,
    ids: created.map((p) => p.id),
  });
}
