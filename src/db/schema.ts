import { sql } from "drizzle-orm";
import type { ListingIssue } from "@/lib/catalog";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * Money is always stored as integer cents. Timestamps are stored as epoch ms.
 * Enum-like columns are plain text; the allowed values live in src/lib/catalog.ts
 * and are enforced by zod at the edges (forms, adapters).
 */

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

/** What Nick wants to accumulate, and the most he'll pay per unit for it. */
export const specs = sqliteTable("specs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull(), // flat_sheet | fitted_sheet | pillowcase | ...
  size: text("size"), // null = any size (towels)
  color: text("color").notNull().default("white"),
  materials: text("materials", { mode: "json" }).$type<string[]>().notNull(),
  minThreadCount: integer("min_thread_count"),
  conditions: text("conditions", { mode: "json" }).$type<string[]>().notNull(),
  /** Landed cost per unit (item + shipping, divided by units). */
  maxUnitPriceCents: integer("max_unit_price_cents").notNull(),
  /** Par level: how many units they want on hand in total. */
  targetUnits: integer("target_units").notNull(),
  /** Hard ceiling on units in a single order for this spec. */
  maxUnitsPerOrder: integer("max_units_per_order").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

/** Where listings come from. Adapters in src/engine/sources implement each one. */
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(), // slug, matches the adapter id
  name: text("name").notNull(),
  kind: text("kind").notNull(), // wholesale | marketplace | retail
  /**
   * api: we can place the order programmatically (eBay Buy API, B2B portals).
   * checkout_link: a person must finish checkout on the site. Never automated.
   */
  purchaseMethod: text("purchase_method").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Only meaningful for api sources. Earned trust, flipped per source. */
  autoBuyAllowed: integer("auto_buy_allowed", { mode: "boolean" })
    .notNull()
    .default(false),
  notes: text("notes"),
});

export const listings = sqliteTable(
  "listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    /**
     * What the item is. Null means we couldn't tell (real listings are
     * described by a free-text title). A listing with anything unknown never
     * matches a spec; `parseIssues` says what was unclear.
     */
    category: text("category"),
    size: text("size"),
    color: text("color"),
    material: text("material"),
    threadCount: integer("thread_count"),
    condition: text("condition"),
    /** Price for one lot. */
    lotPriceCents: integer("lot_price_cents").notNull(),
    /** Units in one lot (a case of 12 sheets = 12). Null = a multi-pack of unknown count. */
    lotSize: integer("lot_size"),
    lotsAvailable: integer("lots_available").notNull(),
    /** Null = the source didn't say. Never treated as free shipping. */
    shippingCents: integer("shipping_cents"),
    /** Plain-words reasons the listing couldn't be read with confidence. */
    parseIssues: text("parse_issues", { mode: "json" }).$type<ListingIssue[]>(),
    /**
     * unmatched | pending | ordering | awaiting_checkout | purchased | rejected | blocked | expired
     *
     * `ordering` is a claim: someone (or the agent) is placing the order right
     * now. It and `awaiting_checkout` hold money against the weekly cap.
     */
    status: text("status").notNull(),
    matchedSpecId: integer("matched_spec_id").references(() => specs.id),
    /** Lots the agent proposes to buy if approved. */
    proposedLots: integer("proposed_lots"),
    /** Human-readable explanation of the last decision. */
    note: text("note"),
    decidedBy: text("decided_by"), // nick | jake | agent
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    /**
     * Set when an approved buy expired before anyone marked it bought. The
     * person may still have bought it, so "I bought it" stays available.
     */
    checkoutExpiredAt: integer("checkout_expired_at", { mode: "timestamp_ms" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("listings_source_external_uq").on(t.sourceId, t.externalId),
    index("listings_status_idx").on(t.status),
  ],
);

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listings.id),
  specId: integer("spec_id")
    .notNull()
    .references(() => specs.id),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  lots: integer("lots").notNull(),
  units: integer("units").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  mode: text("mode").notNull(), // auto | approved | manual_checkout
  placedBy: text("placed_by").notNull(), // nick | jake | agent
  externalRef: text("external_ref"),
  createdAt: createdAt(),
});

/** Single row (id = 1). */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  autoBuyEnabled: integer("auto_buy_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Pause all buying: nothing is purchased, auto or approved. Scans keep running. */
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  weeklyCapCents: integer("weekly_cap_cents").notNull(),
  perOrderCapCents: integer("per_order_cap_cents").notNull(),
  pendingExpiryMinutes: integer("pending_expiry_minutes").notNull(),
  /** How long an approved buy can wait on checkout before its hold on the weekly cap is released. */
  checkoutExpiryHours: integer("checkout_expiry_hours").notNull().default(24),
  scanIntervalSeconds: integer("scan_interval_seconds").notNull(),
  notifyPhone: text("notify_phone"),
  /** Where orders ship. Real sources use it to quote shipping. */
  shipToZip: text("ship_to_zip").notNull().default("37203"),
  /** Crude cross-process lock so the worker and the "Scan now" button never overlap. */
  scanLockUntil: integer("scan_lock_until", { mode: "timestamp_ms" }),
});

export const scanRuns = sqliteTable("scan_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger").notNull(), // manual | worker
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  sourcesChecked: integer("sources_checked").notNull().default(0),
  listingsSeen: integer("listings_seen").notNull().default(0),
  newListings: integer("new_listings").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  autoBought: integer("auto_bought").notNull().default(0),
  queued: integer("queued").notNull().default(0),
  blocked: integer("blocked").notNull().default(0),
  expired: integer("expired").notNull().default(0),
  errors: text("errors", { mode: "json" }).$type<string[]>(),
});

/** Human-readable activity feed. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    actor: text("actor").notNull(), // nick | jake | agent | system
    listingId: integer("listing_id"),
    orderId: integer("order_id"),
    createdAt: createdAt(),
  },
  (t) => [index("events_created_idx").on(t.createdAt)],
);

/** Mock outbox: texts/emails that would be sent in production. */
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channel: text("channel").notNull(), // sms | email
  recipient: text("recipient").notNull(), // nick | jake
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export type Spec = typeof specs.$inferSelect;
export type NewSpec = typeof specs.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type ScanRun = typeof scanRuns.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
