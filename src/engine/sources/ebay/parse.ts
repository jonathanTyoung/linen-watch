import type { Category, Color, Condition, ListingIssue, Material, Size } from "@/lib/catalog";
import type { RawListing } from "../types";
import { CONDITION_BY_EBAY_ID } from "./config";
import type { EbayAmount, EbayItemSummary, EbayShippingOption } from "./types";

/**
 * Turn an eBay listing into a RawListing. Pure: no network, no clock.
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
}

// ---------- title: preparation ----------

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  "twenty four": 24,
};

interface Prepared {
  /** Lowercased, punctuation softened, negated words removed. */
  text: string;
  /** Things the title says the item is NOT ("not percale"). */
  negated: string[];
}

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
  text = text.replace(
    /\b(?:not|non|no|without|w\/o|excludes?|excluding)[\s-]+(?:an?\s+|the\s+|any\s+)?([a-z]+(?:[\s-]?cases?)?)/g,
    (_m, word: string) => {
      negated.push(word.trim());
      return " ";
    },
  );
  return { text: text.replace(/\s+/g, " "), negated };
}

const has = (text: string, re: RegExp) => re.test(text);

function list(items: string[]): string {
  return [...new Set(items)].join(", ");
}

// ---------- title: what kind of item ----------

const OTHER_PRODUCTS: [RegExp, string][] = [
  [/\bbath sheets?\b/, "bath sheet"],
  [/\bwash\s?cloths?\b|\bface (?:cloths?|towels?)\b/, "washcloth"],
  [/\bbath mats?\b|\bbath rugs?\b/, "bath mat"],
  [/\b(?:beach|pool|kitchen|dish|tea|gym|salon|golf|paper) towels?\b/, "another kind of towel"],
  [/\bcomforters?\b/, "comforter"],
  [/\bblankets?\b/, "blanket"],
  [/\bquilts?\b|\bcoverlets?\b|\bbedspreads?\b/, "bedspread"],
  [/\bmattress (?:pads?|protectors?|toppers?|covers?|encasements?)\b/, "mattress cover"],
  [/\bbed\s?skirts?\b|\bdust ruffles?\b/, "bed skirt"],
  [/\bshams?\b/, "pillow sham"],
  [/\bpillow (?:protectors?|covers?|inserts?)\b/, "pillow cover"],
  [/\bduvet inserts?\b/, "duvet insert"],
  [/\bcurtains?\b|\btable\s?cloths?\b|\bnapkins?\b|\b(?:bath)?robes?\b/, "something else"],
];

const CATEGORY_NAMES: Record<Category, string> = {
  flat_sheet: "flat sheet",
  fitted_sheet: "fitted sheet",
  pillowcase: "pillowcase",
  duvet_cover: "duvet cover",
  bath_towel: "bath towel",
  hand_towel: "hand towel",
};

const PIECES = /\b\d+\s?-?\s?(?:pc|pcs|piece|pieces)\b/;

function parseCategory(text: string): { category: Category | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ category: null, issue: { field: "category" as const, reason } });

  const sheet = has(text, /\bsheets?\b/) && !has(text, /\bbath sheets?\b/);
  const flat = has(text, /\bflat\b/);
  const fitted = has(text, /\bfitted\b/);
  const towel = has(text, /\btowels?\b/);

  // "Sheet set" is flat + fitted + pillowcases sold together. "Sheet set of 2"
  // and "set of 2 flat sheets" are lots of one thing, not sets.
  const sheetSet =
    has(text, /\bsheets? sets?\b(?! of \d)/) ||
    has(text, /\bbed(?:ding)? sets?\b/) ||
    (sheet && has(text, PIECES) && has(text, /\bsets?\b/));
  if (sheetSet) return unknown("it's a sheet set, not a single kind of item");
  if (towel && (has(text, /\btowels? sets?\b(?! of \d)/) || (has(text, PIECES) && has(text, /\bsets?\b/)))) {
    return unknown("it's a towel set, not a single kind of item");
  }

  const kinds: Category[] = [];
  if (sheet && flat) kinds.push("flat_sheet");
  if (sheet && fitted) kinds.push("fitted_sheet");
  if (has(text, /\bpillow\s?-?\s?cases?\b/)) kinds.push("pillowcase");
  if (has(text, /\bduvet covers?\b/)) kinds.push("duvet_cover");
  if (has(text, /\bbath towels?\b/)) kinds.push("bath_towel");
  if (has(text, /\bhand towels?\b/)) kinds.push("hand_towel");

  const others = OTHER_PRODUCTS.filter(([re]) => has(text, re)).map(([, name]) => name);

  if (kinds.length + others.length > 1) {
    const names = [...kinds.map((k) => CATEGORY_NAMES[k]), ...others];
    return unknown(`it's more than one kind of item (${list(names)})`);
  }
  if (kinds.length === 1) return { category: kinds[0] };
  if (others.length === 1) return unknown(`it's a ${others[0]}, which isn't something we track`);
  if (sheet) return unknown("can't tell if it's a flat or fitted sheet");
  if (towel) return unknown("can't tell what kind of towel it is");
  return unknown("can't tell what kind of item it is");
}

