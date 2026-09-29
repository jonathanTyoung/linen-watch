import { describe, expect, it } from "vitest";
import { approvalBlocker, decide, planOrder, type DecideInput } from "./decide";

const base: DecideInput = {
  // Case of 12 at $96, $12 shipping per order, 5 cases available.
  listing: { lotPriceCents: 9600, lotSize: 12, lotsAvailable: 5, shippingCents: 1200 },
  spec: { name: "Queen flat sheets", targetUnits: 120, maxUnitsPerOrder: 48 },
  source: { name: "Wholesale", purchaseMethod: "api", autoBuyAllowed: true },
  settings: { autoBuyEnabled: true, paused: false, weeklyCapCents: 40000, perOrderCapCents: 50000 },
  unitsOwned: 0,
  weekSpendCents: 0,
};

const with_ = (patch: {
  listing?: Partial<DecideInput["listing"]>;
  spec?: Partial<DecideInput["spec"]>;
  source?: Partial<DecideInput["source"]>;
  settings?: Partial<DecideInput["settings"]>;
  unitsOwned?: number;
  unitsHeld?: number;
  weekSpendCents?: number;
  heldCents?: number;
}): DecideInput => ({
  ...base,
  ...patch,
  listing: { ...base.listing, ...patch.listing },
  spec: { ...base.spec, ...patch.spec },
  source: { ...base.source, ...patch.source },
  settings: { ...base.settings, ...patch.settings },
});

describe("planOrder", () => {
  it("fills up to the per-order unit limit", () => {
    const p = planOrder(base);
    expect(p).toMatchObject({ kind: "ok", lots: 4, units: 48, totalCents: 4 * 9600 + 1200 });
  });

  it("only buys what's still needed", () => {
    expect(planOrder(with_({ unitsOwned: 100 }))).toMatchObject({ lots: 1, units: 12 });
  });

  it("counts approved-but-unbought units as already on the way", () => {
    // Target 120: 60 bought + 36 approved leaves 24, so 2 lots of 12 rather than 4.
    expect(planOrder(with_({ unitsOwned: 60, unitsHeld: 36 }))).toMatchObject({ lots: 2, units: 24 });
  });

  it("blocks when bought and approved units already cover the target", () => {
    expect(planOrder(with_({ unitsOwned: 100, unitsHeld: 24 }))).toEqual({
      kind: "blocked",
      note: "Queen flat sheets is fully stocked counting approved buys (100 bought + 24 approved but not bought yet, target 120)",
    });
    expect(planOrder(with_({ unitsOwned: 120 }))).toEqual({
      kind: "blocked",
      note: "Queen flat sheets is fully stocked (120/120)",
    });
  });

  it("never buys more lots than are available", () => {
    expect(planOrder(with_({ listing: { lotsAvailable: 2 } }))).toMatchObject({ lots: 2 });
  });

  it("shrinks the order to fit the per-order dollar cap", () => {
    // 2 lots = $204, 3 lots = $300.
    expect(planOrder(with_({ settings: { perOrderCapCents: 25000 } }))).toMatchObject({ lots: 2 });
  });

  it("blocks when a single lot is over the per-order cap", () => {
    const p = planOrder(with_({ settings: { perOrderCapCents: 5000 } }));
    expect(p.kind).toBe("blocked");
  });

  it("blocks when one lot holds more units than a single order allows", () => {
    const p = planOrder(with_({ listing: { lotSize: 100 } }));
    expect(p).toEqual({
      kind: "blocked",
      note: "A lot of 100 is more than the 48-per-order limit for Queen flat sheets",
    });
  });

  it("shrinks to fit what's left of the weekly cap", () => {
    // $400 cap, $250 spent: $150 left fits 1 lot ($108) but not 2 ($204).
    expect(planOrder(with_({ weekSpendCents: 25000 }))).toMatchObject({ lots: 1, overWeeklyCap: false });
  });

  it("flags when even one lot would break the weekly cap", () => {
    expect(planOrder(with_({ weekSpendCents: 39000 }))).toMatchObject({ lots: 1, overWeeklyCap: true });
  });
});

describe("holds", () => {
  it("shrinks the order to fit what's left after holds", () => {
    // $400 cap, $100 spent, $100 held: $200 left fits 1 lot ($108), not 2 ($204).
    const plan = planOrder(with_({ weekSpendCents: 10000, heldCents: 10000 }));
    expect(plan).toMatchObject({ kind: "ok", lots: 1, overWeeklyCap: false });
  });

  it("queues instead of auto-buying when holds use up the cap", () => {
    const d = decide(with_({ weekSpendCents: 0, heldCents: 35000 }));
    expect(d).toMatchObject({ kind: "queue", overWeeklyCap: true });
    expect(d.note).toMatch(/already approved but not bought yet/);
  });
});

describe("decide", () => {
  it("auto-buys when every guardrail allows it", () => {
    expect(decide(base).kind).toBe("auto_buy");
  });

  it.each([
    ["auto-buy is off", { settings: { autoBuyEnabled: false } }, "Auto-buy is off"],
    ["buying is paused", { settings: { paused: true } }, "Buying is paused"],
    ["the source needs manual checkout", { source: { purchaseMethod: "checkout_link" } }, "needs a person to check out"],
    ["the source isn't trusted yet", { source: { autoBuyAllowed: false } }, "isn't turned on for Wholesale"],
    ["the weekly cap would break", { weekSpendCents: 39000 }, "over the $400.00 cap"],
  ])("queues when %s", (_label, patch, noteFragment) => {
    const d = decide(with_(patch as Parameters<typeof with_>[0]));
    expect(d.kind).toBe("queue");
    if (d.kind === "queue") expect(d.note).toContain(noteFragment);
  });

  it("pause wins over everything else", () => {
    const d = decide(with_({ settings: { paused: true }, weekSpendCents: 39000 }));
    expect(d.kind === "queue" && d.note).toBe("Buying is paused");
  });
});

describe("approvalBlocker", () => {
  const settings = base.settings;

  it("allows an order within caps", () => {
    expect(approvalBlocker({ settings, weekSpendCents: 0, totalCents: 10000 })).toBeNull();
  });

  it("refuses while paused", () => {
    expect(approvalBlocker({ settings: { ...settings, paused: true }, weekSpendCents: 0, totalCents: 100 })).toMatch(
      /paused/,
    );
  });

  it("refuses when the weekly cap would break", () => {
    expect(approvalBlocker({ settings, weekSpendCents: 35000, totalCents: 10000 })).toMatch(/over the \$400\.00 cap/);
  });

  it("counts money that's approved but not bought yet against the weekly cap", () => {
    expect(approvalBlocker({ settings, weekSpendCents: 10000, heldCents: 20000, totalCents: 10000 })).toBeNull();
    const msg = approvalBlocker({ settings, weekSpendCents: 10000, heldCents: 25000, totalCents: 10000 });
    expect(msg).toMatch(/\$450\.00/);
    expect(msg).toMatch(/\$250\.00 already approved but not bought yet/);
  });
});
