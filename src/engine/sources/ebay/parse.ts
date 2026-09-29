import {
  CATEGORIES,
  label,
  type Category,
  type Color,
  type Condition,
  type ListingCaution,
  type ListingIssue,
  type Material,
  type Size,
} from "@/lib/catalog";
import type { RawListing } from "../types";
import { CONDITION_BY_EBAY_ID } from "./config";
import type { EbayAmount, EbayItemSummary, EbayShippingOption } from "./types";
import {
  BLENDS,
  COLORS,
  COTTON,
  COTTON_MEANS,
  FIBER_NOT_STATED,
  KINDS,
  LOT_PHRASES,
  MATERIAL_WORDS,
  MAX_LOT_SIZE,
  MICROFIBER,
  MULTIPACK_HINTS,
  NEGATION_WORDS,
  NOT_COUNTS,
  NUMBER_WORDS,
  OTHER_COLORS,
  OTHER_MATERIALS,
  OTHER_PRODUCTS,
  POLYESTER,
  SETS,
  SIZES,
  SIZE_MEANS,
  THREAD_COUNTS,
  THREAD_COUNT_RANGE,
  UNSIZED,
  VAGUE_ITEMS,
  WEAVES,
  WEAVES_NEEDING_FIBER,
} from "./vocabulary";

/**
 * Turn an eBay listing into a RawListing. Pure: no network, no clock.
 *
 * This file is the logic. The words it looks for are all in ./vocabulary.ts,
 * which is the file to edit when tuning how titles are read.
 *
 * eBay's search gives structured price, shipping and condition, but what the
 * item actually is lives in a free-text title written by the seller. The rule
 * throughout: if the title doesn't clearly say it, the field is null and an
 * issue says why. A wrong guess could buy the wrong linens, so "unknown" is
 * always the safe answer; an unknown listing can never match a spec.
 */

export interface ParsedTitle {
  category: Category | null;
  size: Size | null;
  color: Color | null;
  material: Material | null;
  threadCount: number | null;
  lotSize: number | null;
  issues: ListingIssue[];
  /** Worth a person's attention, but not a reason to reject. */
  cautions: ListingCaution[];
}

// ---------- title: preparation ----------

interface Prepared {
  /** Lowercased, punctuation softened, negated words removed. */
  text: string;
  /** Things the title says the item is NOT ("not percale"). */
  negated: string[];
}

const NEGATED = new RegExp(
  String.raw`\b(?:${NEGATION_WORDS.join("|")})[\s-]+(?:an?\s+|the\s+|any\s+)?([a-z]+(?:[\s-]?cases?)?)`,
  "g",
);

