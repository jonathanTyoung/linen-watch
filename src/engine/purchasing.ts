import { and, eq, inArray } from "drizzle-orm";
import type { DB, Queryable } from "@/db/client";
import { listings, orders, sources, specs, type Listing, type Source, type Spec } from "@/db/schema";
import { actorLabel, type Person } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { approvalBlocker, orderCost, planOrder, type OrderSize } from "./decide";
import { heldCents, interruptedNote, releaseStaleHolds } from "./holds";
import { getSettings, logEvent, unitsOwnedBySpec, weekSpendCents } from "./queries";
import { getAdapter, type OrderResult } from "./sources";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const HANDLED = "Someone already handled this listing.";

function load(db: Queryable, listingId: number) {
  const listing = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) return null;
  const source = db.select().from(sources).where(eq(sources.id, listing.sourceId)).get();
  const spec = listing.matchedSpecId
    ? db.select().from(specs).where(eq(specs.id, listing.matchedSpecId)).get()
    : undefined;
  if (!source || !spec) return null;
  return { listing, source, spec };
}

type Claim =
  | { ok: false; message: string }
  | { ok: true; listing: Listing; source: Source; spec: Spec; plan: OrderSize; manual: boolean };

/**
 * A person approves a queued listing. The order is re-sized and every
 * guardrail re-checked against current spend, because things may have
 * changed since the agent queued it.
 *
 * The check and the claim happen in one write transaction: the listing moves
 * out of `pending` and starts holding its total against the weekly cap before
 * anything slow happens. A second approval of the same listing finds it
 * already claimed, and an approval of a different listing sees the hold.
 */
export async function approveListing(
  db: DB,
  listingId: number,
  actor: Person,
  opts: { now?: Date; rng?: () => number } = {},
): Promise<ActionResult> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const who = actorLabel(actor);

  const claim = db.transaction((tx): Claim => {
    releaseStaleHolds(tx, now);

    const loaded = load(tx, listingId);
    if (!loaded) return { ok: false, message: "That listing no longer exists." };
    const { listing, source, spec } = loaded;
    if (listing.status !== "pending") return { ok: false, message: HANDLED };

    const settings = getSettings(tx);
    const weekSpend = weekSpendCents(tx, now);
    const held = heldCents(tx);
    const plan = planOrder({
      listing,
      spec,
      settings,
      unitsOwned: unitsOwnedBySpec(tx).get(spec.id) ?? 0,
      weekSpendCents: weekSpend,
      heldCents: held,
    });
    if (plan.kind === "blocked") return { ok: false, message: plan.note };

    const blocker = approvalBlocker({
      settings,
      weekSpendCents: weekSpend,
      heldCents: held,
      totalCents: plan.totalCents,
    });
    if (blocker) return { ok: false, message: blocker };

    const manual = source.purchaseMethod !== "api";
    if (!manual && !getAdapter(source.id)?.placeOrder) {
      return { ok: false, message: `${source.name} can't place orders yet.` };
    }

    const claimed = tx
      .update(listings)
      .set({
        status: manual ? "awaiting_checkout" : "ordering",
        proposedLots: plan.lots,
        note: manual
          ? `Approved by ${who}. Buy ${plan.lots} lot${plan.lots === 1 ? "" : "s"} on ${source.name}, then mark it purchased.`
          : `${who} is placing this order`,
        decidedBy: actor,
        decidedAt: now,
      })
      .where(and(eq(listings.id, listing.id), eq(listings.status, "pending")))
      .run().changes;
    if (claimed !== 1) return { ok: false, message: HANDLED };

    if (manual) {
      logEvent(tx, {
        type: "approved",
        actor,
        listingId: listing.id,
        message: `${who} approved ${listing.title}. Checkout on ${source.name} is manual.`,
      });
    }
    return { ok: true, listing, source, spec, plan, manual };
  }, { behavior: "immediate" });

  if (!claim.ok) return claim;
  const { listing, source, spec, plan } = claim;

  if (claim.manual) {
    return {
      ok: true,
      message: `Approved. Finish checkout on ${source.name}, then mark it purchased.`,
    };
  }

  const result = await placeClaimedOrder(source, {
    externalId: listing.externalId,
    lots: plan.lots,
    expectedLotPriceCents: listing.lotPriceCents,
    now,
    rng,
  });

  if (!result.ok) {
    // Leaving `ordering` releases the hold.
    db.transaction((tx) => {
      tx.update(listings)
        .set({ status: "expired", note: result.note, decidedBy: actor, decidedAt: now })
        .where(eq(listings.id, listing.id))
        .run();
      logEvent(tx, {
        type: "order_failed",
        actor,
        listingId: listing.id,
        message: `${who} approved ${listing.title}, but ${result.event}`,
      });
    });
    return { ok: false, message: result.message };
  }

  db.transaction((tx) => {
    const order = tx
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

    // The order is real whatever happened to the row meanwhile, so no status condition here.
    tx.update(listings)
      .set({
        status: "purchased",
        proposedLots: plan.lots,
        note: `Approved by ${who}`,
        decidedBy: actor,
        decidedAt: now,
      })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(tx, {
      type: "purchased",
      actor,
      listingId: listing.id,
      orderId: order.id,
      message: `${who} approved ${plan.units} ${spec.name.toLowerCase()} for ${formatCents(plan.totalCents)} from ${source.name}`,
    });
  });
  return { ok: true, message: `Ordered ${plan.units} ${spec.name.toLowerCase()} for ${formatCents(plan.totalCents)}.` };
}

