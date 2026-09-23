import {
  CATEGORIES,
  SIZES,
  SIZES_BY_CATEGORY,
  type Category,
  type Color,
  type Condition,
  type Material,
  type Size,
} from "@/lib/catalog";
import type { FetchContext, RawListing, SourceAdapter } from "./types";

/**
 * Mock sources. Each one has a fixed pool of listing ids, and a listing's
 * attributes are derived deterministically from its id, so the same listing
 * shows up again on later scans (like a real site) while its price drifts a
 * little over time. Which listings are "visible" on a given scan is random.
 */

type Weighted<T> = [T, number][];

interface Profile {
  id: string;
  poolSize: number;
  perScan: [min: number, max: number];
  categories: Weighted<Category>;
  colors: Weighted<Color>;
  conditions: Weighted<Condition>;
  lotSizes: (category: Category) => number[];
  priceFactor: [min: number, max: number];
  /** Chance a listing is a clearance deal priced well below market. */
  clearanceChance: number;
  shippingCents: [min: number, max: number];
  lotsAvailable: [min: number, max: number];
  orderFailureRate: number;
}

/** Rough market price per unit, in cents, for new white cotton percale. */
const REFERENCE_UNIT_CENTS: Record<Category, Partial<Record<Size, number>> & { any?: number }> = {
  flat_sheet: { twin: 700, full: 800, queen: 900, king: 1100 },
  fitted_sheet: { twin: 850, full: 950, queen: 1050, king: 1250 },
  duvet_cover: { twin: 1600, full: 1900, queen: 2200, king: 2600 },
  pillowcase: { standard: 280, king_pillow: 330 },
  bath_towel: { any: 560 },
  hand_towel: { any: 250 },
};

const MATERIAL_FACTOR: Record<Material, number> = {
  percale: 1,
  sateen: 1.1,
  cotton_terry: 1,
  poly_cotton: 0.8,
  microfiber: 0.6,
};

const CONDITION_FACTOR: Record<Condition, number> = {
  new: 1,
  like_new: 0.7,
  used: 0.45,
};

const PROFILES: Profile[] = [
  {
    id: "mock-wholesale",
    poolSize: 40,
    perScan: [3, 6],
    categories: [
      ["flat_sheet", 3],
      ["fitted_sheet", 3],
      ["pillowcase", 3],
      ["bath_towel", 2],
      ["hand_towel", 1],
    ],
    colors: [
      ["white", 9],
      ["ivory", 1],
    ],
    conditions: [["new", 1]],
    lotSizes: (c) => (c === "pillowcase" ? [24, 48] : [12, 24]),
    priceFactor: [0.7, 1.05],
    clearanceChance: 0.05,
    shippingCents: [800, 2000],
    lotsAvailable: [2, 10],
    orderFailureRate: 0.04,
  },
  {
    id: "mock-marketplace",
    poolSize: 80,
    perScan: [4, 8],
    categories: [
      ["flat_sheet", 3],
      ["fitted_sheet", 3],
      ["pillowcase", 2],
      ["duvet_cover", 1],
      ["bath_towel", 2],
    ],
    colors: [
      ["white", 7],
      ["ivory", 2],
      ["gray", 1],
    ],
    conditions: [
      ["new", 6],
      ["like_new", 3],
      ["used", 1],
    ],
    lotSizes: () => [1, 2, 4, 6, 12],
    priceFactor: [0.55, 1.35],
    clearanceChance: 0.1,
    shippingCents: [0, 1200],
    lotsAvailable: [1, 3],
    orderFailureRate: 0.12,
  },
  {
    id: "mock-liquidation",
    poolSize: 25,
    perScan: [1, 3],
    categories: [
      ["flat_sheet", 2],
      ["fitted_sheet", 2],
      ["pillowcase", 2],
      ["bath_towel", 3],
    ],
    colors: [["white", 1]],
    conditions: [
      ["like_new", 7],
      ["used", 3],
    ],
    lotSizes: (c) => (c === "pillowcase" ? [50, 100] : [24, 50]),
    priceFactor: [0.35, 0.8],
    clearanceChance: 0,
    shippingCents: [4000, 9000],
    lotsAvailable: [1, 1],
    orderFailureRate: 0,
  },
  {
    id: "mock-retail",
    poolSize: 30,
    perScan: [2, 4],
    categories: [
      ["flat_sheet", 2],
      ["fitted_sheet", 2],
      ["pillowcase", 2],
      ["bath_towel", 2],
      ["hand_towel", 1],
    ],
    colors: [
      ["white", 6],
      ["gray", 2],
      ["ivory", 1],
    ],
    conditions: [["new", 1]],
    lotSizes: (c) => (c === "pillowcase" ? [2] : c.endsWith("towel") ? [1, 4] : [1]),
    priceFactor: [1.0, 1.6],
    clearanceChance: 0.18,
    shippingCents: [0, 0],
    lotsAvailable: [5, 20],
    orderFailureRate: 0,
  },
];

// ---------- deterministic randomness ----------

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: Weighted<T>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

function pickOne<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function between(rng: () => number, [min, max]: [number, number]): number {
  return min + rng() * (max - min);
}

function intBetween(rng: () => number, [min, max]: [number, number]): number {
  return Math.floor(min + rng() * (max - min + 1));
}

// ---------- listing generation ----------

function materialFor(rng: () => number, category: Category): Material {
  if (category === "bath_towel" || category === "hand_towel") {
    return rng() < 0.85 ? "cotton_terry" : "microfiber";
  }
  return pick<Material>(rng, [
    ["percale", 5],
    ["sateen", 3],
    ["poly_cotton", 2],
    ["microfiber", 2],
  ]);
}