function prepare(title: string): Prepared {
  let text = ` ${title.toLowerCase()} `
    .replace(/[’`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[()[\]{}!*~"“”|•·]/g, " ")
    .replace(/twenty[\s-]four/g, "twenty four")
    .replace(/\s+/g, " ");

  // "NOT percale", "no fitted sheet", "without pillowcases": take the negated
  // thing out so it isn't read as a description of the item.
  const negated: string[] = [];
  text = text.replace(NEGATED, (_m, word: string) => {
    negated.push(word.trim());
    return " ";
  });
  return { text: text.replace(/\s+/g, " "), negated };
}

/** Test without the pattern remembering where it got to (vocabulary patterns are often global). */
const has = (text: string, re: RegExp) => new RegExp(re.source, re.flags.replace("g", "")).test(text);
const hasAll = (text: string, all: RegExp[]) => all.every((re) => has(text, re));
const globally = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);

function list(items: string[]): string {
  return [...new Set(items)].join(", ");
}

// ---------- title: what kind of item ----------

function parseCategory(text: string): { category: Category | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ category: null, issue: { field: "category" as const, reason } });

  const set = SETS.find((s) => hasAll(text, s.all));
  if (set) return unknown(set.reason);

  const kinds = KINDS.filter((k) => hasAll(text, k.all));
  const others = OTHER_PRODUCTS.filter((o) => has(text, o.pattern)).map((o) => o.name);

  if (kinds.length + others.length > 1) {
    const names = [...kinds.map((k) => label(CATEGORIES, k.means).toLowerCase()), ...others];
    return unknown(`it's more than one kind of item (${list(names)})`);
  }
  if (kinds.length === 1) return { category: kinds[0].means };
  if (others.length === 1) return unknown(`it's a ${others[0]}, which isn't something we track`);

  const vague = VAGUE_ITEMS.find((v) => has(text, v.pattern));
  return unknown(vague?.reason ?? "can't tell what kind of item it is");
}

// ---------- title: size ----------

function parseSize(text: string, category: Category | null): { size: Size | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ size: null, issue: { field: "size" as const, reason } });
  // Some things come in no sizes, and with no category there's nothing to size.
  if (category == null || UNSIZED.includes(category)) return { size: null };

  let rest = text;
  const found: string[] = [];
  for (const rule of SIZES) {
    if (rule.only && !rule.only.includes(category)) continue;
    if (has(rest, rule.pattern)) found.push(rule.name);
    rest = rest.replace(globally(rule.pattern), " ");
  }
  const sizes = [...new Set(found)];

  if (sizes.length === 0) return unknown("the size isn't in the title");
  if (sizes.length > 1) return unknown(`the title lists more than one size (${list(sizes)})`);

  const only = sizes[0];
  const pillowcase = category === "pillowcase";
  const size = (pillowcase ? SIZE_MEANS.pillowcase : SIZE_MEANS.bed)[only];
  if (size) return { size };
  return unknown(pillowcase ? `${only} isn't a pillowcase size we track` : `${only} isn't a size we track`);
}

// ---------- title: color ----------

const OTHER_COLOR = new RegExp(String.raw`\b(${OTHER_COLORS.join("|")})\b`, "g");

function parseColor(text: string): { color: Color | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ color: null, issue: { field: "color" as const, reason } });

  let rest = text;
  const ours: Color[] = [];
  for (const rule of COLORS) {
    if (has(rest, rule.pattern)) ours.push(rule.means);
    rest = rest.replace(globally(rule.pattern), " ");
  }
  const theirs = [...rest.matchAll(OTHER_COLOR)].map((m) => m[1].replace(/colou?rs?$/, "color").replace(/[\s-]/g, ""));
  const colors = [...new Set<string>([...ours, ...theirs])];

  if (colors.length === 0) return unknown("the color isn't in the title");
  if (colors.length > 1) return unknown(`the title lists more than one color (${list(colors)})`);
  if (ours.length === 1) return { color: ours[0] };
  return unknown(`it's ${colors[0]}, not a color we track`);
}

// ---------- title: material ----------

function parseMaterial(
  text: string,
  negated: string[],
  category: Category | null,
): { material: Material | null; issue?: ListingIssue; caution?: ListingCaution } {
  const unknown = (reason: string) => ({ material: null, issue: { field: "material" as const, reason } });

  const others = OTHER_MATERIALS.filter((o) => has(text, o.pattern)).map((o) => o.name);
  const cotton = has(text, COTTON);
  const poly = has(text, POLYESTER);
  const blend = BLENDS.some((b) => has(text, b.pattern)) || (poly && cotton);
  // Polyester on its own, not as half of a poly-cotton blend.
  if (!blend && poly) others.push("polyester");
  if (others.length > 0) return unknown(`it's ${list(others)}, which isn't a material we track`);

  // What it's made of beats how it's woven: a poly-cotton percale is a blend.
  if (has(text, MICROFIBER)) return { material: "microfiber" };
  if (blend) return { material: "poly_cotton" };

  const weaves = WEAVES.filter((w) => has(text, w.pattern));
  if (weaves.length === 1) {
    const material = weaves[0].means;
    const fiberMissing = WEAVES_NEEDING_FIBER.includes(material) && !cotton;
    return fiberMissing ? { material, caution: FIBER_NOT_STATED } : { material };
  }
  if (weaves.length > 1) {
    return unknown(`the title mentions more than one material (${list(weaves.map((w) => w.name))})`);
  }

  const not = negated.filter((n) => MATERIAL_WORDS.test(n));
  if (not.length > 0) return unknown(`the title says it's not ${list(not)}, but not what it is`);

  if (cotton) {
    const implied = category ? COTTON_MEANS[category] : undefined;
    if (implied) return { material: implied };
    return unknown("it says cotton, but not whether it's percale or sateen");
  }
  return unknown("the material isn't in the title");
}