// ---------- title: size ----------

/** Sizes we don't stock. Checked first so "cal king" isn't read as "king". */
const OTHER_SIZES: [RegExp, string][] = [
  [/\bcal(?:ifornia)?\.? king\b|\bcali king\b/g, "California king"],
  [/\bsplit king\b/g, "split king"],
  [/\bsuper king\b/g, "super king"],
  [/\btwin[\s-]?xl\b|\bxl[\s-]?twin\b|\btwin extra long\b/g, "twin XL"],
  [/\bfull[\s-]?xl\b/g, "full XL"],
  [/\b(?:olympic|short|rv|three quarter) queen\b/g, "an odd queen size"],
  [/\bbody pillow\b/g, "body pillow"],
  [/\beuro(?:pean)?\b/g, "euro"],
  [/\btoddler\b|\bcrib\b|\btravel\b/g, "toddler or travel"],
];

const BED_SIZES: [RegExp, string][] = [
  [/\btwin\b/g, "twin"],
  // "full" is also an ordinary word: "full case", "full elastic".
  [/\bfull\b(?! (?:set|case|dozen|length|elastic|all|around|refund))/g, "full"],
  [/\bdouble (?:bed|size)\b/g, "full"],
  [/\bqueen\b/g, "queen"],
  [/\bking\b/g, "king"],
  [/\b(?:standard|std)\b/g, "standard"],
];

function parseSize(text: string, category: Category | null): { size: Size | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ size: null, issue: { field: "size" as const, reason } });
  // Towels come in no sizes, and with no category there's nothing to size.
  if (category == null || category === "bath_towel" || category === "hand_towel") return { size: null };

  let rest = text;
  const found: string[] = [];
  for (const [re, name] of OTHER_SIZES) {
    if (has(rest, new RegExp(re.source))) found.push(name);
    rest = rest.replace(re, " ");
  }
  for (const [re, name] of BED_SIZES) {
    if (has(rest, new RegExp(re.source))) found.push(name);
  }
  // On a sheet, "standard" is a sales word ("hotel standard"), not a size.
  const sizes = [...new Set(found)].filter((s) => category === "pillowcase" || s !== "standard");

  if (sizes.length === 0) return unknown("the size isn't in the title");
  if (sizes.length > 1) return unknown(`the title lists more than one size (${list(sizes)})`);

  const only = sizes[0];
  if (category === "pillowcase") {
    if (only === "standard") return { size: "standard" };
    if (only === "king") return { size: "king_pillow" };
    return unknown(`${only} isn't a pillowcase size we track`);
  }
  if (only === "twin" || only === "full" || only === "queen" || only === "king") return { size: only };
  return unknown(`${only} isn't a size we track`);
}

// ---------- title: color ----------

const COLORS_WE_TRACK: [RegExp, Color][] = [
  [/\b(?:ivory|cream|ecru|off[\s-]?white)\b/g, "ivory"],
  [/\bwhite\b/g, "white"],
  [/\bgr[ae]y\b/g, "gray"],
];

const OTHER_COLORS =
  /\b(black|blue|navy|red|pink|green|sage|beige|tan|taupe|brown|yellow|gold|purple|lavender|lilac|burgundy|maroon|teal|aqua|turquoise|orange|coral|charcoal|silver|khaki|mint|blush|multi[\s-]?colou?r(?:ed)?|assorted|colou?rs)\b/g;

