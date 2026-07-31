import { env } from "../env";

/**
 * Fetch a target URL's HTML through the configured scraping proxy. Returns null
 * on any failure (blocked, timeout, no service configured) so callers degrade
 * gracefully instead of throwing.
 */
export async function scrapeHtml(
  targetUrl: string,
  timeoutMs = 20000,
): Promise<string | null> {
  if (!env.scraper.enabled) return null;

  const requestUrl = env.scraper.urlTemplate.replace(
    "{url}",
    encodeURIComponent(targetUrl),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(requestUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
