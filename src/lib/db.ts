import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Extract a clean connection string from DATABASE_URL. Env values pasted into
 * hosting dashboards sometimes arrive wrapped in quotes, with stray whitespace,
 * or prefixed (e.g. `psql 'postgresql://…'`). Pull out the real URL so Prisma
 * always receives a value starting with postgres:// or postgresql://.
 */
function cleanDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const match = raw.match(/postgres(?:ql)?:\/\/[^\s"']+/i);
  return match ? match[0] : raw.trim();
}

const datasourceUrl = cleanDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