function parseColor(text: string): { color: Color | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ color: null, issue: { field: "color" as const, reason } });

  let rest = text;
  const found: string[] = [];
  // Order matters: "off white" has to be taken out before "white" is looked for.
  for (const [re, name] of COLORS_WE_TRACK) {
    if (has(rest, new RegExp(re.source))) found.push(name);
    rest = rest.replace(re, " ");
  }
  for (const m of rest.matchAll(OTHER_COLORS)) found.push(m[1].replace(/colou?rs?$/, "color").replace(/[\s-]/g, ""));
  const colors = [...new Set(found)];

  if (colors.length === 0) return unknown("the color isn't in the title");
  if (colors.length > 1) return unknown(`the title lists more than one color (${list(colors)})`);
  const only = colors[0];
  if (only === "white" || only === "ivory" || only === "gray") return { color: only };
  return unknown(`it's ${only}, not a color we track`);
}

// ---------- title: material ----------

const OTHER_MATERIALS: [RegExp, string][] = [
  [/\bbamboo\b/, "bamboo"],
  [/\b(?:100% |pure |flax |french |belgian )linen\b/, "linen"],
  [/\bsilk\b/, "silk"],
  [/\bsatin\b/, "satin"],
  [/\bflannel\b/, "flannel"],
  [/\bjersey\b/, "jersey"],
  [/\btencel\b|\blyocell\b|\bmodal\b|\brayon\b|\bviscose\b/, "rayon"],
  [/\bvelour\b/, "velour"],
  [/\bwaffle\b/, "waffle weave"],
  [/\bfleece\b|\bsherpa\b/, "fleece"],
  [/\bmuslin\b|\bgauze\b/, "muslin"],
];

const BLEND =
  /\bpoly(?:ester)?\s?[-/ ]?\s?cotton\b|\bcotton\s?[-/ ]?\s?poly(?:ester)?\b|\bpolycotton\b|\bcotton[\s-]?(?:rich|blend)\b|\bblend(?:ed)?\b|\bcvc\b|\b[1-9]0\s?\/\s?[1-9]0\b|\b[1-9]5\s?\/\s?[1-9]5\b/;

function parseMaterial(
  text: string,
  negated: string[],
  category: Category | null,
): { material: Material | null; issue?: ListingIssue } {
  const unknown = (reason: string) => ({ material: null, issue: { field: "material" as const, reason } });

  const others = OTHER_MATERIALS.filter(([re]) => has(text, re)).map(([, name]) => name);
  const poly = has(text, /\bpoly(?:ester)?\b/);
  // Cotton and polyester anywhere in the same title is a blend, however it's
  // written: "60% cotton 40% poly", "cotton/polyester", "poly cotton".
  const blend = has(text, BLEND) || (poly && has(text, /\bcotton\b/));
  // Polyester on its own, not as half of a poly-cotton blend.
  if (!blend && poly) others.push("polyester");
  if (others.length > 0) return unknown(`it's ${list(others)}, which isn't a material we track`);

  // What it's made of beats how it's woven: a poly-cotton percale is a blend.
  if (has(text, /\bmicro\s?-?\s?fib(?:er|re)\b/)) return { material: "microfiber" };
  if (blend) return { material: "poly_cotton" };

  const weaves: Material[] = [];
  if (has(text, /\bpercale\b/)) weaves.push("percale");
  if (has(text, /\bsateen\b/)) weaves.push("sateen");
  if (has(text, /\bterry(?:\s?cloth)?\b/)) weaves.push("cotton_terry");
  if (weaves.length === 1) return { material: weaves[0] };
  if (weaves.length > 1) {
    const names = weaves.map((w) => (w === "cotton_terry" ? "terry" : w));
    return unknown(`the title mentions more than one material (${list(names)})`);
  }

  const not = negated.filter((n) => /percale|sateen|terry|microfib|cotton/.test(n));
  if (not.length > 0) return unknown(`the title says it's not ${list(not)}, but not what it is`);

  if (has(text, /\bcotton\b/)) {
    const towel = category === "bath_towel" || category === "hand_towel";
    return unknown(
      towel ? "it says cotton, but not whether it's terry" : "it says cotton, but not whether it's percale or sateen",
    );
  }
  return unknown("the material isn't in the title");
}

// ---------- title: thread count ----------

const THREAD_COUNT = [
  /\b(\d{3,4})\s?-?\s?(?:tc|thread[\s-]?count|thread|t\/c)\b/g,
  /\b(?:tc|thread[\s-]?count)\s?-?\s?(\d{3,4})\b/g,
  // Hotel linen shorthand: T-180, T200, T250.
  /\bt-?(\d{3})\b/g,
];

