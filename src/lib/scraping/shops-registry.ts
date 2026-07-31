/**
 * Registry of German online shops. Each entry knows how to build a search URL
 * for a term (we search by EAN, falling back to the product title). The
 * generic schema.org parser then reads offers from the returned page.
 *
 * This is the extensible core: add a shop by appending one entry here. Some
 * shops render prices only on product-detail pages or via JavaScript — those
 * need per-shop handling later, but many Shopware/JTL/Magento shops expose
 * schema.org offers straight on the search page.
 */
export interface ShopEntry {
  /** Stable key (also used as the offer source). */
  key: string;
  name: string;
  /** Build the search URL for a query (already URL-encoded by the caller). */
  searchUrl: (encodedTerm: string) => string;
  /** Shop homepage host, for display. */
  host: string;
}

export const SHOPS: ShopEntry[] = [
  { key: "mediamarkt", name: "MediaMarkt", host: "mediamarkt.de", searchUrl: (q) => `https://www.mediamarkt.de/de/search.html?query=${q}` },
  { key: "saturn", name: "Saturn", host: "saturn.de", searchUrl: (q) => `https://www.saturn.de/de/search.html?query=${q}` },
  { key: "euronics", name: "Euronics", host: "euronics.de", searchUrl: (q) => `https://www.euronics.de/search?q=${q}` },
  { key: "cyberport", name: "Cyberport", host: "cyberport.de", searchUrl: (q) => `https://www.cyberport.de/?q=${q}` },
  { key: "notebooksbilliger", name: "notebooksbilliger", host: "notebooksbilliger.de", searchUrl: (q) => `https://www.notebooksbilliger.de/produkte/${q}` },
  { key: "alternate", name: "Alternate", host: "alternate.de", searchUrl: (q) => `https://www.alternate.de/html/search.html?query=${q}` },
  { key: "conrad", name: "Conrad", host: "conrad.de", searchUrl: (q) => `https://www.conrad.de/de/search.html?search=${q}` },
  { key: "expert", name: "expert", host: "expert.de", searchUrl: (q) => `https://www.expert.de/shop/suche?q=${q}` },
  { key: "galaxus", name: "Galaxus", host: "galaxus.de", searchUrl: (q) => `https://www.galaxus.de/de/search?q=${q}` },
  { key: "coolblue", name: "Coolblue", host: "coolblue.de", searchUrl: (q) => `https://www.coolblue.de/suche?query=${q}` },
  { key: "otto", name: "Otto", host: "otto.de", searchUrl: (q) => `https://www.otto.de/suche/${q}/` },
  { key: "kaufland", name: "Kaufland", host: "kaufland.de", searchUrl: (q) => `https://www.kaufland.de/item/suche/?q=${q}` },
];

export function shopByKey(key: string): ShopEntry | undefined {
  return SHOPS.find((s) => s.key === key);
}
