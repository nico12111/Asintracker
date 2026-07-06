import { UploadForm } from "@/components/UploadForm";

export const metadata = { title: "ASINs importieren – AsinTracker" };

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">ASINs importieren</h1>
        <p className="text-sm text-slate-400">
          Füge ASINs ein (eine pro Zeile), lade eine CSV/TXT-Datei hoch oder
          kopiere ganze Amazon-Links – wir erkennen die ASINs automatisch.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
