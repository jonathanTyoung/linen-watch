import { describe, expect, it } from "vitest";
import { parseCents, parseCondition, parseTitle, shippingCents, usdCents, type ParsedTitle } from "./parse";

type Expected = Partial<Omit<ParsedTitle, "issues">> & {
  /** Fields that must be flagged, each with a fragment of the reason. */
  unsure?: Partial<Record<"category" | "size" | "color" | "material" | "lotSize", RegExp>>;
};

/** Titles written the way eBay sellers write them. */
const CLEAN: [string, Expected][] = [
  [
    "White Queen Flat Sheet Percale 300TC Hotel Quality",
    { category: "flat_sheet", size: "queen", color: "white", material: "percale", threadCount: 300, lotSize: 1 },
  ],
  [
    "Lot of 12 White Queen Flat Sheets T-250 Percale Hotel Linen",
    { category: "flat_sheet", size: "queen", color: "white", material: "percale", threadCount: 250, lotSize: 12 },
  ],
  [
    "12 Pack King Fitted Sheets White Sateen 400 Thread Count Deep Pocket",
    { category: "fitted_sheet", size: "king", color: "white", material: "sateen", threadCount: 400, lotSize: 12 },
  ],
  [
    "White King Size Pillowcase Set of 2 Percale 300 TC",
    { category: "pillowcase", size: "king_pillow", color: "white", material: "percale", threadCount: 300, lotSize: 2 },
  ],
  [
    "Standard Pillowcases White T200 Poly Cotton Blend 1 Dozen",
    { category: "pillowcase", size: "standard", color: "white", material: "poly_cotton", threadCount: 200, lotSize: 12 },
  ],
  [
    "2 Dozen (24) White Bath Towels 24x50 Terry Cotton 10.5 lbs/dz",
    { category: "bath_towel", size: null, color: "white", material: "cotton_terry", threadCount: null, lotSize: 24 },
  ],
  [
    "King Size Pillowcase White Sateen Pair",
    { category: "pillowcase", size: "king_pillow", color: "white", material: "sateen", lotSize: 2 },
  ],
  [
    "Wholesale White Hand Towels 16x27 Terry 12 Pack",
    { category: "hand_towel", size: null, color: "white", material: "cotton_terry", lotSize: 12 },
  ],
  ["Ivory Queen Flat Sheet Percale 250TC", { category: "flat_sheet", color: "ivory", threadCount: 250 }],
  ["Off White King Fitted Sheet Sateen 300TC", { category: "fitted_sheet", size: "king", color: "ivory" }],
  ["Grey Full Size Flat Sheet Percale T250", { size: "full", color: "gray", threadCount: 250, lotSize: 1 }],
  ["Bright White Queen Flat Sheet Percale", { color: "white", material: "percale" }],
  [
    "White Queen Flat Sheet 60/40 Cotton Poly Percale T180",
    { category: "flat_sheet", material: "poly_cotton", threadCount: 180, lotSize: 1 },
  ],
  ["White Cotton Rich Queen Flat Sheet T200", { material: "poly_cotton", threadCount: 200 }],
  [
    "6 Pairs White Standard Pillowcases Percale T200 (12 pillowcases)",
    { category: "pillowcase", size: "standard", lotSize: 12 },
  ],
  ["TWO White King Pillowcases Percale", { category: "pillowcase", size: "king_pillow", lotSize: 2 }],
  ["White Queen Fitted Sheet Percale 300TC 12pk", { category: "fitted_sheet", lotSize: 12 }],
  ["White Queen Flat Sheets Percale 300TC Case of 24", { category: "flat_sheet", lotSize: 24 }],
  ["White Queen Flat Sheet Percale 250TC x12", { lotSize: 12 }],
  ["Half Dozen White Bath Towels Terry 27x54", { category: "bath_towel", lotSize: 6 }],
  ["White Duvet Cover King Sateen 400TC", { category: "duvet_cover", size: "king", material: "sateen" }],
  [
    "White King Flat Sheet Percale 108x110 300 Thread Count",
    { category: "flat_sheet", size: "king", threadCount: 300, lotSize: 1 },
  ],
  ["Microfiber Bath Towels White 4 Pack", { category: "bath_towel", material: "microfiber", lotSize: 4 }],
  [
    "1800 Series Queen Flat Sheet White Microfiber",
    { category: "flat_sheet", material: "microfiber", threadCount: null, lotSize: 1 },
  ],
  ["White Queen Fitted Sheet Non-Iron Percale 300TC", { category: "fitted_sheet", material: "percale" }],
  [
    "Queen Flat Sheet Standard Hotel Quality White Percale 250TC",
    { category: "flat_sheet", size: "queen", lotSize: 1 },
  ],
  [
    "24 New White Cotton Blend Hotel Bath Towels 24x50 Pool Gym",
    { category: "bath_towel", color: "white", material: "poly_cotton", lotSize: 24 },
  ],
  [
    "10 PACK WHITE HOTEL PILLOWCASES STANDARD SIZE T-180 PERCALE 20X30",
    { category: "pillowcase", size: "standard", material: "percale", threadCount: 180, lotSize: 10 },
  ],
  [
    "1 Dozen White King Size Hotel Pillow Cases Covers T200 Percale 20''x40''",
    { category: "pillowcase", size: "king_pillow", threadCount: 200, lotSize: 12 },
  ],
  [
    "Bath Towels White 100% Cotton Terry Cloth 27\"x54\" 6-Pack 650 GSM",
    { category: "bath_towel", material: "cotton_terry", lotSize: 6 },
  ],
  ["Hotel Pillowcases White Standard 42x36 T200 Percale 12/pk", { category: "pillowcase", lotSize: 12 }],
  ["Bath Towels Set of 4 White Terry", { category: "bath_towel", lotSize: 4 }],
  [
    "NEW Hotel Collection 680TC King Flat Sheet White 100% Supima Cotton Sateen",
    { category: "flat_sheet", size: "king", material: "sateen", threadCount: 680, lotSize: 1 },
  ],
  // The mock sources' own title format keeps working.
  [
    "White Percale Queen Flat Sheet, 300TC — Lot of 12 (Like New)",
    { category: "flat_sheet", size: "queen", color: "white", material: "percale", threadCount: 300, lotSize: 12 },
  ],
];

