# AsinTracker

Ein Tool, um Amazon-**ASINs** zu tracken, ihre Preise/Daten via **Keepa** zu
importieren und automatisch mit **idealo** und **billiger.de** zu vergleichen.
Ziel: Retail-Arbitrage – erkennen, wann ein Produkt woanders günstiger
einzukaufen ist, als es sich auf Amazon (nach Gebühren) verkaufen lässt, und die
**Marge/ROI** live berechnen.

## Features

- **ASIN-Import**: einfügen (eine pro Zeile), CSV/TXT-Upload oder ganze
  Amazon-Links – ASINs werden automatisch erkannt.
- **Amazon-Daten** via Keepa: Titel, Marke, Kategorie, Bild, EAN/GTIN, BSR,
  Buy-Box-Preis.
- **Preisvergleich** mit idealo (`/api/idealo/search`) und billiger.de.
- **Margen-Analyse**: Amazon-Gebühr (%), Versand/FBA-Pauschale und Mindest-ROI
  frei einstellbar – Gewinn & ROI werden live neu berechnet.
- **Kauf-Chancen**: Zeilen, bei denen der günstigste EK den ROI-Schwellwert
  erreicht, werden als „KAUFEN" markiert; direkter Link zum Anbieter.
- Suche, Auswahl (Bulk-Aktualisieren/Löschen), CSV-Export, Pagination.
- **Läuft ohne API-Keys** im Demo-/Mock-Modus mit realistischen Beispieldaten.

## Tech-Stack

Next.js 14 (App Router) · TypeScript · Prisma (PostgreSQL) · Tailwind CSS.

## Deployment

Für den Live-Betrieb auf **Vercel** siehe die Schritt-für-Schritt-Anleitung in
[`DEPLOY.md`](./DEPLOY.md).

## Lokaler Schnellstart

Benötigt eine PostgreSQL-Datenbank (z. B. kostenlos via [Neon](https://neon.tech)).
`DATABASE_URL` und `DIRECT_URL` dürfen lokal identisch sein.

```bash
npm install
cp .env.example .env         # DATABASE_URL/DIRECT_URL + Keys eintragen
npm run db:push              # Datenbankschema anlegen
npm run db:seed              # (optional) Beispiel-ASINs laden
npm run dev                  # http://localhost:3000
```

> Ohne API-Keys läuft alles im Demo-/Mock-Modus mit Beispieldaten.

## Konfiguration (`.env`)

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | SQLite-Datei (Standard) oder Postgres-URL |
| `KEEPA_API_KEY`, `KEEPA_DOMAIN` | Amazon-Daten via Keepa (Domain 3 = .de) |
| `IDEALO_API_URL`, `IDEALO_API_KEY` | idealo-Endpunkte `/api/idealo/search` & `/api/idealo/product` |
| `IDEALO_API_KEY_HEADER`, `IDEALO_API_HOST`, `IDEALO_COUNTRY` | Auth-Header / RapidAPI-Host / Land |
| `BILLIGER_API_URL`, `BILLIGER_API_KEY` | billiger.de Produkt-/Affiliate-API |
| `DEFAULT_REFERRAL_FEE_PCT` | Amazon-Provision (Standard 15 %) |
| `DEFAULT_FULFILLMENT_FEE_EUR` | Versand/FBA-Pauschale pro Einheit |
| `BUY_OPPORTUNITY_MIN_ROI_PCT` | ROI-Schwelle für „Kauf-Chance" |

Ist eine Quelle nicht konfiguriert, läuft der jeweilige Provider im
**Mock-Modus** (deterministische Demo-Preise) – der Status oben rechts im
Dashboard zeigt „Live" bzw. „Demo".

## Architektur

- `src/lib/providers/` – austauschbare Provider mit einheitlichem Interface:
  - `keepa.ts` (Amazon), `idealo.ts`, `billiger.ts`, jeweils mit Mock-Fallback.
- `src/lib/margin.ts` – reine Margen-/ROI-Berechnung (Cent-genau).
- `src/lib/refresh.ts` – holt Amazon + alle Vergleichsquellen und speichert
  aktuelle Angebote plus Preishistorie (`PriceSnapshot`).
- `src/app/api/` – REST-Routen (`/api/asins`, `/api/asins/[id]`, `/api/refresh`).

## Hinweise zu den Datenquellen

- **idealo**: nutzt die dokumentierten Endpunkte `/api/idealo/search` (per
  GTIN/Titel + Ländercode) und `/api/idealo/product`. Basis-URL + Key in `.env`.
- **billiger.de**: bietet primär ein Affiliate-/Partnerprogramm (Tracking via
  Cookie/Session, ROAS-Attribution). Für die reine Preisabfrage per EAN ist ein
  Produkt-/Partner-API-Zugang nötig; der Client ist dafür vorbereitet
  (`BILLIGER_API_URL`/`BILLIGER_API_KEY`) und läuft sonst im Mock-Modus.
- **Keepa**: EK/„Buy-Box" wird aus `stats` gelesen (Buy Box → Amazon → New).

## Marge / ROI

```
Gewinn  = Amazon-VK − (VK × Gebühr%) − Versand/FBA − bester EK
ROI     = Gewinn / bester EK
Chance  = Gewinn > 0 und ROI ≥ Mindest-ROI
```
