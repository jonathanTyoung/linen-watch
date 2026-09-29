import { and, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { events, listings, orders } from "@/db/schema";
import { EBAY_SOURCE_ID } from "./sources/selection";

/** Sources whose listing data we only keep while it's fresh. */
const FRESHNESS_SOURCES = [EBAY_SOURCE_ID];

/** Listings nobody acted on are dropped once they've gone unseen this long. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * An approved buy that expired unbought can still be marked bought, so it's
 * kept this long after expiring before it's dropped like the rest.
 */
export const LATE_CHECKOUT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const DROPPABLE = ["unmatched", "expired", "rejected"];

/**
 * Delete listing data from real marketplaces that has gone stale: rows that
 * came to nothing (not a match, expired, skipped) and haven't shown up in a
 * search for 24 hours. Anything tied to an order is kept. Activity entries
 * about a deleted listing go with it, since they quote its title.
 * Returns how many listings were removed.
 */
export function removeStaleListings(db: Queryable, now: Date): number {
  const ordered = db.select({ id: orders.listingId }).from(orders);
  const stale = db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        inArray(listings.sourceId, FRESHNESS_SOURCES),
        inArray(listings.status, DROPPABLE),
        lt(listings.lastSeenAt, new Date(now.getTime() - STALE_AFTER_MS)),
        notInArray(listings.id, ordered),
        or(
          isNull(listings.checkoutExpiredAt),
          lt(listings.checkoutExpiredAt, new Date(now.getTime() - LATE_CHECKOUT_KEEP_MS)),
        ),
      ),
    )
    .all()
    .map((r) => r.id);

  // Stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < stale.length; i += 500) {
    const ids = stale.slice(i, i + 500);
    db.delete(events).where(inArray(events.listingId, ids)).run();
    db.delete(listings).where(inArray(listings.id, ids)).run();
  }
  return stale.length;
}
