import { formatCents } from "@/lib/money";

/**
 * The buying rules, as pure functions. Every purchase path (the agent during a
 * scan, a person tapping Approve) goes through these, so the guardrails can't
 * be bypassed from the UI.
 */

export interface DecideInput {
  listing: {
    lotPriceCents: number;
    lotSize: number;
    lotsAvailable: number;
    shippingCents: number;
  };
  spec: {
    name: string;
    targetUnits: number;
    maxUnitsPerOrder: number;
  };
  source: {
    name: string;
    purchaseMethod: string; // api | checkout_link
    autoBuyAllowed: boolean;
  };
  settings: {
    autoBuyEnabled: boolean;
    paused: boolean;
    weeklyCapCents: number;
    perOrderCapCents: number;
  };
  unitsOwned: number;
  weekSpendCents: number;
}

export interface OrderSize {
  lots: number;
  units: number;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

export type Decision =
  | ({ kind: "auto_buy"; note: string } & OrderSize)
  | ({ kind: "queue"; note: string; overWeeklyCap: boolean } & OrderSize)
  | { kind: "blocked"; note: string };

export function orderCost(
  listing: DecideInput["listing"],
  lots: number,
): OrderSize {
  const subtotalCents = listing.lotPriceCents * lots;
  return {
    lots,
    units: listing.lotSize * lots,
    subtotalCents,
    shippingCents: listing.shippingCents,
    totalCents: subtotalCents + listing.shippingCents,
  };
}

export type OrderPlan =
  | { kind: "blocked"; note: string }
  | ({ kind: "ok"; overWeeklyCap: boolean } & OrderSize);

/**
 * How big an order should be: fill the remaining need, never past the
 * spec's per-order unit limit or the per-order dollar cap, and shrink to fit
 * the weekly cap when possible. Says "blocked" when no order can ever work.
 */
export function planOrder(input: Omit<DecideInput, "source">): OrderPlan {
  const { listing, spec, settings, unitsOwned, weekSpendCents } = input;

  if (listing.lotSize > spec.maxUnitsPerOrder) {
    return {
      kind: "blocked",
      note: `A lot of ${listing.lotSize} is more than the ${spec.maxUnitsPerOrder}-per-order limit for ${spec.name}`,
    };
  }

  const remaining = Math.max(0, spec.targetUnits - unitsOwned);
  const unitBudget = Math.min(remaining, spec.maxUnitsPerOrder);
  let lots = Math.min(listing.lotsAvailable, Math.max(1, Math.floor(unitBudget / listing.lotSize)));

  while (lots > 1 && orderCost(listing, lots).totalCents > settings.perOrderCapCents) lots--;
  if (orderCost(listing, lots).totalCents > settings.perOrderCapCents) {
    return {
      kind: "blocked",
      note: `One lot costs ${formatCents(orderCost(listing, 1).totalCents)} with shipping, over the ${formatCents(settings.perOrderCapCents)} per-order cap`,
    };
  }

  const weekLeft = settings.weeklyCapCents - weekSpendCents;
  while (lots > 1 && orderCost(listing, lots).totalCents > weekLeft) lots--;
  const size = orderCost(listing, lots);
  return { kind: "ok", overWeeklyCap: size.totalCents > weekLeft, ...size };
}

export function decide(input: DecideInput): Decision {
  const { source, settings, weekSpendCents } = input;

  const plan = planOrder(input);
  if (plan.kind === "blocked") return plan;
  const { overWeeklyCap } = plan;
  const size = orderCost(input.listing, plan.lots);

  const queue = (note: string) => ({ kind: "queue" as const, note, overWeeklyCap, ...size });

  if (settings.paused) return queue("Buying is paused");
  if (overWeeklyCap) {
    return queue(
      `Would bring this week to ${formatCents(weekSpendCents + size.totalCents)}, over the ${formatCents(settings.weeklyCapCents)} cap`,
    );
  }
  if (!settings.autoBuyEnabled) return queue("Auto-buy is off, so this waits for approval");
  if (source.purchaseMethod !== "api") {
    return queue(`${source.name} needs a person to check out`);
  }
  if (!source.autoBuyAllowed) {
    return queue(`Auto-buy isn't turned on for ${source.name} yet`);
  }
  return { kind: "auto_buy", note: "Bought automatically: within spec and caps", ...size };
}

/**
 * Checked again at the moment a person approves, since caps and spend may
 * have moved since the listing was queued. Returns an error message or null.
 */
export function approvalBlocker(input: {
  settings: DecideInput["settings"];
  weekSpendCents: number;
  totalCents: number;
}): string | null {
  const { settings, weekSpendCents, totalCents } = input;
  if (settings.paused) return "Buying is paused. Resume it in Settings to approve orders.";
  if (totalCents > settings.perOrderCapCents) {
    return `This order is ${formatCents(totalCents)}, over the ${formatCents(settings.perOrderCapCents)} per-order cap.`;
  }
  if (weekSpendCents + totalCents > settings.weeklyCapCents) {
    return `This order would bring this week to ${formatCents(weekSpendCents + totalCents)}, over the ${formatCents(settings.weeklyCapCents)} cap. Raise the cap in Settings or wait for Monday's reset.`;
  }
  return null;
}
