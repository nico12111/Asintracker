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
): Promise<void> {
  // idealo lookups take up to ~30s each — keep one per request.
  const size = comparison ? 1 : batchSize;
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, comparison }),
    }).catch(() => null);
    await onBatchDone?.(Math.min(i + size, ids.length), ids.length);
  }
}