export type PlacedOrder =
  | { ok: true; externalRef: string }
  /** `note` goes on the listing, `event` finishes an activity-feed sentence, `message` is shown to the person. */
  | { ok: false; note: string; event: string; message: string };

/**
 * Place the order for a listing that has already been claimed (`ordering`).
 * Shared by approvals and the scan's auto-buy. An adapter that throws leaves
 * us not knowing whether the order went through, and says so.
 */
export async function placeClaimedOrder(
  source: Pick<Source, "id" | "name">,
  req: { externalId: string; lots: number; expectedLotPriceCents: number; now: Date; rng: () => number },
): Promise<PlacedOrder> {
  const adapter = getAdapter(source.id);
  let result: OrderResult;
  try {
    if (!adapter?.placeOrder) throw new Error("no ordering API");
    result = await adapter.placeOrder(
      { externalId: req.externalId, lots: req.lots, expectedLotPriceCents: req.expectedLotPriceCents },
      { now: req.now, rng: req.rng },
    );
  } catch {
    const note = interruptedNote(source.name);
    return { ok: false, note, event: `the order was interrupted. ${note}.`, message: `${note}.` };
  }
  if (result.ok) return result;
  return {
    ok: false,
    note: `Order failed: ${result.error}`,
    event: `the order failed: ${result.error}`,
    message: `The order didn't go through: ${result.error}.`,
  };
}

export function rejectListing(db: DB, listingId: number, actor: Person): ActionResult {
  return db.transaction((tx): ActionResult => {
    const listing = tx.select().from(listings).where(eq(listings.id, listingId)).get();
    if (!listing) return { ok: false, message: "That listing no longer exists." };
    if (listing.status !== "pending" && listing.status !== "awaiting_checkout") {
      return { ok: false, message: HANDLED };
    }
    const who = actorLabel(actor);
    const wasCheckout = listing.status === "awaiting_checkout";
    // Leaving `awaiting_checkout` releases its hold on the weekly cap.
    const changed = tx
      .update(listings)
      .set({
        status: "rejected",
        note: wasCheckout ? `${who} didn't complete checkout` : `Skipped by ${who}`,
        decidedBy: actor,
        decidedAt: new Date(),
      })
      .where(and(eq(listings.id, listing.id), inArray(listings.status, ["pending", "awaiting_checkout"])))
      .run().changes;
    if (changed !== 1) return { ok: false, message: HANDLED };
    logEvent(tx, {
      type: "rejected",
      actor,
      listingId: listing.id,
      message: wasCheckout ? `${who} didn't buy ${listing.title}` : `${who} skipped ${listing.title}`,
    });
    return { ok: true, message: wasCheckout ? "Marked as not bought." : "Skipped." };
  }, { behavior: "immediate" });
}

/**
 * The person finished checkout on a site without an ordering API. The money
 * was already held against the weekly cap when they approved; this turns the
 * hold into an order for the same amount.
 */
export function confirmCheckout(db: DB, listingId: number, actor: Person): ActionResult {
  return db.transaction((tx): ActionResult => {
    const loaded = load(tx, listingId);
    if (!loaded) return { ok: false, message: "That listing no longer exists." };
    const { listing, source, spec } = loaded;
    if (listing.status !== "awaiting_checkout") {
      return { ok: false, message: "This listing isn't waiting on checkout." };
    }
    const size = orderCost(listing, listing.proposedLots ?? 1);
    const who = actorLabel(actor);

    const changed = tx
      .update(listings)
      .set({ status: "purchased", note: `${who} checked out on ${source.name}`, decidedBy: actor, decidedAt: new Date() })
      .where(and(eq(listings.id, listing.id), eq(listings.status, "awaiting_checkout")))
      .run().changes;
    if (changed !== 1) return { ok: false, message: "This listing isn't waiting on checkout." };

    const order = tx
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

    logEvent(tx, {
      type: "purchased",
      actor,
      listingId: listing.id,
      orderId: order.id,
      message: `${who} bought ${size.units} ${spec.name.toLowerCase()} for ${formatCents(size.totalCents)} on ${source.name}`,
    });
    return { ok: true, message: `Recorded ${size.units} ${spec.name.toLowerCase()} for ${formatCents(size.totalCents)}.` };
  }, { behavior: "immediate" });
}
