import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import {
  listings,
  notifications,
  orders,
  scanRuns,
  sources,
  specs,
  type Listing,
  type Source,
  type Spec,
} from "@/db/schema";
import { orderCost } from "@/engine/decide";
import { heldCents } from "@/engine/holds";
import {
  getSettings,
  recentEvents,
  unitsBoughtSince,
  unitsOwnedBySpec,
  weekSpendCents,
} from "@/engine/queries";
import type { ListingStatus } from "@/lib/catalog";
import { landedUnitCents } from "@/lib/money";
import { startOfWeek } from "@/lib/time";

/**
 * Read-side for the pages. better-sqlite3 is synchronous, so every loader
 * awaits connection() first; otherwise Next would run these at build time and
 * bake the results into static pages.
 */

export interface ListingView extends Listing {
  source: Source;
  spec: Spec | null;
  unitCents: number;
  proposal: { lots: number; units: number; totalCents: number } | null;
}

function toView(rows: Listing[], sourceMap: Map<string, Source>, specMap: Map<number, Spec>): ListingView[] {
  return rows.map((l) => ({
    ...l,
    source: sourceMap.get(l.sourceId)!,
    spec: l.matchedSpecId ? (specMap.get(l.matchedSpecId) ?? null) : null,
    unitCents: landedUnitCents(l.lotPriceCents, l.lotSize, l.shippingCents),
    proposal: l.proposedLots ? orderCost(l, l.proposedLots) : null,
  }));
}

function lookups() {
  const db = getDb();
  const sourceMap = new Map(db.select().from(sources).all().map((s) => [s.id, s]));
  const specMap = new Map(db.select().from(specs).all().map((s) => [s.id, s]));
  return { sourceMap, specMap };
}

export async function loadDashboard() {
  await connection();
  const db = getDb();
  const now = new Date();
  const settings = getSettings(db);
  const { sourceMap, specMap } = lookups();

  const pendingRows = db
    .select()
    .from(listings)
    .where(inArray(listings.status, ["pending", "awaiting_checkout"]))
    .orderBy(desc(listings.firstSeenAt), desc(listings.id))
    .all();

  const lastScan = db.select().from(scanRuns).orderBy(desc(scanRuns.startedAt)).limit(1).get();
  const lastWorkerScan = db
    .select()
    .from(scanRuns)
    .where(eq(scanRuns.trigger, "worker"))
    .orderBy(desc(scanRuns.startedAt))
    .limit(1)
    .get();
  const workerAlive =
    !!lastWorkerScan &&
    now.getTime() - lastWorkerScan.startedAt.getTime() < settings.scanIntervalSeconds * 1000 * 2.5 + 10_000;

  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const seen24h =
    db
      .select({ n: sql<number>`coalesce(sum(${scanRuns.listingsSeen}), 0)` })
      .from(scanRuns)
      .where(gte(scanRuns.startedAt, since24h))
      .get()?.n ?? 0;

  const weekStart = startOfWeek(now);
  const owned = unitsOwnedBySpec(db);
  const stock = [...specMap.values()]
    .filter((s) => s.active)
    .map((s) => ({ spec: s, owned: owned.get(s.id) ?? 0 }));

  return {
    settings,
    needsCall: toView(pendingRows, sourceMap, specMap),
    lastScan,
    workerAlive,
    seen24h,
    weekSpendCents: weekSpendCents(db, now),
    heldCents: heldCents(db),
    weekUnits: unitsBoughtSince(db, weekStart),
    stock,
    events: recentEvents(db, 14),
    texts: db.select().from(notifications).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(4).all(),
  };
}

const QUEUE_STATUSES: ListingStatus[] = [
  "pending",
  "awaiting_checkout",
  "purchased",
  "blocked",
  "rejected",
  "expired",
  "unmatched",
];

export async function loadQueue(status: ListingStatus) {
  await connection();
  const db = getDb();
  const { sourceMap, specMap } = lookups();

  const countRows = db
    .select({ status: listings.status, n: sql<number>`count(*)` })
    .from(listings)
    .groupBy(listings.status)
    .all();
  const counts = Object.fromEntries(QUEUE_STATUSES.map((s) => [s, 0])) as Record<ListingStatus, number>;
  for (const r of countRows) counts[r.status as ListingStatus] = r.n;

  const rows = db
    .select()
    .from(listings)
    .where(eq(listings.status, status))
    .orderBy(desc(listings.lastSeenAt), desc(listings.id))
    .limit(status === "unmatched" ? 150 : 100)
    .all();

  return { statuses: QUEUE_STATUSES, counts, items: toView(rows, sourceMap, specMap) };
}

export async function loadSpecs() {
  await connection();
  const db = getDb();
  const owned = unitsOwnedBySpec(db);
  const pending = db
    .select({ specId: listings.matchedSpecId, n: sql<number>`count(*)` })
    .from(listings)
    .where(eq(listings.status, "pending"))
    .groupBy(listings.matchedSpecId)
    .all();
  const pendingBySpec = new Map(pending.map((p) => [p.specId, p.n]));
  return db
    .select()
    .from(specs)
    .orderBy(desc(specs.active), specs.id)
    .all()
    .map((s) => ({ spec: s, owned: owned.get(s.id) ?? 0, pending: pendingBySpec.get(s.id) ?? 0 }));
}

export async function loadSpec(id: number) {
  await connection();
  return getDb().select().from(specs).where(eq(specs.id, id)).get() ?? null;
}

export async function loadOrders() {
  await connection();
  const db = getDb();
  const { sourceMap, specMap } = lookups();
  const rows = db.select().from(orders).orderBy(desc(orders.createdAt), desc(orders.id)).all();
  const listingRows = rows.length
    ? db.select().from(listings).where(inArray(listings.id, rows.map((r) => r.listingId))).all()
    : [];
  const listingMap = new Map(listingRows.map((l) => [l.id, l]));
  const now = new Date();
  return {
    orders: rows.map((o) => ({
      ...o,
      source: sourceMap.get(o.sourceId)!,
      spec: specMap.get(o.specId)!,
      listing: listingMap.get(o.listingId)!,
    })),
    weekSpendCents: weekSpendCents(db, now),
    weekUnits: unitsBoughtSince(db, startOfWeek(now)),
  };
}

export async function loadSettings() {
  await connection();
  const db = getDb();
  return {
    settings: getSettings(db),
    sources: db.select().from(sources).all(),
  };
}