/** Titles that must NOT be read as something they might not be. */
const TRICKY: [string, Expected][] = [
  // "Sheet set" vs a single flat sheet.
  [
    "Queen Sheet Set 4 Piece White 1800 Series Microfiber Deep Pocket",
    { category: null, unsure: { category: /sheet set/ } },
  ],
  ["4 Piece Queen Bed Sheets Set White Sateen 400TC", { category: null, unsure: { category: /sheet set/ } }],
  ["Set of 6 White Queen Flat Sheets Percale 250TC", { category: "flat_sheet", size: "queen", lotSize: 6 }],
  ["White Queen Flat Sheet Set of 6 Percale", { category: "flat_sheet", lotSize: 6 }],
  [
    "White Flat Sheet Only Queen Percale (no fitted sheet)",
    { category: "flat_sheet", size: "queen", material: "percale", lotSize: 1 },
  ],
  ["White Queen Flat & Fitted Sheet Percale", { category: null, unsure: { category: /more than one kind/ } }],
  [
    "White Queen Flat Sheet and 2 Pillowcases Percale",
    { category: null, unsure: { category: /more than one kind of item \(flat sheet, pillowcase\)/ } },
  ],
  ["White Queen Sheet Percale 300TC", { category: null, unsure: { category: /flat or fitted/ } }],
  ["Hotel Bath Sheet White Terry 35x70", { category: null, unsure: { category: /bath sheet/ } }],
  ["White Washcloths 12x12 Terry 5 Dozen", { category: null, unsure: { category: /washcloth/ } }],
  ["King Pillow Shams White Percale Pair", { category: null, unsure: { category: /pillow sham/ } }],
  ["White Towel Set 6 Piece Bath Hand Washcloth Terry", { category: null, unsure: { category: /towel set/ } }],
  ["White Hotel Towels Terry Lot of 10", { category: null, unsure: { category: /what kind of towel/ } }],

  // Sizes.
  [
    "Fitted Sheet Fits Queen/Full White Percale",
    { category: "fitted_sheet", size: null, unsure: { size: /more than one size \(full, queen\)/ } },
  ],
  [
    "California King Fitted Sheet White Percale 400TC",
    { size: null, unsure: { size: /California king isn't a size we track/ } },
  ],
  ["Twin XL Flat Sheet White Percale T200", { size: null, unsure: { size: /twin XL/ } }],
  ["King / Cal King Flat Sheet White Percale", { size: null, unsure: { size: /more than one size/ } }],
  ["White Flat Sheet Percale 300TC", { size: null, unsure: { size: /size isn't in the title/ } }],
  [
    "Queen Pillowcases White Percale Set of 2",
    { category: "pillowcase", size: null, unsure: { size: /queen isn't a pillowcase size/ } },
  ],
  [
    "Standard/Queen Pillowcases White Percale 2 Pack",
    { category: "pillowcase", size: null, lotSize: 2, unsure: { size: /more than one size/ } },
  ],

  // Colors.
  [
    "Gray/White Striped Queen Flat Sheet Percale",
    { color: null, unsure: { color: /more than one color \(white, gray\)/ } },
  ],
  ["White with Blue Stripe Bath Towels Terry", { color: null, unsure: { color: /more than one color/ } }],
  ["Blue Queen Flat Sheet Percale 300TC", { color: null, unsure: { color: /it's blue, not a color we track/ } }],
  ["Queen Flat Sheet Percale 300TC", { color: null, unsure: { color: /color isn't in the title/ } }],
  ["Assorted Colors Queen Flat Sheets Percale Lot of 10", { color: null, unsure: { color: /assorted|color/ } }],

  // Materials.
  [
    "Queen Flat Sheet White NOT Percale",
    { category: "flat_sheet", material: null, unsure: { material: /says it's not percale/ } },
  ],
  ["White Queen Flat Sheet NOT Percale Soft Microfiber", { material: "microfiber" }],
  [
    "Flat Sheet Queen White 100% Cotton 200 Thread Count",
    { material: null, threadCount: 200, lotSize: 1, unsure: { material: /percale or sateen/ } },
  ],
  [
    "White Bath Towel 27x54 100% Cotton",
    { category: "bath_towel", material: null, lotSize: 1, unsure: { material: /whether it's terry/ } },
  ],
  ["White Bamboo Queen Flat Sheet", { material: null, unsure: { material: /bamboo/ } }],
  ["White Satin Pillowcase Standard", { material: null, unsure: { material: /satin/ } }],
  ["White 100% Polyester Queen Flat Sheet", { material: null, unsure: { material: /polyester/ } }],
  ["White Waffle Bath Towels Cotton 6 Pack", { material: null, unsure: { material: /waffle/ } }],
  ["White Queen Flat Sheet 300TC", { material: null, unsure: { material: /material isn't in the title/ } }],
  [
    "Queen Flat Sheet White 400TC Percale / 600TC Sateen",
    { material: null, threadCount: null, unsure: { material: /more than one material \(percale, sateen\)/ } },
  ],

  // A blend is a blend however it's written, even when the weave is named too.
  [
    "6 White Hotel Flat Sheets Queen 90x110 T250 Percale 60% Cotton 40% Poly",
    { category: "flat_sheet", material: "poly_cotton", threadCount: 250, lotSize: 6 },
  ],
  ["White Pillowcases Standard Size 200TC 50/50 Cotton/Polyester Dozen", { material: "poly_cotton", lotSize: 12 }],
  ["White Queen Flat Sheet Polyester Cotton Sateen 300TC", { material: "poly_cotton" }],

  // Lot sizes.
  [
    "Bulk Lot White Bath Towels Hotel Terry",
    { category: "bath_towel", lotSize: null, unsure: { lotSize: /multi-pack/ } },
  ],
  ["Wholesale White Queen Flat Sheets Percale T200", { lotSize: null, unsure: { lotSize: /multi-pack/ } }],
  [
    "Lot of 12 (2 Packs of 6) White Bath Towels Terry",
    { lotSize: null, unsure: { lotSize: /more than one count \(12, 6\)/ } },
  ],
  ["White Standard Pillowcase Set Percale", { lotSize: null, unsure: { lotSize: /multi-pack/ } }],
  // A plural on its own isn't a count. Reading it as one unit can only make
  // the price per unit look worse, never better.
  ["White Queen Flat Sheets Percale 300TC", { category: "flat_sheet", lotSize: 1 }],
  // Measurements are not counts.
  ["White Bath Towels 24x48 600 GSM Terry 16 lb", { category: "bath_towel", lotSize: 1 }],
];

function check(title: string, want: Expected) {
  const got = parseTitle(title);
  const { unsure = {}, ...fields } = want;
  expect(got, title).toMatchObject(fields);
  for (const [field, reason] of Object.entries(unsure)) {
    const issue = got.issues.find((i) => i.field === field);
    expect(issue?.reason ?? `(no ${field} issue)`, title).toMatch(reason);
  }
}

describe("parseTitle", () => {
  it(`has at least 30 cases (${CLEAN.length + TRICKY.length})`, () => {
    expect(CLEAN.length + TRICKY.length).toBeGreaterThanOrEqual(30);
  });

  describe("reads clear titles", () => {
    it.each(CLEAN)("%s", (title, want) => {
      check(title, want);
      // A clear title leaves nothing flagged that we checked a value for.
      const flagged = parseTitle(title).issues.map((i) => i.field);
      for (const key of Object.keys(want)) {
        if (key !== "threadCount") expect(flagged, title).not.toContain(key);
      }
    });
  });

  describe("refuses to guess on tricky ones", () => {
    it.each(TRICKY)("%s", (title, want) => check(title, want));
  });

  it("never leaves an unknown unexplained", () => {
    for (const [title] of [...CLEAN, ...TRICKY]) {
      const got = parseTitle(title);
      const flagged = new Set(got.issues.map((i) => i.field));
      if (got.category == null) expect(flagged.has("category"), title).toBe(true);
      if (got.color == null) expect(flagged.has("color"), title).toBe(true);
      if (got.material == null) expect(flagged.has("material"), title).toBe(true);
      if (got.lotSize == null) expect(flagged.has("lotSize"), title).toBe(true);
    }
  });
});

describe("structured fields", () => {
  it("reads prices without floating point", () => {
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents("0.99")).toBe(99);
    expect(parseCents("1234")).toBe(123400);
    expect(parseCents("19.999")).toBe(1999);
    expect(parseCents("64.10")).toBe(6410);
    expect(parseCents("")).toBeNull();
    expect(parseCents("free")).toBeNull();
    expect(parseCents("-5.00")).toBeNull();
  });

  it("only accepts prices listed in US dollars", () => {
    expect(usdCents({ value: "10.00", currency: "USD" })).toBe(1000);
    expect(usdCents({ value: "10.00", currency: "CAD" })).toBeNull();
    expect(usdCents({ value: "7.31", currency: "USD", convertedFromCurrency: "CAD", convertedFromValue: "10.00" })).toBeNull();
    expect(usdCents(undefined)).toBeNull();
  });

  it("takes the cheapest shipping option, and free shipping is a real zero", () => {
    expect(
      shippingCents([
        { shippingCostType: "FIXED", shippingCost: { value: "12.95", currency: "USD" } },
        { shippingCostType: "FIXED", shippingCost: { value: "8.40", currency: "USD" } },
      ]),
    ).toBe(840);
    expect(shippingCents([{ shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "USD" } }])).toBe(0);
  });

  it("treats missing shipping as unknown, never as free", () => {
    expect(shippingCents(undefined)).toBeNull();
    expect(shippingCents([])).toBeNull();
    expect(shippingCents([{ shippingCostType: "CALCULATED" }])).toBeNull();
  });

  it("maps eBay conditions the way Nick decided", () => {
    const of = (id?: string) => parseCondition(id).condition;
    expect(of("1000")).toBe("new");
    expect(of("1500")).toBe("like_new"); // "New other" can be a factory second
    expect(of("2750")).toBe("like_new");
    for (const id of ["1750", "2000", "2010", "2020", "2030", "2500", "3000", "4000", "5000", "6000"]) {
      expect(of(id), id).toBe("used");
    }
    expect(parseCondition("7000")).toEqual({
      condition: null,
      issue: { field: "condition", reason: "it's sold for parts or not working" },
    });
    expect(parseCondition(undefined).issue?.reason).toMatch(/isn't given/);
    expect(parseCondition("9999").issue?.reason).toMatch(/9999/);
  });
});
