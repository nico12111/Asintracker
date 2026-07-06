import { env } from "../env";
import type {
  ComparisonProvider,
  ComparisonOffer,
  ComparisonQuery,
} from "../types";
import { mockAmazonPriceCents, mockComparisonPriceCents } from "./mock";

/**
 * idealo provider for the async "Idealo Data" RapidAPI.
 *
 * Flow:
 *   1. POST start-search (by GTIN, else by term) -> { error, job_id }
 *   2. GET poll-session-results?job_id=... until results are ready
 *   3. Extract the cheapest offer (price + url + name)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ENDPOINT CONFIG — bestätige diese Werte gegen das "Code Snippet" (cURL) der
 * jeweiligen Endpunkte in RapidAPI. Falls Pfad/Feldname abweicht, hier ändern
 * (oder per Env-Variable überschreiben).
 * ─────────────────────────────────────────────────────────────────────────
 */
const IDEALO_DATA = {
  // Base host, e.g. https://idealo-data.p.rapidapi.com  (aus IDEALO_API_URL)
  paths: {
    searchByGtin: process.env.IDEALO_PATH_GTIN?.trim() || "/search/gtin",
    searchByTerm: process.env.IDEALO_PATH_TERM?.trim() || "/search/term",
    poll: process.env.IDEALO_PATH_POLL?.trim() || "/search/results",
  },
  fields: {
    gtin: "gtin",
    term: "term",
    country: "country",
    jobId: "job_id",
  },
  poll: {
    maxAttempts: 8,
    delayMs: 800,
  },
};

interface StartResponse {
  error?: boolean;
  job_id?: string;
  jobId?: string;
  message?: string;
}

/** Recursively normalise a value into a EUR float. */
function extractEuro(value: unknown, depth = 0): number | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,]/g, "");
    if (!cleaned) return null;
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      normalized =
        cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
          ? cleaned.replace(/\./g, "").replace(",", ".")
          : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = extractEuro(v, depth + 1);
      if (found != null) return found;
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["price", "totalPrice", "total", "amount", "value", "min"]) {
      if (key in obj) {
        const found = extractEuro(obj[key], depth + 1);
        if (found != null) return found;
      }
    }
  }
  return null;
}

const PRICE_KEYS = [
  "price",
  "minPrice",
  "min_price",
  "bestPrice",
  "best_price",
  "offerPrice",
  "offer_price",
  "prices",
  "total",
  "amount",
];
const URL_KEYS = ["url", "link", "offerUrl", "offer_url", "productUrl"];
const NAME_KEYS = ["name", "title", "productName", "product_name"];

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

interface RawOffer {
  euro: number;
  url: string | null;
  name: string | null;
}

/** Walk the poll response and collect every object that carries a price. */
function collectOffers(node: unknown, acc: RawOffer[], depth = 0): void {
  if (node == null || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectOffers(n, acc, depth + 1);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    let euro: number | null = null;
    for (const key of PRICE_KEYS) {
      if (key in obj) {
        euro = extractEuro(obj[key]);
        if (euro != null) break;
      }
    }
    if (euro != null) {
      acc.push({
        euro,
        url: pickString(obj, URL_KEYS),
        name: pickString(obj, NAME_KEYS),
      });
    }
    for (const v of Object.values(obj)) collectOffers(v, acc, depth + 1);
  }
}

function buildHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (env.idealo.apiKey) {
    const value =
      env.idealo.keyHeader.toLowerCase() === "authorization"
        ? `Bearer ${env.idealo.apiKey}`
        : env.idealo.apiKey;
    headers[env.idealo.keyHeader] = value;
  }
  if (env.idealo.host) headers["x-rapidapi-host"] = env.idealo.host;
  return headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class IdealoProvider implements ComparisonProvider {
  readonly source = "idealo" as const;

  get enabled() {
    return env.idealo.enabled;
  }

  async findBestOffer(query: ComparisonQuery): Promise<ComparisonOffer | null> {
    if (!this.enabled) return this.mockOffer(query);

    // 1) Start a search — prefer the exact GTIN, else the product title.
    const jobId = query.ean
      ? await this.startSearch("gtin", query.ean)
      : query.title
        ? await this.startSearch("term", query.title)
        : null;
    if (!jobId) return null;

    // 2) Poll until results arrive.
    const results = await this.pollResults(jobId);
    if (!results) return null;

    // 3) Cheapest offer found anywhere in the response.
    const offers: RawOffer[] = [];
    collectOffers(results, offers);
    if (offers.length === 0) return null;
    const best = offers.reduce((a, b) => (b.euro < a.euro ? b : a));

    return {
      source: this.source,
      priceCents: Math.round(best.euro * 100),
      url: best.url,
      inStock: true,
      matchedName: best.name,
      mock: false,
    };
  }

  /** Kick off a search job and return its id. */
  private async startSearch(
    kind: "gtin" | "term" | "id",
    value: string,
  ): Promise<string | null> {
    const path =
      kind === "gtin"
        ? IDEALO_DATA.paths.searchByGtin
        : IDEALO_DATA.paths.searchByTerm;
    const field =
      kind === "gtin" ? IDEALO_DATA.fields.gtin : IDEALO_DATA.fields.term;

    const res = await fetch(`${env.idealo.apiUrl}${path}`, {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        [field]: value,
        [IDEALO_DATA.fields.country]: env.idealo.country,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `idealo start-search failed: ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as StartResponse;
    return data.job_id ?? data.jobId ?? null;
  }

  /** Poll the session endpoint until it stops reporting "pending". */
  private async pollResults(jobId: string): Promise<unknown | null> {
    const url = new URL(`${env.idealo.apiUrl}${IDEALO_DATA.paths.poll}`);
    url.searchParams.set(IDEALO_DATA.fields.jobId, jobId);

    for (let attempt = 0; attempt < IDEALO_DATA.poll.maxAttempts; attempt++) {
      const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(false),
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        if (this.hasResults(json)) return json;
      }
      await sleep(IDEALO_DATA.poll.delayMs);
    }
    return null;
  }

  /** Heuristic: results are ready once the payload contains any price. */
  private hasResults(json: unknown): boolean {
    const status = (json as { status?: string })?.status?.toLowerCase();
    if (status && ["pending", "processing", "running"].includes(status)) {
      return false;
    }
    const offers: RawOffer[] = [];
    collectOffers(json, offers);
    return offers.length > 0;
  }

  private mockOffer(query: ComparisonQuery): ComparisonOffer {
    const amazon = mockAmazonPriceCents(query.asin);
    return {
      source: this.source,
      priceCents: mockComparisonPriceCents(amazon, query.asin, this.source),
      url: query.ean
        ? `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${query.ean}`
        : null,
      inStock: true,
      matchedName: query.title,
      mock: true,
    };
  }
}

export const idealoProvider = new IdealoProvider();
