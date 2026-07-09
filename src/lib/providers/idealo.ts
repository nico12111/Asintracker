import { env } from "../env";
import type {
  ComparisonProvider,
  ComparisonOffer,
  ComparisonQuery,
} from "../types";

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
  // Confirmed from RapidAPI "Code Snippet" for search-by-gtin.
  paths: {
    searchByGtin: process.env.IDEALO_PATH_GTIN?.trim() || "/search-by-gtin",
    searchByTerm: process.env.IDEALO_PATH_TERM?.trim() || "/search-by-term",
    // Best-guess for the "Start search by id" endpoint (resilient: falls back
    // to GTIN/title if it 404s). Confirm/override via IDEALO_PATH_ID.
    searchById: process.env.IDEALO_PATH_ID?.trim() || "/search-by-id",
    // Poll base; the job id is appended as a path segment: /poll-job/<jobId>
    poll: process.env.IDEALO_PATH_POLL?.trim() || "/poll-job",
  },
  fields: {
    // The start endpoints take the search value in a "values" field.
    value: "values",
    country: "country",
    jobId: "job_id",
  },
  poll: {
    // Jobs need a few seconds; wait before the first poll to save requests.
    initialDelayMs: 5000,
    delayMs: 3000,
    // Hard cap on poll requests per job (each poll counts against API quota).
    maxPolls: 6,
    // Overall time budget for one findBestOffer call (serverless maxDuration
    // is 60s; leave headroom for the Keepa fetch that ran before this).
    budgetMs: 48000,
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
  id?: string | null;
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

// ── Precise parser for the Idealo Data poll response ──────────────────────
// {
//   status: "finished",
//   results: [{ content: { name, url, price_min, offers: [{ price, total,
//               shop_name, shop_url, availability_code }] } }]
// }
interface IdealoDataOffer {
  price?: number;
  total?: number;
  shop_name?: string;
  shop_url?: string;
  availability_code?: string;
}
interface IdealoDataContent {
  id?: string | number;
  name?: string;
  url?: string;
  price_min?: number;
  offers?: IdealoDataOffer[];
}
interface IdealoDataResult {
  content?: IdealoDataContent;
  success?: boolean;
}
interface IdealoDataPoll {
  status?: string;
  results?: IdealoDataResult[];
}

const TERMINAL = ["finished", "success", "completed", "done"];
const FAILED = ["failed", "error", "not_found"];
const PENDING = ["pending", "processing", "running", "queued", "started", "in_progress"];

/** Extract the cheapest available offer from a poll response. */
function parsePoll(json: unknown): RawOffer | null {
  const results = (json as IdealoDataPoll)?.results;
  if (Array.isArray(results)) {
    let best: RawOffer | null = null;
    for (const r of results) {
      const c = r?.content;
      if (!c) continue;

      let euro: number | null = null;
      if (Array.isArray(c.offers)) {
        for (const o of c.offers) {
          // Prefer total (incl. shipping) as the real purchase cost.
          const p = typeof o.total === "number" ? o.total : o.price;
          if (typeof p === "number" && p > 0 && (euro == null || p < euro)) {
            euro = p;
          }
        }
      }
      if (euro == null && typeof c.price_min === "number" && c.price_min > 0) {
        euro = c.price_min;
      }
      if (euro == null) continue;

      if (best == null || euro < best.euro) {
        best = {
          euro,
          url: c.url ?? null,
          name: c.name ?? null,
          id: c.id != null ? String(c.id) : null,
        };
      }
    }
    if (best) return best;
  }

  // Fallback: generic sweep for unexpected shapes.
  const acc: RawOffer[] = [];
  collectOffers(json, acc);
  return acc.length ? acc.reduce((a, b) => (b.euro < a.euro ? b : a)) : null;
}

function pollState(json: unknown): "ready" | "pending" | "failed" {
  const status = (json as IdealoDataPoll)?.status?.toLowerCase();
  if (status) {
    if (PENDING.includes(status)) return "pending";
    if (FAILED.includes(status)) return "failed";
    if (TERMINAL.includes(status)) return "ready";
  }
  // Unknown/absent status: ready only once offers are present.
  return parsePoll(json) != null ? "ready" : "pending";
}

function buildHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (contentType) headers["Content-Type"] = contentType;
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

/**
 * Build an ordered, de-duplicated list of GTIN candidates to try on idealo.
 * Normalises to digits and adds UPC-A <-> EAN-13 variants, since Keepa and
 * idealo don't always agree on the exact code form.
 */
function gtinCandidates(eans: string[], primary: string | null): string[] {
  const set = new Set<string>();
  const source = [primary, ...eans].filter(Boolean) as string[];
  for (const raw of source) {
    const e = raw.replace(/\D/g, "");
    if (!e) continue;
    set.add(e);
    if (e.length === 12) set.add("0" + e); // UPC-A -> EAN-13
    if (e.length === 13 && e.startsWith("0")) set.add(e.slice(1)); // EAN-13 -> UPC-A
  }
  return [...set].slice(0, 3);
}

/**
 * Turn a long Amazon title into a concise idealo search term: take the part
 * before the first separator (–, -, |, ,), prepend the brand if missing, and
 * cap the length. e.g. "Teufel REAL Blue NC 3 - Kabellose Bluetooth…" ->
 * "Teufel REAL Blue NC 3".
 */
function cleanSearchTerm(title: string, brand: string | null): string {
  let core = title.split(/\s[–—\-|,]\s|,\s/)[0]?.trim() || title.trim();
  if (core.length > 70) core = core.slice(0, 70).trim();
  if (brand && !core.toLowerCase().includes(brand.toLowerCase())) {
    core = `${brand} ${core}`;
  }
  return core;
}

class IdealoProvider implements ComparisonProvider {
  readonly source = "idealo" as const;

  get enabled() {
    return env.idealo.enabled;
  }

  async findBestOffer(query: ComparisonQuery): Promise<ComparisonOffer | null> {
    if (!this.enabled) return null;

    const deadline = Date.now() + IDEALO_DATA.poll.budgetMs;
    let best: RawOffer | null = null;

    // 1) Fastest path: we already resolved the idealo item id before.
    if (query.idealoItemId) {
      best = await this.searchAndPoll("id", query.idealoItemId, deadline);
    }

    // 2) Try every known GTIN/EAN (incl. UPC<->EAN-13 variants).
    if (!best) {
      for (const gtin of gtinCandidates(query.eans, query.ean)) {
        if (Date.now() > deadline) break;
        best = await this.searchAndPoll("gtin", gtin, deadline);
        if (best) break;
      }
    }

    // 3) Last resort: search by a cleaned product title (brand + core name).
    if (!best && query.title && Date.now() < deadline) {
      best = await this.searchAndPoll(
        "term",
        cleanSearchTerm(query.title, query.brand),
        deadline,
      );
    }

    if (!best) return null;

    return {
      source: this.source,
      priceCents: Math.round(best.euro * 100),
      url: best.url,
      inStock: true,
      matchedName: best.name,
      externalId: best.id ?? null,
      mock: false,
    };
  }

  /** Verbose diagnostic: shows the raw poll responses over time (/api/debug). */
  async debug(query: ComparisonQuery): Promise<unknown> {
    if (!this.enabled) return { enabled: false };
    const candidates = gtinCandidates(query.eans, query.ean);
    const gtin = candidates[0] ?? null;

    let jobId: string | null = null;
    let startError: string | null = null;
    try {
      if (gtin) jobId = await this.startSearch("gtin", gtin);
    } catch (err) {
      startError = String(err);
    }

    const pollUrl = jobId
      ? `${env.idealo.apiUrl}${IDEALO_DATA.paths.poll}/${encodeURIComponent(jobId)}`
      : null;

    const polls: unknown[] = [];
    if (pollUrl) {
      await sleep(IDEALO_DATA.poll.initialDelayMs);
      for (let i = 0; i < IDEALO_DATA.poll.maxPolls; i++) {
        const rec: Record<string, unknown> = { i };
        try {
          const res = await fetch(pollUrl, {
            method: "GET",
            headers: buildHeaders("application/json"),
            cache: "no-store",
          });
          rec.http = res.status;
          if (res.ok) {
            const json = (await res.json()) as { status?: string };
            rec.status = json?.status ?? null;
            rec.state = pollState(json);
            rec.offer = parsePoll(json);
            rec.sample = JSON.stringify(json).slice(0, 500);
          } else {
            rec.body = (await res.text()).slice(0, 300);
          }
        } catch (err) {
          rec.error = String(err);
        }
        polls.push(rec);
        if (rec.state === "ready" || rec.state === "failed") break;
        await sleep(1500);
      }
    }

    return {
      version: "debug-v2-pollraw",
      pollUrlTemplate: `${IDEALO_DATA.paths.poll}/<jobId>`,
      candidates,
      gtin,
      jobId,
      startError,
      polls,
    };
  }

  /**
   * Start a search of the given kind, poll for results, return cheapest.
   * Resilient: any error (e.g. an unsupported endpoint) resolves to null so
   * the caller can fall through to the next strategy.
   */
  private async searchAndPoll(
    kind: "gtin" | "term" | "id",
    value: string,
    deadline: number,
  ): Promise<RawOffer | null> {
    try {
      const jobId = await this.startSearch(kind, value);
      if (!jobId) return null;
      const results = await this.pollResults(jobId, deadline);
      if (!results) return null;
      return parsePoll(results);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      // A rate limit hits every follow-up request too — surface it to the UI
      // instead of silently showing "no offer".
      if (msg.includes("429")) {
        throw new Error(
          "idealo-API-Limit erreicht (429) – RapidAPI-Kontingent prüfen/upgraden",
        );
      }
      console.error(`[idealo] ${kind} search failed for "${value}":`, err);
      return null;
    }
  }

  /** Kick off a search job and return its id. */
  private async startSearch(
    kind: "gtin" | "term" | "id",
    value: string,
  ): Promise<string | null> {
    const path =
      kind === "gtin"
        ? IDEALO_DATA.paths.searchByGtin
        : kind === "id"
          ? IDEALO_DATA.paths.searchById
          : IDEALO_DATA.paths.searchByTerm;

    // The API expects an x-www-form-urlencoded body with a lowercase country.
    const body = new URLSearchParams({
      [IDEALO_DATA.fields.value]: value,
      [IDEALO_DATA.fields.country]: env.idealo.country.toLowerCase(),
    }).toString();

    // Retry on 429 (rate limit) with backoff, respecting Retry-After.
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${env.idealo.apiUrl}${path}`, {
        method: "POST",
        headers: buildHeaders("application/x-www-form-urlencoded"),
        body,
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Math.min(
          (Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter
            : 2 * (attempt + 1)) * 1000,
          8000,
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(
          `idealo start-search failed: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as StartResponse;
      return data.job_id ?? data.jobId ?? null;
    }
    throw new Error("idealo start-search failed: 429 (rate limited)");
  }

  /** Poll /poll-job/<jobId> until results are ready, a time budget is hit. */
  private async pollResults(
    jobId: string,
    deadline: number,
  ): Promise<unknown | null> {
    const pollUrl = `${env.idealo.apiUrl}${IDEALO_DATA.paths.poll}/${encodeURIComponent(
      jobId,
    )}`;

    // Give the job a head start before the first (quota-costing) poll.
    await sleep(IDEALO_DATA.poll.initialDelayMs);

    for (let i = 0; i < IDEALO_DATA.poll.maxPolls; i++) {
      if (Date.now() > deadline) break;
      const res = await fetch(pollUrl, {
        method: "GET",
        headers: buildHeaders("application/json"),
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        const state = pollState(json);
        if (state === "ready") return json;
        if (state === "failed") return null;
      }
      await sleep(IDEALO_DATA.poll.delayMs);
    }
    return null;
  }
}

export const idealoProvider = new IdealoProvider();
