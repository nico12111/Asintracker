import { prisma } from "@/lib/db";
import { UploadForm } from "@/components/UploadForm";
import { TrackedList } from "@/components/TrackedList";

export const metadata = { title: "ASINs importieren – AsinTracker" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, asin: true, title: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ASINs importieren</h1>
        <p className="text-sm text-slate-400">
          Füge ASINs ein (eine pro Zeile), lade eine CSV/TXT-Datei hoch oder
          kopiere ganze Amazon-Links – wir erkennen die ASINs automatisch. Unten
          kannst du gespeicherte ASINs auch wieder entfernen.
        </p>
      </div>

      <UploadForm />

      <TrackedList items={products} />
    </div>
  );
}