function parseThreadCount(text: string): { threadCount: number | null; rest: string } {
  const found = new Set<number>();
  let rest = text;
  for (const re of THREAD_COUNT) {
    for (const m of rest.matchAll(re)) {
      const n = Number(m[1]);
      if (n >= 100 && n <= 1500) found.add(n);
    }
    rest = rest.replace(re, " ");
  }
  // Two different numbers means we don't know which one applies.
  return { threadCount: found.size === 1 ? [...found][0] : null, rest };
}

// ---------- title: lot size ----------

const N = String.raw`(\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})`;

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : null;
}

function parseLotSize(text: string): { lotSize: number | null; issue?: ListingIssue } {
  // Numbers that are measurements, not counts.
  let rest = text
    .replace(/\b\d+(?:\.\d+)?\s?(?:"|''|in|inch|inches|cm)?\s?[x×]\s?\d+(?:\.\d+)?\s?(?:"|''|in|inch|inches|cm)?(?:\s?[x×]\s?\d+(?:\.\d+)?)?/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s?(?:lbs?|pounds?|oz|#)\s?(?:\/|per)?\s?(?:dz|doz|dozen)?\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s?(?:gsm|g\/m2|%|percent|inch(?:es)?|in\b|"|cm|mm|series)/g, " ")
    .replace(/\b\d+\s?\/\s?\d+\b/g, " ") // 50/50 blends
    .replace(/\bpillow\s?-?\s?cases?\b/g, " pillowcases "); // so "case" below means a case of goods
  rest = ` ${rest.replace(/\s+/g, " ")} `;

  const found: number[] = [];
  /** Record every match of `re`, then blank it so a later pattern can't count it twice. */
  const take = (re: RegExp, value: (m: RegExpMatchArray) => number | null) => {
    rest = rest.replace(re, (...args) => {
      const n = value(args as unknown as RegExpMatchArray);
      if (n != null && n >= 1 && n <= 1000) found.push(n);
      return " ";
    });
  };

  take(/\bhalf (?:a )?(?:dozen|doz|dz)\b/g, () => 6);
  take(new RegExp(String.raw`\b(?:${N}|a)? ?(?:dozens?|doz|dz)\b`, "g"), (m) => (toNumber(m[1]) ?? 1) * 12);
  take(new RegExp(String.raw`\b(?:${N} )?pairs?\b`, "g"), (m) => (toNumber(m[1]) ?? 1) * 2);
  take(
    new RegExp(String.raw`\b(?:lots?|packs?|sets?|cases?|box|bundle|bag|bale|qty|quantity)\s?(?:of\s)?[:#]?\s?${N}\b`, "g"),
    (m) => toNumber(m[1]),
  );
  take(
    new RegExp(String.raw`\b${N}\s?[-/]?\s?(?:packs?|pk|pcs?|pieces?|count|ct|ea|each|units?)\b`, "g"),
    (m) => toNumber(m[1]),
  );
  // "12 white queen flat sheets", "2 pillowcases".
  take(
    new RegExp(String.raw`\b${N} (?:[a-z-]+ ){0,8}?(?:sheets|pillowcases|towels|covers)\b`, "g"),
    (m) => toNumber(m[1]),
  );
  take(/(?:^|\s)x\s?(\d{1,3})(?=\s|$)/g, (m) => toNumber(m[1]));
  take(/\b(\d{1,3})\s?x(?=\s|$)/g, (m) => toNumber(m[1]));
  take(/\bsingle\b/g, () => 1);

  const counts = [...new Set(found)];
  if (counts.length === 1) return { lotSize: counts[0] };
  if (counts.length > 1) {
    return {
      lotSize: null,
      issue: { field: "lotSize", reason: `the title gives more than one count (${counts.join(", ")})` },
    };
  }
  // No number, but it reads like more than one: we can't price a unit.
  if (has(rest, /\b(?:lots?|bulk|wholesale|cases?|bundles?|multi[\s-]?packs?|packs?|sets?)\b/)) {
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
  const note = <T extends { issue?: ListingIssue }>(r: T): T => {
    if (r.issue) issues.push(r.issue);
    return r;
  };

  const { category } = note(parseCategory(text));
  const { size } = note(parseSize(text, category));
  const { color } = note(parseColor(text));
  const { material } = note(parseMaterial(text, negated, category));
  const { threadCount, rest } = parseThreadCount(text);
  const { lotSize } = note(parseLotSize(rest));

  return { category, size, color, material, threadCount, lotSize, issues };
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
    },
  };
}
