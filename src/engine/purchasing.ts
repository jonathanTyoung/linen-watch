import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { listings, orders, sources, specs } from "@/db/schema";
import { actorLabel, type Person } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { approvalBlocker, orderCost, planOrder } from "./decide";
import { getSettings, logEvent, unitsOwnedBySpec, weekSpendCents } from "./queries";
import { getAdapter } from "./sources";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

function load(db: DB, listingId: number) {
  const listing = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) return null;
  const source = db.select().from(sources).where(eq(sources.id, listing.sourceId)).get();
  const spec = listing.matchedSpecId
    ? db.select().from(specs).where(eq(specs.id, listing.matchedSpecId)).get()
    : undefined;
  if (!source || !spec) return null;
  return { listing, source, spec };
}

/**
 * A person approves a queued listing. The order is re-sized and every
 * guardrail re-checked against current spend, because things may have
 * changed since the agent queued it.
 */
export async function approveListing(
  db: DB,
  listingId: number,
  actor: Person,
  opts: { now?: Date; rng?: () => number } = {},
): Promise<ActionResult> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const loaded = load(db, listingId);
  if (!loaded) return { ok: false, message: "That listing no longer exists." };
  const { listing, source, spec } = loaded;
  if (listing.status !== "pending") {
    return { ok: false, message: "Someone already handled this listing." };
  }

  const settings = getSettings(db);
  const weekSpend = weekSpendCents(db, now);
  const plan = planOrder({
    listing,
    spec,
    settings,
    unitsOwned: unitsOwnedBySpec(db).get(spec.id) ?? 0,
    weekSpendCents: weekSpend,
  });
  if (plan.kind === "blocked") return { ok: false, message: plan.note };

  const blocker = approvalBlocker({ settings, weekSpendCents: weekSpend, totalCents: plan.totalCents });
  if (blocker) return { ok: false, message: blocker };

  const who = actorLabel(actor);

  if (source.purchaseMethod !== "api") {
    db.update(listings)
      .set({
        status: "awaiting_checkout",
        proposedLots: plan.lots,
        note: `Approved by ${who}. Buy ${plan.lots} lot${plan.lots === 1 ? "" : "s"} on ${source.name}, then mark it purchased.`,
        decidedBy: actor,
        decidedAt: now,
      })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(db, {
      type: "approved",
      actor,
      listingId: listing.id,
      message: `${who} approved ${listing.title}. Checkout on ${source.name} is manual.`,
    });
    return {
      ok: true,
      message: `Approved. Finish checkout on ${source.name}, then mark it purchased.`,
    };
  }

  const adapter = getAdapter(source.id);
  if (!adapter?.placeOrder) {
    return { ok: false, message: `${source.name} can't place orders yet.` };
  }
  const result = await adapter.placeOrder(
    { externalId: listing.externalId, lots: plan.lots, expectedLotPriceCents: listing.lotPriceCents },
    { now, rng },
  );

  if (!result.ok) {
    db.update(listings)
      .set({ status: "expired", note: `Order failed: ${result.error}`, decidedBy: actor, decidedAt: now })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(db, {
      type: "order_failed",
      actor,
      listingId: listing.id,
      message: `${who} approved ${listing.title}, but the order failed: ${result.error}`,
    });
    return { ok: false, message: `The order didn't go through: ${result.error}.` };
  }

  const order = db
    .insert(orders)
    .values({
      listingId: listing.id,
      specId: spec.id,
      sourceId: source.id,
      lots: plan.lots,
      units: plan.units,
      subtotalCents: plan.subtotalCents,
      shippingCents: plan.shippingCents,
      totalCents: plan.totalCents,
      mode: "approved",
      placedBy: actor,
      externalRef: result.externalRef,
    })
    .returning({ id: orders.id })
    .get();

  db.update(listings)
    .set({
      status: "purchased",
      proposedLots: plan.lots,
      note: `Approved by ${who}`,
      decidedBy: actor,
      decidedAt: now,
    })
    .where(eq(listings.id, listing.id))
    .run();
  logEvent(db, {
    type: "purchased",
    actor,
    listingId: listing.id,
    orderId: order.id,
    message: `${who} approved ${plan.units} ${spec.name.toLowerCase()} for ${formatCents(plan.totalCents)} from ${source.name}`,
  });
  return { ok: true, message: `Ordered ${plan.units} ${spec.name.toLowerCase()} for ${formatCents(plan.totalCents)}.` };
}

export function rejectListing(db: DB, listingId: number, actor: Person): ActionResult {
  const listing = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) return { ok: false, message: "That listing no longer exists." };
  if (listing.status !== "pending" && listing.status !== "awaiting_checkout") {
    return { ok: false, message: "Someone already handled this listing." };
  }
  const who = actorLabel(actor);
  const wasCheckout = listing.status === "awaiting_checkout";
  db.update(listings)
    .set({
      status: "rejected",
      note: wasCheckout ? `${who} didn't complete checkout` : `Skipped by ${who}`,
      decidedBy: actor,
      decidedAt: new Date(),
    })
    .where(eq(listings.id, listing.id))
    .run();
  logEvent(db, {
    type: "rejected",
    actor,
    listingId: listing.id,
    message: wasCheckout ? `${who} didn't buy ${listing.title}` : `${who} skipped ${listing.title}`,
  });
  return { ok: true, message: wasCheckout ? "Marked as not bought." : "Skipped." };
}

/** The person finished checkout on a site without an ordering API. */
export function confirmCheckout(db: DB, listingId: number, actor: Person): ActionResult {
  const loaded = load(db, listingId);
  if (!loaded) return { ok: false, message: "That listing no longer exists." };
  const { listing, source, spec } = loaded;
  if (listing.status !== "awaiting_checkout") {
    return { ok: false, message: "This listing isn't waiting on checkout." };
  }
  const size = orderCost(listing, listing.proposedLots ?? 1);
  const who = actorLabel(actor);
  const now = new Date();

  const order = db
    .insert(orders)
    .values({
      listingId: listing.id,
      specId: spec.id,
      sourceId: source.id,
      lots: size.lots,
      units: size.units,
      subtotalCents: size.subtotalCents,
      shippingCents: size.shippingCents,
      totalCents: size.totalCents,
      mode: "manual_checkout",
      placedBy: actor,
    })
    .returning({ id: orders.id })
    .get();

  db.update(listings)
    .set({ status: "purchased", note: `${who} checked out on ${source.name}`, decidedBy: actor, decidedAt: now })
    .where(eq(listings.id, listing.id))
    .run();
  logEvent(db, {
    type: "purchased",
    actor,
    listingId: listing.id,
    orderId: order.id,
    message: `${who} bought ${size.units} ${spec.name.toLowerCase()} for ${formatCents(size.totalCents)} on ${source.name}`,
  });
  return { ok: true, message: `Recorded ${size.units} ${spec.name.toLowerCase()} for ${formatCents(size.totalCents)}.` };
}
