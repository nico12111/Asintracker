/**
 * Centralised, typed access to environment configuration.
 * Everything has a sensible default so the app runs out-of-the-box in mock mode.
 */

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  keepa: {
    apiKey: process.env.KEEPA_API_KEY?.trim() || "",
    domain: process.env.KEEPA_DOMAIN?.trim() || "3",
    get enabled() {
      return this.apiKey.length > 0;
    },
  },
  idealo: {
    apiUrl: process.env.IDEALO_API_URL?.trim().replace(/\/$/, "") || "",
    apiKey: process.env.IDEALO_API_KEY?.trim() || "",
    keyHeader: process.env.IDEALO_API_KEY_HEADER?.trim() || "Authorization",
    host: process.env.IDEALO_API_HOST?.trim() || "",
    country: process.env.IDEALO_COUNTRY?.trim() || "DE",
    get enabled() {
      return this.apiUrl.length > 0;
    },
  },
  billiger: {
    apiUrl: process.env.BILLIGER_API_URL?.trim().replace(/\/$/, "") || "",
    apiKey: process.env.BILLIGER_API_KEY?.trim() || "",
    get enabled() {
      return this.apiUrl.length > 0;
    },
  },
  margin: {
    referralFeePct: num(process.env.DEFAULT_REFERRAL_FEE_PCT, 15),
    fulfillmentFeeCents: Math.round(
      num(process.env.DEFAULT_FULFILLMENT_FEE_EUR, 3.5) * 100,
    ),
    buyOpportunityMinRoiPct: num(process.env.BUY_OPPORTUNITY_MIN_ROI_PCT, 15),
  },
} as const;
