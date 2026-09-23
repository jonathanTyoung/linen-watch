import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Example data so the app is useful on first boot. Every spec here is a
 * placeholder until Nick gives us J&N's real list.
 */
export const SEED_SOURCES: (typeof schema.sources.$inferInsert)[] = [
  {
    id: "mock-wholesale",
    name: "Wholesale supplier (mock)",
    kind: "wholesale",
    purchaseMethod: "api",
    autoBuyAllowed: true,
    notes:
      "Stands in for a B2B linen supplier with an ordering API. Cases of new sheets and towels.",
  },
  {
    id: "mock-marketplace",
    name: "Marketplace, eBay-style (mock)",
    kind: "marketplace",
    purchaseMethod: "api",
    autoBuyAllowed: false,
    notes:
      "Stands in for eBay (Browse + Buy APIs). Mixed sellers, singles and bulk lots, prices swing.",
  },
  {
    id: "mock-liquidation",
    name: "Hotel liquidation lots (mock)",
    kind: "marketplace",
    purchaseMethod: "checkout_link",
    autoBuyAllowed: false,
    notes:
      "Stands in for hotel/hospitality liquidation sites. Big like-new lots, no ordering API.",
  },
  {
    id: "mock-retail",
    name: "Big-box retailer (mock)",
    kind: "retail",
    purchaseMethod: "checkout_link",
    autoBuyAllowed: false,
    notes:
      "Stands in for a retail site. Clearance deals show up, but checkout stays manual.",
  },
];

export const SEED_SPECS: (typeof schema.specs.$inferInsert)[] = [
  {
    name: "Queen flat sheets",
    category: "flat_sheet",
    size: "queen",
    color: "white",
    materials: ["percale", "sateen"],
    minThreadCount: 250,
    conditions: ["new"],
    maxUnitPriceCents: 950,
    targetUnits: 120,
    maxUnitsPerOrder: 48,
  },
  {
    name: "Queen fitted sheets",
    category: "fitted_sheet",
    size: "queen",
    color: "white",
    materials: ["percale", "sateen"],
    minThreadCount: 250,
    conditions: ["new"],
    maxUnitPriceCents: 1100,
    targetUnits: 120,
    maxUnitsPerOrder: 48,
  },
  {
    name: "King fitted sheets",
    category: "fitted_sheet",
    size: "king",
    color: "white",
    materials: ["percale", "sateen"],
    minThreadCount: 250,
    conditions: ["new"],
    maxUnitPriceCents: 1300,
    targetUnits: 60,
    maxUnitsPerOrder: 24,
  },
  {
    name: "King flat sheets",
    category: "flat_sheet",
    size: "king",
    color: "white",
    materials: ["percale"],
    minThreadCount: 250,
    conditions: ["new"],
    maxUnitPriceCents: 1200,
    targetUnits: 60,
    maxUnitsPerOrder: 24,
  },
  {
    name: "Standard pillowcases",
    category: "pillowcase",
    size: "standard",
    color: "white",
    materials: ["percale", "sateen", "poly_cotton"],
    minThreadCount: null,
    conditions: ["new", "like_new"],
    maxUnitPriceCents: 325,
    targetUnits: 240,
    maxUnitsPerOrder: 96,
  },
  {
    name: "Bath towels",
    category: "bath_towel",
    size: null,
    color: "white",
    materials: ["cotton_terry"],
    minThreadCount: null,
    conditions: ["new", "like_new"],
    maxUnitPriceCents: 600,
    targetUnits: 200,
    maxUnitsPerOrder: 60,
  },
];

export const DEFAULT_SETTINGS: typeof schema.settings.$inferInsert = {
  id: 1,
  autoBuyEnabled: false,
  paused: false,
  weeklyCapCents: 60000,
  perOrderCapCents: 30000,
  pendingExpiryMinutes: 180,
  scanIntervalSeconds: 45,
  notifyPhone: "(615) 555-0142",
};

export function seedIfEmpty(db: DB): void {
  const row = db.select({ n: sql<number>`count(*)` }).from(schema.settings).get();
  if (row && row.n > 0) return;

  db.transaction((tx) => {
    tx.insert(schema.settings).values(DEFAULT_SETTINGS).run();
    tx.insert(schema.sources).values(SEED_SOURCES).run();
    tx.insert(schema.specs).values(SEED_SPECS).run();
    tx.insert(schema.events)
      .values({
        type: "system",
        actor: "system",
        message:
          "Linen Watch set up with example specs and four mock sources. Run a scan to start finding linens.",
      })
      .run();
  });
}
