function Badge({ label, live }: { label: string; live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        live
          ? "bg-emerald-900/40 text-emerald-300"
          : "bg-amber-900/40 text-amber-300"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {label}: {live ? "Live" : "Demo"}
    </span>
  );
}

export function ProviderStatus({
  keepa,
  idealo,
  billiger,
}: {
  keepa: boolean;
  idealo: boolean;
  billiger: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      <Badge label="Keepa" live={keepa} />
      <Badge label="idealo" live={idealo} />
      <Badge label="billiger.de" live={billiger} />
    </div>
  );
}
