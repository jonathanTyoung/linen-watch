import { describe, expect, it } from "vitest";
import { findMatch, specFailures, type ListingLike, type SpecLike } from "./match";

const queenFlat: SpecLike = {
  id: 1,
  name: "Queen flat sheets",
  category: "flat_sheet",
  size: "queen",
  color: "white",
  materials: ["percale", "sateen"],
  minThreadCount: 250,
  conditions: ["new"],
  maxUnitPriceCents: 950,
  targetUnits: 120,
  active: true,
};

const towels: SpecLike = {
  id: 2,
  name: "Bath towels",
  category: "bath_towel",
  size: null,
  color: "white",
  materials: ["cotton_terry"],
  minThreadCount: null,
  conditions: ["new", "like_new"],
  maxUnitPriceCents: 600,
  targetUnits: 200,
  active: true,
};

// Case of 12 at $96 + $12 shipping = $9.00/unit landed.
const goodSheet: ListingLike = {
  category: "flat_sheet",
  size: "queen",
  color: "white",
  material: "percale",
  threadCount: 300,
  condition: "new",
  lotPriceCents: 9600,
  lotSize: 12,
  shippingCents: 1200,
};

describe("specFailures", () => {
  it("passes a listing that meets every rule", () => {
    expect(specFailures(goodSheet, queenFlat)).toEqual([]);
  });

  it("judges price on landed cost, shipping included", () => {
    // $108 + $12 = $10.00/unit, over $9.50.
    const f = specFailures({ ...goodSheet, lotPriceCents: 10800 }, queenFlat);
    expect(f).toEqual(["$10.00/unit is over the $9.50 limit"]);
  });

  it("fails a missing thread count when the spec sets a minimum", () => {
    expect(specFailures({ ...goodSheet, threadCount: null }, queenFlat)).toContain(
      "thread count isn't listed",
    );
  });

  it("reports every failure, not just the first", () => {
    const f = specFailures(
      { ...goodSheet, color: "gray", material: "microfiber", condition: "used" },
      queenFlat,
    );
    expect(f).toHaveLength(3);
  });
});

describe("findMatch", () => {
  const none = new Map<number, number>();

  it("matches the right spec", () => {
    const r = findMatch(goodSheet, [towels, queenFlat], none);
    expect(r.kind).toBe("match");
    if (r.kind === "match") expect(r.spec.id).toBe(1);
  });

  it("treats a spec with no size as any size", () => {
    const towel: ListingLike = {
      ...goodSheet,
      category: "bath_towel",
      size: null,
      material: "cotton_terry",
      threadCount: null,
      lotPriceCents: 6000,
      lotSize: 12,
      shippingCents: 0,
    };
    expect(findMatch(towel, [towels], none).kind).toBe("match");
  });

  it("explains a near miss using the closest spec", () => {
    const r = findMatch({ ...goodSheet, threadCount: 200 }, [queenFlat], none);
    expect(r).toEqual({ kind: "no_match", reason: "Close to Queen flat sheets, but 200 TC is under 250" });
  });

  it("says when nothing covers the item at all", () => {
    const r = findMatch({ ...goodSheet, size: "king" }, [queenFlat], none);
    expect(r).toEqual({ kind: "no_match", reason: "No active spec for king flat sheets" });
  });

  it("ignores inactive specs", () => {
    expect(findMatch(goodSheet, [{ ...queenFlat, active: false }], none).kind).toBe("no_match");
  });

  it("stops matching once a spec hits its target", () => {
    const r = findMatch(goodSheet, [queenFlat], new Map([[1, 120]]));
    expect(r).toEqual({ kind: "no_match", reason: "Queen flat sheets is fully stocked (120/120)" });
  });

  it("counts approved-but-unbought units toward the target", () => {
    const owned = new Map([[1, 96]]);
    expect(findMatch(goodSheet, [queenFlat], owned, new Map([[1, 12]])).kind).toBe("match");
    expect(findMatch(goodSheet, [queenFlat], owned, new Map([[1, 24]]))).toEqual({
      kind: "no_match",
      reason:
        "Queen flat sheets is fully stocked counting approved buys (96 bought + 24 approved but not bought yet, target 120)",
    });
  });
});