function threadCountFor(rng: () => number, category: Category, material: Material): number | null {
  if (category === "bath_towel" || category === "hand_towel") return null;
  if (material === "microfiber") return null;
  if (rng() < 0.12) return null; // seller didn't list it
  return pickOne(rng, [180, 200, 250, 300, 300, 400, 600]);
}

const TITLE_MATERIAL: Record<Material, string> = {
  percale: "Percale",
  sateen: "Sateen",
  cotton_terry: "Terry",
  poly_cotton: "Poly-Cotton",
  microfiber: "Microfiber",
};

/** Airbnb inventory skews queen and king; listings should too. */
const SIZE_WEIGHT: Partial<Record<Size, number>> = {
  queen: 5,
  king: 3,
  full: 1,
  twin: 1,
  standard: 3,
  king_pillow: 1,
};

function titleFor(l: Omit<RawListing, "title" | "url" | "externalId">): string {
  const color = l.color[0].toUpperCase() + l.color.slice(1);
  const size = l.size ? `${SIZES[l.size]} ` : "";
  const material = TITLE_MATERIAL[l.material];
  const tc = l.threadCount ? `, ${l.threadCount}TC` : "";
  const lot =
    l.lotSize === 1
      ? ""
      : l.category === "pillowcase" && l.lotSize === 2
        ? " — Pair"
        : ` — Lot of ${l.lotSize}`;
  const cond = l.condition === "new" ? "" : l.condition === "like_new" ? " (Like New)" : " (Used)";
  const item = CATEGORIES[l.category].replace(/\b\w/g, (c) => c.toUpperCase());
  return `${color} ${material} ${size}${item}${tc}${lot}${cond}`;
}

/** The fixed attributes of listing `n` at `profile`. Same inputs, same listing. */
export function listingFromPool(profile: Profile, n: number, now: Date): RawListing {
  const externalId = `${profile.id.replace("mock-", "")}-${String(n).padStart(4, "0")}`;
  const rng = seeded(hash(externalId));

  const category = pick(rng, profile.categories);
  const sizes = SIZES_BY_CATEGORY[category];
  const size = sizes.length ? pick(rng, sizes.map((z) => [z, SIZE_WEIGHT[z] ?? 1] as [Size, number])) : null;
  const color = pick(rng, profile.colors);
  const material = materialFor(rng, category);
  const threadCount = threadCountFor(rng, category, material);
  const condition = pick(rng, profile.conditions);
  const lotSize = pickOne(rng, profile.lotSizes(category));

  const ref = REFERENCE_UNIT_CENTS[category];
  const baseUnit = (size ? ref[size] : ref.any) ?? 500;
  const clearance = rng() < profile.clearanceChance;
  const factor = clearance ? between(rng, [0.5, 0.7]) : between(rng, profile.priceFactor);
  const tcFactor = threadCount && threadCount >= 400 ? 1.15 : threadCount && threadCount < 250 ? 0.9 : 1;

  // Prices drift a few percent every half hour so repeat listings feel alive.
  const bucket = Math.floor(now.getTime() / (30 * 60 * 1000));
  const drift = 0.94 + seeded(hash(`${externalId}:${bucket}`))() * 0.12;

  const unitCents =
    baseUnit * MATERIAL_FACTOR[material] * CONDITION_FACTOR[condition] * factor * tcFactor * drift;
  // Bigger lots get a volume discount.
  const volume = lotSize >= 48 ? 0.85 : lotSize >= 12 ? 0.92 : 1;
  const lotPriceCents = Math.max(99, Math.round((unitCents * lotSize * volume) / 5) * 5);

  const shippingCents = Math.round(between(rng, profile.shippingCents) / 100) * 100;
  const lotsAvailable = intBetween(rng, profile.lotsAvailable);

  const partial = {
    category,
    size,
    color,
    material,
    threadCount,
    condition,
    lotPriceCents,
    lotSize,
    lotsAvailable,
    shippingCents,
  };

  return {
    externalId,
    title: titleFor(partial),
    url: `https://example.com/mock/${profile.id}/${externalId}`,
    ...partial,
  };
}

/** Fake network delay so loading states are visible. Off in tests. */
function latency(rng: () => number, min: number, spread: number): Promise<void> {
  if (process.env.LINEN_MOCK_LATENCY === "0") return Promise.resolve();
  return new Promise((r) => setTimeout(r, min + rng() * spread));
}

function makeAdapter(profile: Profile): SourceAdapter {
  return {
    id: profile.id,
    async fetchListings({ now, rng }: FetchContext) {
      const count = intBetween(rng, profile.perScan);
      const seen = new Set<number>();
      const out: RawListing[] = [];
      while (out.length < count && seen.size < profile.poolSize) {
        const n = Math.floor(rng() * profile.poolSize);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(listingFromPool(profile, n, now));
      }
      await latency(rng, 60, 140);
      return out;
    },
    async placeOrder(req, { rng }) {
      await latency(rng, 120, 200);
      if (rng() < profile.orderFailureRate) {
        return { ok: false, error: "Seller ran out of stock before checkout finished" };
      }
      const ref = `MOCK-${req.externalId.toUpperCase()}-${Math.floor(rng() * 90000 + 10000)}`;
      return { ok: true, externalRef: ref };
    },
  };
}

export const MOCK_PROFILES = PROFILES;

export const mockAdapters: SourceAdapter[] = PROFILES.map(makeAdapter);
