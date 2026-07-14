/**
 * Deterministic pseudo-random data so the app is fully usable without any API
 * keys. Same ASIN always yields the same demo numbers, so refreshes look stable
 * yet still produce a realistic spread of buy opportunities.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** A stable float in [0, 1) derived from a seed string. */
export function seededUnit(seed: string): number {
  return (hash(seed) % 100000) / 100000;
}

/** Stable Amazon sell price in cents for a given ASIN (roughly 15–120 €). */
export function mockAmazonPriceCents(asin: string): number {
  const base = 1500 + Math.floor(seededUnit(asin) * 10500);
  return Math.round(base / 10) * 10 + 99; // …,99 endings
}

/**
 * Stable comparison price in cents relative to the Amazon price.
 * `source` shifts the value so idealo and billiger differ, and some products
 * land clearly below the break-even point (i.e. real buy opportunities).
 */
export function mockComparisonPriceCents(
  amazonPriceCents: number,
  asin: string,
  source: string,
): number {
  // Factor between ~0.62 and ~1.05 of the Amazon price.
  const factor = 0.62 + seededUnit(`${asin}:${source}`) * 0.43;
  return Math.max(199, Math.round((amazonPriceCents * factor) / 10) * 10 - 1);
}

const MOCK_TITLES = [
  "Kabelloser Bluetooth-Kopfhörer Over-Ear",
  "Edelstahl-Thermosflasche 750 ml",
  "USB-C Ladegerät 65W GaN",
  "Ergonomische Funkmaus",
  "LED-Schreibtischlampe dimmbar",
  "Mechanische Gaming-Tastatur",
  "Powerbank 20.000 mAh",
  "Smarte WLAN-Steckdose 2er-Pack",
];

export function mockTitle(asin: string): string {
  return MOCK_TITLES[hash(asin) % MOCK_TITLES.length];
}

export function mockEan(asin: string): string {
  const n = (hash(asin) % 1_000_000_000).toString().padStart(9, "0");
  return `40${n}${(hash(asin + "x") % 10).toString()}`; // pseudo 13-digit EAN
}

const MOCK_CATEGORIES = [
  "Elektronik & Foto",
  "Küche, Haushalt & Wohnen",
  "Computer & Zubehör",
  "Beleuchtung",
  "Games",
  "Kosmetik",
  "Garten",
  "Elektro-Großgeräte",
];

export function mockCategory(asin: string): string {
  return MOCK_CATEGORIES[hash(asin + "cat") % MOCK_CATEGORIES.length];
}

export function mockSalesRank(asin: string): number {
  return 200 + (hash(asin + "bsr") % 99800);
}

/** Stable mock price for the same product on another Amazon marketplace. */
export function mockMarketPriceCents(asin: string, market: string): number {
  const base = mockAmazonPriceCents(asin);
  const factor = 0.78 + seededUnit(`${asin}:amz:${market}`) * 0.35;
  return Math.max(199, Math.round((base * factor) / 10) * 10 - 1);
}
