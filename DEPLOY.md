# AsinTracker auf Vercel deployen

Schritt-für-Schritt-Anleitung, damit die App unter einer echten URL live läuft
– mit echten Amazon-Preisen (Keepa) und idealo-Vergleich.

Du brauchst 3 kostenlose Konten: **GitHub** (hast du), **Vercel**, und eine
**PostgreSQL-Datenbank** (z. B. Neon – kostenlos, ohne Kreditkarte).

---

## Schritt 1 – Datenbank anlegen (Neon)

1. Gehe auf https://neon.tech und melde dich an (z. B. mit GitHub).
2. „Create Project" → Name z. B. `asintracker`, Region **Europe (Frankfurt)**.
3. Nach dem Anlegen zeigt Neon dir Connection-Strings. Du brauchst **zwei**:
   - **Pooled connection** (enthält `-pooler` im Host) → das wird `DATABASE_URL`
   - **Direct connection** (ohne `-pooler`) → das wird `DIRECT_URL`

   > Tipp: Im Neon-Dashboard unter „Connection Details" gibt es einen Schalter
   > „Pooled connection". Ein-/ausgeschaltet bekommst du beide Varianten.

Beide Strings kurz beiseitelegen (kommen in Schritt 3).

---

## Schritt 2 – Projekt in Vercel importieren

1. Gehe auf https://vercel.com und melde dich mit **GitHub** an.
2. „Add New…" → „Project".
3. Wähle das Repository **`Asintracker`** aus und klicke „Import".
4. **Framework Preset**: Vercel erkennt automatisch **Next.js** – nichts ändern.
5. **Branch**: setze den Production-Branch auf
   `claude/amazon-price-comparison-tool-k9mz3k`
   (oder merge diesen Branch vorher in `main`).
6. **Noch nicht deployen** – zuerst die Environment-Variablen (Schritt 3).

---

## Schritt 3 – Environment-Variablen setzen

In Vercel unter **Settings → Environment Variables** (oder direkt im Import-
Dialog) folgende Werte anlegen (Scope: „Production" und „Preview"):

| Name | Wert |
| --- | --- |
| `DATABASE_URL` | Neon **Pooled**-String (mit `-pooler`) |
| `DIRECT_URL` | Neon **Direct**-String (ohne `-pooler`) |
| `KEEPA_API_KEY` | dein Keepa-Token |
| `KEEPA_DOMAIN` | `3` (Amazon.de) |
| `IDEALO_API_URL` | `https://idealo-api.p.rapidapi.com` |
| `IDEALO_API_KEY` | dein RapidAPI-Key |
| `IDEALO_API_KEY_HEADER` | `x-rapidapi-key` |
| `IDEALO_API_HOST` | `idealo-api.p.rapidapi.com` |
| `IDEALO_COUNTRY` | `DE` |
| `DEFAULT_REFERRAL_FEE_PCT` | `15` |
| `DEFAULT_FULFILLMENT_FEE_EUR` | `3.50` |
| `BUY_OPPORTUNITY_MIN_ROI_PCT` | `15` |

> billiger.de-Variablen kannst du weglassen – dann läuft billiger im Demo-Modus.

---

## Schritt 4 – Deployen

1. Klicke **„Deploy"**.
2. Der Build erstellt automatisch die Datenbanktabellen
   (`prisma db push` läuft im Build-Schritt).
3. Nach ~2 Min bekommst du eine URL wie `https://asintracker-xxxx.vercel.app`.

Fertig – öffne die URL, füge eine echte ASIN hinzu und du siehst echte
Amazon-Preise + Marge. 🎉

---

## Wichtige Hinweise

- **Keys rotieren**: Deine API-Keys standen im Chat – erneuere sie sicherheits-
  halber (Keepa-Konto & RapidAPI-Dashboard) und trage die neuen in Vercel ein.
  **Keys niemals ins Git-Repo committen** – nur als Vercel-Env-Variablen.
- **Schema-Änderungen**: bei neuen DB-Feldern reicht ein erneutes Deploy
  (der Build führt `prisma db push` erneut aus).
- **Timeouts**: „Alle Preise aktualisieren" verarbeitet Produkte nacheinander.
  Bei sehr vielen ASINs kann eine Serverless-Function ins Timeout laufen
  (Hobby-Plan: 10 s). Für regelmäßige Massen-Updates später einen Cron-Job /
  Hintergrund-Job ergänzen.
- **idealo**: Wenn die idealo-RapidAPI keine Daten liefert (z. B. 404/leere
  Antwort vom Anbieter), bleibt die idealo-Spalte leer – Amazon-Daten und Marge
  funktionieren trotzdem. Der Anbieter der RapidAPI muss dann funktionieren.
