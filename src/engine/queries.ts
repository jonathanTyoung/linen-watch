import { desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { events, orders, settings, type Settings } from "@/db/schema";
import { startOfWeek } from "@/lib/time";

export function getSettings(db: DB): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) throw new Error("Settings row missing. Run `npm run db:reset`.");
  return row;
}

export function weekSpendCents(db: DB, now = new Date()): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${orders.totalCents}), 0)` })
    .from(orders)
    .where(gte(orders.createdAt, startOfWeek(now)))
    .get();
  return row?.total ?? 0;
}

/** Units bought so far, per spec id. */
export function unitsOwnedBySpec(db: DB): Map<number, number> {
  const rows = db
    .select({ specId: orders.specId, units: sql<number>`sum(${orders.units})` })
    .from(orders)
    .groupBy(orders.specId)
    .all();
  return new Map(rows.map((r) => [r.specId, r.units]));
}

export function unitsBoughtSince(db: DB, since: Date): number {
  const row = db
    .select({ units: sql<number>`coalesce(sum(${orders.units}), 0)` })
    .from(orders)
    .where(gte(orders.createdAt, since))
    .get();
  return row?.units ?? 0;
}

export function logEvent(
  db: DB,
  e: {
    type: string;
    message: string;
    actor: string;
    listingId?: number | null;
    orderId?: number | null;
  },
): void {
  db.insert(events)
    .values({
      type: e.type,
      message: e.message,
      actor: e.actor,
      listingId: e.listingId ?? null,
      orderId: e.orderId ?? null,
    })
    .run();
}

export function recentEvents(db: DB, limit = 20) {
  return db.select().from(events).orderBy(desc(events.createdAt), desc(events.id)).limit(limit).all();
}