// ---------- title: thread count ----------

function parseThreadCount(text: string): { threadCount: number | null; rest: string } {
  const found = new Set<number>();
  let rest = text;
  for (const { pattern } of THREAD_COUNTS) {
    for (const m of rest.matchAll(globally(pattern))) {
      const n = Number(m[1]);
      if (n >= THREAD_COUNT_RANGE.min && n <= THREAD_COUNT_RANGE.max) found.add(n);
    }
    rest = rest.replace(globally(pattern), " ");
  }
  // Two different numbers means we don't know which one applies.
  return { threadCount: found.size === 1 ? [...found][0] : null, rest };
}

// ---------- title: lot size ----------

const COUNT = String.raw`(\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})`;
const DIGITS = String.raw`(\d{1,3})`;

const LOT_PATTERNS = LOT_PHRASES.map((p) => ({
  ...p,
  pattern: new RegExp(p.phrase.replaceAll("{N}", COUNT).replaceAll("{D}", DIGITS), "g"),
}));

const MULTIPACK = new RegExp(String.raw`\b(?:${MULTIPACK_HINTS.join("|")})\b`);

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_LOT_SIZE ? n : null;
}

function parseLotSize(text: string): { lotSize: number | null; issue?: ListingIssue } {
  let rest = text;
  for (const { pattern } of NOT_COUNTS) rest = rest.replace(globally(pattern), " ");
  // So "case" below means a case of goods, never a pillow case.
  const pillowcase = KINDS.find((k) => k.means === "pillowcase")!.all[0];
  rest = ` ${rest.replace(globally(pillowcase), " pillowcases ").replace(/\s+/g, " ")} `;

  const found: number[] = [];
  for (const { pattern, times } of LOT_PATTERNS) {
    // Record every match, then blank it so a later phrase can't count it twice.
    rest = rest.replace(pattern, (...args) => {
      const written = typeof args[1] === "string" ? args[1] : undefined;
      // A number too big to be a count ("2019 sheets") isn't one.
      const n = written ? toNumber(written) : 1;
      if (n != null && n * times <= MAX_LOT_SIZE) found.push(n * times);
      return " ";
    });
  }

  const counts = [...new Set(found)];
  if (counts.length === 1) return { lotSize: counts[0] };
  if (counts.length > 1) {
    return {
      lotSize: null,
      issue: { field: "lotSize", reason: `the title gives more than one count (${counts.join(", ")})` },
    };
  }
  // No number, but it reads like more than one: we can't price a unit.
  if (MULTIPACK.test(rest)) {
    return {
      lotSize: null,
      issue: { field: "lotSize", reason: "it looks like a multi-pack, but the count isn't in the title" },
    };
  }
  return { lotSize: 1 };
}

// ---------- title: all together ----------

export function parseTitle(title: string): ParsedTitle {
  const { text, negated } = prepare(title);
  const issues: ListingIssue[] = [];
  const cautions: ListingCaution[] = [];
  const note = <T extends { issue?: ListingIssue; caution?: ListingCaution }>(r: T): T => {
    if (r.issue) issues.push(r.issue);
    if (r.caution) cautions.push(r.caution);
    return r;
  };

  const { category } = note(parseCategory(text));
  const { size } = note(parseSize(text, category));
  const { color } = note(parseColor(text));
  const { material } = note(parseMaterial(text, negated, category));
  const { threadCount, rest } = parseThreadCount(text);
  const { lotSize } = note(parseLotSize(rest));

  return { category, size, color, material, threadCount, lotSize, issues, cautions };
}

