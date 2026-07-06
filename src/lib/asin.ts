/** Amazon ASINs are 10 chars: "B" + 9 alphanumerics, or a 10-digit ISBN. */
const ASIN_REGEX = /\b(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])\b/gi;

/**
 * Extract unique, upper-cased ASINs from arbitrary text: pasted lists,
 * CSV rows, or full Amazon URLs (…/dp/ASIN, …/gp/product/ASIN).
 */
export function parseAsins(input: string): string[] {
  const found = new Set<string>();
  const matches = input.toUpperCase().match(ASIN_REGEX);
  if (matches) {
    for (const m of matches) found.add(m);
  }
  return [...found];
}

export function isValidAsin(candidate: string): boolean {
  const trimmed = candidate.trim().toUpperCase();
  return /^(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])$/.test(trimmed);
}
