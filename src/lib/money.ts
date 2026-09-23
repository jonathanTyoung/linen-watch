const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

export function formatCentsWhole(cents: number): string {
  return usdWhole.format(Math.round(cents / 100));
}

/** "12.5" or "$12.50" -> 1250. Returns NaN for garbage. */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(parseFloat(cleaned) * 100);
}

/**
 * What one unit actually costs once shipping is spread across the lot.
 * This is the number specs are compared against.
 */
export function landedUnitCents(
  lotPriceCents: number,
  lotSize: number,
  shippingCents: number,
): number {
  return Math.round((lotPriceCents + shippingCents) / lotSize);
}
