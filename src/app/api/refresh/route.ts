import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { refreshProducts } from "@/lib/refresh";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.string()).optional() });

/** POST /api/refresh — refresh all products, or a subset via { ids }. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const ids = parsed.success ? parsed.data.ids : undefined;

  const targets =
    ids && ids.length > 0
      ? ids
      : (
          await prisma.product.findMany({ select: { id: true } })
        ).map((p) => p.id);

  await refreshProducts(targets);
  return NextResponse.json({ refreshed: targets.length });
}
