"use client";

/**
 * Refresh products in small batches from the browser (Keepa-only by default).
 * Keeps every request well under the serverless time limit and lets the UI
 * update progressively between batches.
 */
export async function refreshIdsInBatches(
  ids: string[],
  onBatchDone?: (done: number, total: number) => Promise<void> | void,
  batchSize = 5,
): Promise<void> {
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk }),
    }).catch(() => null);
    await onBatchDone?.(Math.min(i + batchSize, ids.length), ids.length);
  }
}
