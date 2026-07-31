"use client";

/**
 * Refresh products in small batches from the browser (Keepa-only by default).
 * Keeps every request well under the serverless time limit and lets the UI
 * update progressively between batches.
 */
export async function refreshIdsInBatches(
  ids: string[],
  onBatchDone?: (done: number, total: number) => Promise<void> | void,
  batchSize = 4,
  comparison = false,
  shops = false,
): Promise<string[]> {
  // idealo / shop lookups are slow — keep one product per request.
  const size = comparison || shops ? 1 : batchSize;
  const errors = new Set<string>();
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, comparison, shops }),
      });
      const data = await res.json().catch(() => ({}));
      for (const msg of data.errors ?? []) errors.add(String(msg));
    } catch {
      /* network hiccup — keep going with the next batch */
    }
    await onBatchDone?.(Math.min(i + size, ids.length), ids.length);
  }
  return [...errors];
}
