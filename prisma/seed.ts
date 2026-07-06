import { PrismaClient } from "@prisma/client";
import { refreshProducts } from "../src/lib/refresh";

const prisma = new PrismaClient();

// A few sample ASINs so the dashboard is populated on first run (mock data
// unless a Keepa key is configured).
const SAMPLE_ASINS = [
  "B08N5WRWNW",
  "B0DVGW1KF8",
  "B0DVGWCGD4",
  "B0BDHWDR12",
  "B09G9FPHY6",
  "B07PGL2N7J",
  "B0C1J3Z5QX",
  "B08H93ZRK9",
];

async function main() {
  const created: string[] = [];
  for (const asin of SAMPLE_ASINS) {
    const product = await prisma.product.upsert({
      where: { asin },
      create: { asin },
      update: {},
    });
    created.push(product.id);
  }
  console.log(`Seeded ${created.length} products, refreshing prices…`);
  await refreshProducts(created);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
