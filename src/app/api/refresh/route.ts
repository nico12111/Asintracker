import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { refreshProducts } from "@/lib/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  ids: z.array(z.string()).optional(),
  comparison: z.boolean().optional(),
  shops: z.boolean().optional(),
});

/** POST /api/refresh — refresh all products, or a subset via { ids }. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const ids = parsed.success ? parsed.data.ids : undefined;
  // Comparison (idealo) and shop scraping are opt-in to protect API budgets.
  const comparison = parsed.success ? Boolean(parsed.data.comparison) : false;
  const shops = parsed.success ? Boolean(parsed.data.shops) : false;

  const targets =
    ids && ids.length > 0
      ? ids
      : (
          await prisma.product.findMany({ select: { id: true } })
        ).map((p) => p.id);

  const result = await refreshProducts(targets, { comparison, shops });
  // Deduplicate messages so the UI can show a single concise warning.
  const messages = [...new Set(result.errors.map((e) => e.message))];
  return NextResponse.json({ refreshed: targets.length, errors: messages });
}
