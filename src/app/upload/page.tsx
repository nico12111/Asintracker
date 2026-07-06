import Link from "next/link";
import { prisma } from "@/lib/db";
import { UploadForm } from "@/components/UploadForm";

export const metadata = { title: "ASINs importieren – AsinTracker" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    select: { asin: true, title: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ASINs importieren</h1>
        <p className="text-sm text-slate-400">
          Füge ASINs ein (eine pro Zeile), lade eine CSV/TXT-Datei hoch oder
          kopiere ganze Amazon-Links – wir erkennen die ASINs automatisch.
        </p>
      </div>

      <UploadForm />

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="font-semibold">
            Bereits getrackt{" "}
            <span className="text-slate-400">({products.length})</span>
          </h2>
          <Link href="/" className="text-sm text-emerald-400 hover:underline">
            Zum Dashboard →
          </Link>
        </div>

        {products.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Noch keine ASINs gespeichert.
          </p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-slate-800 overflow-y-auto">
            {products.map((p) => (
              <li
                key={p.asin}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <a
                  href={`https://www.amazon.de/dp/${p.asin}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-slate-400 hover:text-emerald-400"
                >
                  {p.asin}
                </a>
                <span className="truncate text-slate-300">
                  {p.title ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
