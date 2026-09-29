import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "@/db/client";
import { events, listings, notifications, orders, settings, sources } from "@/db/schema";
import { approveListing, confirmCheckout, rejectListing } from "./purchasing";
import { runScan } from "./scan";
import { fakeEbay, json, TEST_KEYS, type Override } from "./sources/ebay/__fixtures__/fake-ebay";
import emptySearch from "./sources/ebay/__fixtures__/search-empty.json";
import { seeded } from "./sources/mock";
import { sourceSelection, sourceStatus } from "./sources/selection";

/**
 * eBay end to end through the real scan, against saved responses. Nothing
 * here touches the network: `fetch` is replaced with a stand-in.
 */

let db: DB;
let ebay: ReturnType<typeof fakeEbay>;

function useEbay(opts: { sources?: string; keys?: boolean; override?: Override } = {}) {
  if (opts.sources) vi.stubEnv("LINEN_SOURCES", opts.sources);
  if (opts.keys !== false) for (const [k, v] of Object.entries(TEST_KEYS)) vi.stubEnv(k, v);
  ebay = fakeEbay(opts.override);
  vi.stubGlobal("fetch", ebay.fetch);
}

beforeEach(() => {
  db = openDb(":memory:");
  for (const k of ["LINEN_SOURCES", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_ENV"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const scan = (now?: Date) => runScan(db, { trigger: "manual", now, rng: seeded(3) });
const byItem = (legacyId: string) =>
  db.select().from(listings).where(eq(listings.externalId, `v1|${legacyId}|0`)).get();
const ebayRows = () => db.select().from(listings).where(eq(listings.sourceId, "ebay")).all();

describe("choosing sources", () => {
  it("reads LINEN_SOURCES, defaulting to mock", () => {
    expect(sourceSelection({})).toBe("mock");
    expect(sourceSelection({ LINEN_SOURCES: "ebay" })).toBe("ebay");
    expect(sourceSelection({ LINEN_SOURCES: " ALL " })).toBe("all");
    expect(sourceSelection({ LINEN_SOURCES: "everything" })).toBe("mock");
  });

  it("says in plain words why a source is off", () => {
    expect(sourceStatus("ebay", {})).toEqual({
      active: false,
      reason: expect.stringMatching(/LINEN_SOURCES is set to mock/),
    });
    expect(sourceStatus("ebay", { LINEN_SOURCES: "ebay" })).toEqual({
      active: false,
      reason: expect.stringMatching(/API keys are missing. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.local/),
    });
    expect(sourceStatus("ebay", { LINEN_SOURCES: "all", ...TEST_KEYS })).toEqual({ active: true });
    expect(sourceStatus("mock-retail", { LINEN_SOURCES: "ebay" }).active).toBe(false);
    expect(sourceStatus("mock-retail", { LINEN_SOURCES: "all" }).active).toBe(true);
  });

  it("every database has an eBay source row: manual checkout, never auto-buy", () => {
    expect(db.select().from(sources).where(eq(sources.id, "ebay")).get()).toMatchObject({
      name: "eBay",
      kind: "marketplace",
      purchaseMethod: "checkout_link",
      autoBuyAllowed: false,
    });
  });

  it("by default scans the mock sources and never calls eBay, even with keys present", async () => {
    useEbay();
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(4);
    expect(!r.skipped && r.errors).toEqual([]);
    expect(ebay.calls).toHaveLength(0);
    expect(ebayRows()).toHaveLength(0);
  });

  it("leaves eBay off, quietly, when the keys are missing", async () => {
    useEbay({ sources: "ebay", keys: false });
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(0);
    expect(!r.skipped && r.errors).toEqual([]);
    expect(ebay.calls).toHaveLength(0);
  });

  it("LINEN_SOURCES=ebay scans eBay alone", async () => {
    useEbay({ sources: "ebay" });
    const r = await scan();
    expect(r).toMatchObject({ sourcesChecked: 1, listingsSeen: 19, newListings: 19, errors: [] });
    expect(db.select().from(listings).all().every((l) => l.sourceId === "ebay")).toBe(true);
  });

  it("LINEN_SOURCES=all scans both", async () => {
    useEbay({ sources: "all" });
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(5);
    expect(ebayRows()).toHaveLength(19);
    expect(db.select().from(listings).all().some((l) => l.sourceId.startsWith("mock-"))).toBe(true);
  });

  it("respects the Scan switch in Settings", async () => {
    useEbay({ sources: "ebay" });
    db.update(sources).set({ enabled: false }).where(eq(sources.id, "ebay")).run();
    await scan();
    expect(ebay.calls).toHaveLength(0);
  });
});

describe("scanning eBay", () => {
  beforeEach(() => useEbay({ sources: "ebay" }));

  it("queues what matches", async () => {
    const r = await scan();
    expect(r).toMatchObject({ matched: 5, queued: 5, autoBought: 0, blocked: 0 });
    const queued = db.select().from(listings).where(eq(listings.status, "pending")).all();
    expect(queued.map((l) => l.externalId).sort()).toEqual([
      "v1|285600000101|0", // 12 queen flat sheets, $9.00 each landed
      "v1|285600000102|0", // one queen flat sheet, $8.49
      "v1|285600000201|0", // 2 sateen queen flat sheets, $8.50 each
      "v1|285600000301|0", // a dozen standard pillowcases, $2.75 each
      "v1|285600000401|0", // 24 bath towels, $5.33 each
    ]);
    expect(byItem("285600000101")).toMatchObject({ proposedLots: 1, note: "Auto-buy is off, so this waits for approval" });
  });

  it("never buys, even with auto-buy on and every source trusted", async () => {
    db.update(settings).set({ autoBuyEnabled: true, weeklyCapCents: 10_000_000, perOrderCapCents: 10_000_000 }).run();
    db.update(sources).set({ autoBuyAllowed: true }).run();
    const r = await scan();
    expect(r).toMatchObject({ matched: 5, queued: 5, autoBought: 0 });
    expect(db.select().from(orders).all()).toHaveLength(0);
    expect(byItem("285600000101")?.note).toBe("eBay needs a person to check out");
  });

  it("says why for everything that didn't match", async () => {
    await scan();
    const why = (legacyId: string) => byItem(legacyId)?.note;
    expect(why("285600000103")).toBe("Can't be sure it fits: it's a sheet set, not a single kind of item");
    expect(why("285600000104")).toBe("Close to Queen flat sheets, but poly-cotton blend isn't an accepted material");
    expect(why("285600000106")).toBe(
      "Can't be sure it fits: the listing covers several options (sizes or colors) and the price is for only one of them",
    );
    expect(why("285600000107")).toBe("Close to Queen flat sheets, but condition is like new");
    expect(why("285600000109")).toBe("Can't be sure it fits: it's sold for parts or not working");
    expect(why("285600000112")).toBe("Can't be sure it fits: the title lists more than one size (full, queen)");
    expect(why("285600000113")).toBe(
      "Can't be sure it fits: it looks like a multi-pack, but the count isn't in the title and shipping cost isn't listed",
    );
    expect(why("285600000202")).toBe("Can't be sure it fits: the title lists more than one color (white, gray)");
    expect(why("285600000303")).toBe("No active spec for king pillow pillowcases");
    expect(why("285600000402")).toBe("Can't be sure it fits: it says cotton, but not whether it's terry");
    expect(ebayRows().filter((l) => l.status === "unmatched").every((l) => l.note)).toBe(true);
  });

  it("never treats unknown shipping as free", async () => {
    await scan();
    // $30 for 4 is $7.50 each, under the $9.50 limit. With the $8.40 shipping
    // eBay gave on lookup it's $9.60, which isn't.
    expect(byItem("285600000105")).toMatchObject({
      status: "unmatched",
      shippingCents: 840,
      note: "Close to Queen flat sheets, but $9.60/unit is over the $9.50 limit",
    });
    // 12 towels for $38 would be a bargain, but eBay never gave a shipping cost.
    expect(byItem("285600000403")).toMatchObject({
      status: "unmatched",
      shippingCents: null,
      note: "Can't be sure it fits: shipping cost isn't listed",
    });
  });

  it("texts Nick one digest for the scan", async () => {
    await scan();
    const texts = db.select().from(notifications).all();
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toMatch(/5 finds need your OK/);
    expect(texts[0].body).toMatch(/Queen flat sheets: 12 @ \$9\.00\/unit \(\$108\.00\) from eBay/);
  });

  it("approve hands over the eBay page; I bought it records the order", async () => {
    await scan();
    const l = byItem("285600000101")!;
    const approved = await approveListing(db, l.id, "nick");
    expect(approved).toEqual({ ok: true, message: "Approved. Finish checkout on eBay, then mark it purchased." });
    expect(byItem("285600000101")).toMatchObject({
      status: "awaiting_checkout",
      url: "https://www.ebay.com/itm/285600000101",
      note: "Approved by Nick. Buy 1 lot on eBay, then mark it purchased.",
    });
    expect(db.select().from(orders).all()).toHaveLength(0);

    expect(confirmCheckout(db, l.id, "nick").ok).toBe(true);
    expect(db.select().from(orders).where(eq(orders.listingId, l.id)).get()).toMatchObject({
      sourceId: "ebay",
      mode: "manual_checkout",
      units: 12,
      totalCents: 10800,
      externalRef: null,
    });
  });

  it("stores nothing about sellers, anywhere", async () => {
    await scan();
    const everything = JSON.stringify({
      listings: db.select().from(listings).all(),
      events: db.select().from(events).all(),
      notifications: db.select().from(notifications).all(),
    });
    expect(everything).not.toMatch(/fixture_seller|feedback/i);
  });

  it("reports a failed search without losing the rest", async () => {
    useEbay({
      sources: "ebay",
      override: (call) =>
        call.url.searchParams.get("q") === "white bath towel" ? json({ errors: [{ message: "Bad category" }] }, 400) : undefined,
    });
    const r = await scan();
    expect(r).toMatchObject({ sourcesChecked: 1, listingsSeen: 16 });
    expect(!r.skipped && r.errors).toEqual([
      'eBay: Search "white bath towel": eBay said HTTP 400 (Bad category). Skipped for this scan.',
    ]);
  });
});

describe("keeping eBay data fresh", () => {
  const t0 = new Date(2026, 8, 16, 9, 0, 0);
  const later = (h: number) => new Date(t0.getTime() + h * 60 * 60 * 1000);
  /** eBay stops returning anything: every listing has sold or ended. */
  const gone: Override = (call) => (call.url.pathname.endsWith("/item_summary/search") ? json(emptySearch) : undefined);

  beforeEach(() => useEbay({ sources: "ebay" }));

  it("looks again when a listing changes, and only then", async () => {
    await scan(t0);
    const before = byItem("285600000107")!;
    expect(before.status).toBe("unmatched");

    await scan(later(1));
    expect(db.select().from(events).where(eq(events.type, "queued")).all()).toHaveLength(5); // nothing queued twice
    expect(byItem("285600000107")?.lastSeenAt).toEqual(later(1));
  });

  it("queues a listing whose price drops into range, with the approval clock starting then", async () => {
    // $8.40 shipping made this $9.60 a unit. The seller drops the price by $2.
    await scan(t0);
    expect(byItem("285600000105")?.status).toBe("unmatched");

    useEbay({
      sources: "ebay",
      override: async (call) => {
        if (call.url.searchParams.get("q") !== "white queen flat sheet" || call.url.searchParams.get("offset") !== "0") return undefined;
        const page = (await import("./sources/ebay/__fixtures__/search-sheets-page1.json")).default;
        return json({
          ...page,
          itemSummaries: page.itemSummaries.map((i) =>
            i.legacyItemId === "285600000105" ? { ...i, price: { value: "28.00", currency: "USD" } } : i,
          ),
        });
      },
    });
    await scan(later(5));
    expect(byItem("285600000105")).toMatchObject({ status: "pending", lotPriceCents: 2800, shippingCents: 840 });

    // First seen six hours ago, but only queued one hour ago: still waiting.
    await scan(later(6));
    expect(byItem("285600000105")?.status).toBe("pending");
    await scan(later(9));
    expect(byItem("285600000105")?.status).toBe("expired");
  });

  it("deletes listings that came to nothing once they've gone unseen for 24 hours", async () => {
    await scan(t0);
    const skipped = byItem("285600000102")!;
    rejectListing(db, skipped.id, "nick");
    expect(ebayRows()).toHaveLength(19);

    useEbay({ sources: "ebay", override: gone });
    const day1 = await scan(later(23));
    expect(!day1.skipped && day1.removed).toBe(0);
    expect(ebayRows()).toHaveLength(19);

    const day2 = await scan(later(25));
    expect(!day2.skipped && day2.removed).toBe(19);
    expect(ebayRows()).toHaveLength(0);
    // What was said about them goes too: activity entries quote listing titles.
    expect(db.select().from(events).all().some((e) => /Flat Sheet|Pillowcase|Bath Towel/i.test(e.message))).toBe(false);
  });

  it("keeps listings that are still showing up", async () => {
    await scan(t0);
    await scan(later(20));
    const r = await scan(later(30));
    expect(!r.skipped && r.removed).toBe(0);
    expect(ebayRows()).toHaveLength(19);
  });

  it("keeps anything tied to an order, and anything still waiting on a person", async () => {
    await scan(t0);
    const bought = byItem("285600000101")!;
    await approveListing(db, bought.id, "nick", { now: t0 });
    confirmCheckout(db, bought.id, "nick", { now: t0 });

    useEbay({ sources: "ebay", override: gone });
    await scan(later(25));
    expect(ebayRows().map((l) => [l.externalId, l.status])).toEqual([["v1|285600000101|0", "purchased"]]);
    expect(db.select().from(orders).all()).toHaveLength(1);
  });

  it("keeps an expired approval for a week, so a late I-bought-it can still be recorded", async () => {
    await scan(t0);
    const approved = byItem("285600000401")!;
    await approveListing(db, approved.id, "nick", { now: t0 });

    useEbay({ sources: "ebay", override: gone });
    await scan(later(25)); // the approval expires here
    expect(byItem("285600000401")).toMatchObject({ status: "expired" });
    expect(byItem("285600000401")?.checkoutExpiredAt).toEqual(later(25));

    await scan(later(25 + 6 * 24));
    expect(confirmCheckout(db, approved.id, "nick", { now: later(25 + 6 * 24) }).ok).toBe(true);
    expect(byItem("285600000401")?.status).toBe("purchased");
  });

  it("drops an expired approval nobody came back for", async () => {
    await scan(t0);
    const approved = byItem("285600000401")!;
    await approveListing(db, approved.id, "nick", { now: t0 });
    useEbay({ sources: "ebay", override: gone });
    await scan(later(25));
    await scan(later(25 + 8 * 24));
    expect(byItem("285600000401")).toBeUndefined();
  });

  it("never deletes mock listings", async () => {
    useEbay({ sources: "all" });
    await scan(t0);
    const mocks = db.select().from(listings).all().filter((l) => l.sourceId.startsWith("mock-")).length;
    expect(mocks).toBeGreaterThan(0);

    vi.stubEnv("LINEN_SOURCES", "ebay");
    useEbay({ sources: "ebay", override: gone });
    await scan(later(48));
    const left = db.select().from(listings).where(inArray(listings.sourceId, ["ebay"])).all();
    expect(left).toHaveLength(0);
    expect(db.select().from(listings).all().filter((l) => l.sourceId.startsWith("mock-")).length).toBe(mocks);
  });
});
