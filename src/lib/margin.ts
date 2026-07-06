import { env } from "./env";

export interface MarginInput {
  /** Amazon Buy-Box / sell price in cents. */
  amazonPriceCents: number | null;
  /** Cheapest available buy price across comparison sources, in cents. */
  bestBuyPriceCents: number | null;
  /** Amazon referral fee percent for this product (falls back to default). */
  referralFeePct?: number | null;
  /** Flat fulfilment fee in cents (falls back to default). */
  fulfillmentFeeCents?: number | null;
  /** Minimum ROI % to flag a buy opportunity (falls back to default). */
  minRoiPct?: number | null;
}

export interface MarginResult {
  /** Amazon fees deducted from the sell price, in cents. */
  feesCents: number;
  /** What you keep from the Amazon sale after fees, in cents. */
  netProceedsCents: number;
  /** Profit = net proceeds − buy price, in cents. Can be negative. */
  profitCents: number | null;
  /** Profit as % of the Amazon sell price. */
  marginPct: number | null;
  /** Return on investment = profit / buy price, as %. */
  roiPct: number | null;
  /** True when buying now is worth it (positive profit and ROI ≥ threshold). */
  isBuyOpportunity: boolean;
}

/**
 * Core arbitrage math: sell on Amazon, source from idealo/billiger.
 * All money is handled in integer cents.
 */
export function computeMargin(input: MarginInput): MarginResult {
  const referralPct = input.referralFeePct ?? env.margin.referralFeePct;
  const fulfillment =
    input.fulfillmentFeeCents ?? env.margin.fulfillmentFeeCents;
  const minRoi = input.minRoiPct ?? env.margin.buyOpportunityMinRoiPct;

  const amazon = input.amazonPriceCents;

  if (amazon == null) {
    return {
      feesCents: 0,
      netProceedsCents: 0,
      profitCents: null,
      marginPct: null,
      roiPct: null,
      isBuyOpportunity: false,
    };
  }

  const referralFee = Math.round((amazon * referralPct) / 100);
  const feesCents = referralFee + fulfillment;
  const netProceedsCents = amazon - feesCents;

  const buy = input.bestBuyPriceCents;
  if (buy == null || buy <= 0) {
    return {
      feesCents,
      netProceedsCents,
      profitCents: null,
      marginPct: null,
      roiPct: null,
      isBuyOpportunity: false,
    };
  }

  const profitCents = netProceedsCents - buy;
  const marginPct = amazon > 0 ? (profitCents / amazon) * 100 : null;
  const roiPct = (profitCents / buy) * 100;
  const isBuyOpportunity = profitCents > 0 && roiPct >= minRoi;

  return {
    feesCents,
    netProceedsCents,
    profitCents,
    marginPct,
    roiPct,
    isBuyOpportunity,
  };
}

/** Format integer cents as a localized EUR string. */
export function formatEuro(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct >= 0 ? "" : ""}${pct.toFixed(1)} %`;
}