// ---------- structured fields ----------

/** "12.5" -> 1250, without going through floating point. Null for anything odd. */
export function parseCents(value: string | undefined): number | null {
  const m = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(value?.trim() ?? "");
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A price we can use: in US dollars, and not converted from another currency. */
export function usdCents(amount: EbayAmount | undefined): number | null {
  if (!amount || amount.currency !== "USD" || amount.convertedFromCurrency) return null;
  return parseCents(amount.value);
}

/**
 * The cheapest shipping option with a price on it. Null when eBay gave no
 * cost, which happens with calculated shipping, freight and local pickup.
 * Never assumed to be free.
 */
export function shippingCents(options: EbayShippingOption[] | undefined): number | null {
  const costs = (options ?? []).map((o) => usdCents(o.shippingCost)).filter((c): c is number => c != null);
  return costs.length ? Math.min(...costs) : null;
}

export function parseCondition(conditionId: string | undefined): {
  condition: Condition | null;
  issue?: ListingIssue;
} {
  if (!conditionId) return { condition: null, issue: { field: "condition", reason: "the condition isn't given" } };
  if (!(conditionId in CONDITION_BY_EBAY_ID)) {
    return {
      condition: null,
      issue: { field: "condition", reason: `eBay condition ${conditionId} isn't one we recognise` },
    };
  }
  const condition = CONDITION_BY_EBAY_ID[conditionId];
  if (condition == null) {
    return { condition: null, issue: { field: "condition", reason: "it's sold for parts or not working" } };
  }
  return { condition };
}

export const SHIPPING_NOT_LISTED: ListingIssue = { field: "shipping", reason: "shipping cost isn't listed" };

export type Parsed = { ok: true; listing: RawListing } | { ok: false; skipped: string };

/**
 * Map one search result to a RawListing. Listings we can't use at all
 * (auctions, other currencies, no price) are skipped rather than stored.
 * Seller details are never read.
 */
export function toRawListing(item: EbayItemSummary): Parsed {
  if (!item.itemId || !item.title || !item.itemWebUrl) return { ok: false, skipped: "missing id, title or link" };

  const options = item.buyingOptions ?? [];
  if (!options.includes("FIXED_PRICE") || options.includes("AUCTION")) {
    return { ok: false, skipped: "not a fixed-price listing" };
  }
  const lotPriceCents = usdCents(item.price);
  if (lotPriceCents == null) return { ok: false, skipped: "price missing or not in US dollars" };

  const title = parseTitle(item.title);
  const issues = [...title.issues];

  const { condition, issue: conditionIssue } = parseCondition(item.conditionId);
  if (conditionIssue) issues.push(conditionIssue);

  const shipping = shippingCents(item.shippingOptions);
  if (shipping == null) issues.push(SHIPPING_NOT_LISTED);

  // One entry standing for several sizes or colors: the price shown is for
  // one of them, and we can't tell which.
  if (item.itemGroupType) {
    issues.push({
      field: "listing",
      reason: "the listing covers several options (sizes or colors) and the price is for only one of them",
    });
  }

  return {
    ok: true,
    listing: {
      externalId: item.itemId,
      title: item.title,
      url: item.itemWebUrl,
      category: title.category,
      size: title.size,
      color: title.color,
      material: title.material,
      threadCount: title.threadCount,
      condition,
      lotPriceCents,
      lotSize: title.lotSize,
      // Search results don't say how many the seller has. Plan for one lot;
      // Nick can buy more in the eBay app.
      lotsAvailable: 1,
      shippingCents: shipping,
      parseIssues: issues,
      cautions: title.cautions,
    },
  };
}
