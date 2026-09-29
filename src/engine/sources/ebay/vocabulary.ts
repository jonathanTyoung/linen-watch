import type { Category, Color, ListingCaution, Material, Size } from "@/lib/catalog";

/**
 * Every word and phrase the title reader understands. parse.ts holds the
 * logic; this file holds the vocabulary. Tuning the reader after a live run
 * means editing this file, not the parsing code.
 *
 * How to read it:
 * - Titles are lowercased before matching, with punctuation like ( ) [ ] " |
 *   turned into spaces, "&" into "and", and negated words ("NOT percale")
 *   removed. Patterns only ever see that cleaned-up text.
 * - Every rule carries an `example`: a title that shows the rule working.
 *   vocabulary.test.ts runs each one, so a rule can't be added or changed
 *   without proof it does what it says.
 * - Order matters inside a list where noted. Earlier rules win.
 *
 * The standing rule: when in doubt, leave it out. A missing word makes a
 * listing "Not a match" with a reason. A wrong word can buy the wrong linens.
 */

// ---------- shared ----------

/** Words that turn the next word into something the item is NOT. */
export const NEGATION_WORDS = ["not", "non", "no", "without", "w/o", "excludes?", "excluding"];

/** Counts written out. Keys are matched as whole words. */
export const NUMBER_WORDS: Record<string, number> = {
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

// ---------- what kind of item ----------

export interface KindRule {
  means: Category;
  /** Every one of these must appear. */
  all: RegExp[];
  example: string;
}

const SHEET = /\bsheets?\b(?<!\bbath sheets?)/;

export const KINDS: KindRule[] = [
  { means: "flat_sheet", all: [SHEET, /\bflat\b/], example: "White Queen Flat Sheet Percale" },
  { means: "fitted_sheet", all: [SHEET, /\bfitted\b/], example: "White King Fitted Sheet Sateen" },
  { means: "pillowcase", all: [/\bpillow\s?-?\s?cases?\b/], example: "White Standard Pillow Cases Percale" },
  { means: "duvet_cover", all: [/\bduvet covers?\b/], example: "White Duvet Cover King Sateen" },
  { means: "bath_towel", all: [/\bbath towels?\b/], example: "White Bath Towels Terry" },
  { means: "hand_towel", all: [/\bhand towels?\b/], example: "White Hand Towel Terry" },
];

export interface SetRule {
  /** Every one of these must appear. */
  all: RegExp[];
  reason: string;
  example: string;
}

const PIECES = /\b\d+\s?-?\s?(?:pc|pcs|piece|pieces)\b/;
const SET = /\bsets?\b/;

/**
 * Several different items sold together. Checked before KINDS. "Set of 6"
 * is a count of one thing, not a set, hence the `(?! of \d)`.
 */
export const SETS: SetRule[] = [
  {
    all: [/\bsheets? sets?\b(?! of \d)/],
    reason: "it's a sheet set, not a single kind of item",
    example: "Queen Sheet Set White Microfiber",
  },
  {
    all: [/\bbed(?:ding)? sets?\b/],
    reason: "it's a sheet set, not a single kind of item",
    example: "White Queen Bedding Set Sateen",
  },
  {
    all: [SHEET, PIECES, SET],
    reason: "it's a sheet set, not a single kind of item",
    example: "4 Piece Queen Bed Sheets Set White Sateen",
  },
  {
    all: [/\btowels? sets?\b(?! of \d)/],
    reason: "it's a towel set, not a single kind of item",
    example: "White Towel Set Bath Hand Terry",
  },
  {
    all: [/\btowels?\b/, PIECES, SET],
    reason: "it's a towel set, not a single kind of item",
    example: "6 Piece White Bath Towels Set Terry",
  },
];

export interface NamedRule {
  pattern: RegExp;
  name: string;
  example: string;
}

/** Things that aren't linens we track. One of these alone, or alongside a KIND, means no match. */
export const OTHER_PRODUCTS: NamedRule[] = [
  { pattern: /\bbath sheets?\b/, name: "bath sheet", example: "Hotel Bath Sheet White Terry 35x70" },
  { pattern: /\bwash\s?cloths?\b|\bface (?:cloths?|towels?)\b/, name: "washcloth", example: "White Washcloths Terry" },
  { pattern: /\bbath mats?\b|\bbath rugs?\b/, name: "bath mat", example: "White Bath Mat Terry" },
  {
    pattern: /\b(?:beach|pool|kitchen|dish|tea|gym|salon|golf|paper) towels?\b/,
    name: "another kind of towel",
    example: "White Pool Towels Terry",
  },
  { pattern: /\bcomforters?\b/, name: "comforter", example: "White Queen Comforter" },
  { pattern: /\bblankets?\b/, name: "blanket", example: "White Queen Blanket Cotton" },
  { pattern: /\bquilts?\b|\bcoverlets?\b|\bbedspreads?\b/, name: "bedspread", example: "White King Coverlet" },
  {
    pattern: /\bmattress (?:pads?|protectors?|toppers?|covers?|encasements?)\b/,
    name: "mattress cover",
    example: "White Queen Mattress Protector",
  },
  { pattern: /\bbed\s?skirts?\b|\bdust ruffles?\b/, name: "bed skirt", example: "White Queen Bed Skirt" },
  { pattern: /\bshams?\b/, name: "pillow sham", example: "King Pillow Shams White Percale" },
  {
    pattern: /\bpillow (?:protectors?|covers?|inserts?)\b/,
    name: "pillow cover",
    example: "White Standard Pillow Protector",
  },
  { pattern: /\bduvet inserts?\b/, name: "duvet insert", example: "White Queen Duvet Insert" },
  {
    pattern: /\bcurtains?\b|\btable\s?cloths?\b|\bnapkins?\b|\b(?:bath)?robes?\b/,
    name: "something else",
    example: "White Cotton Tablecloth",
  },
];

/** Names the item too loosely to tell which KIND it is. Checked last. */
export const VAGUE_ITEMS: { pattern: RegExp; reason: string; example: string }[] = [
  { pattern: SHEET, reason: "can't tell if it's a flat or fitted sheet", example: "White Queen Sheet Percale" },
  { pattern: /\btowels?\b/, reason: "can't tell what kind of towel it is", example: "White Hotel Towels Terry" },
];

// ---------- sizes ----------

export interface SizeRule {
  pattern: RegExp;
  /** What the title is saying, in words. Two different names in one title = unknown size. */
  name: string;
  /** Leave out to apply to everything that comes in sizes. */
  only?: Category[];
  example: string;
}

/**
 * In order. Each match is taken out of the title before the next rule runs,
 * which is why "California king" comes before "king".
 */
export const SIZES: SizeRule[] = [
  // The common hotel pillowcase (20x30) is sold as "Standard/Queen": it fits
  // both pillows. That's our standard size, not two sizes.
  {
    pattern: /\b(?:standard|std)\s?(?:\/|-| and )\s?queen\b|\bqueen\s?(?:\/|-| and )\s?(?:standard|std)\b/g,
    name: "standard",
    only: ["pillowcase"],
    example: "Standard/Queen Pillowcases White Percale",
  },

  // Sizes we don't stock.
  { pattern: /\bcal(?:ifornia)?\.? king\b|\bcali king\b/g, name: "California king", example: "Cal King Fitted Sheet White Percale" },
  { pattern: /\bsplit king\b/g, name: "split king", example: "Split King Fitted Sheet White Percale" },
  { pattern: /\bsuper king\b/g, name: "super king", example: "Super King Flat Sheet White Percale" },
  {
    pattern: /\btwin[\s-]?xl\b|\bxl[\s-]?twin\b|\btwin extra long\b/g,
    name: "twin XL",
    example: "Twin XL Flat Sheet White Percale",
  },
  { pattern: /\bfull[\s-]?xl\b/g, name: "full XL", example: "Full XL Fitted Sheet White Percale" },
  {
    pattern: /\b(?:olympic|short|rv|three quarter) queen\b/g,
    name: "an odd queen size",
    example: "RV Queen Fitted Sheet White Percale",
  },
  { pattern: /\bbody pillow\b/g, name: "body pillow", example: "Body Pillow Pillowcase White Percale" },
  { pattern: /\beuro(?:pean)?\b/g, name: "euro", example: "Euro Pillowcase White Percale" },
  { pattern: /\btoddler\b|\bcrib\b|\btravel\b/g, name: "toddler or travel", example: "Toddler Pillowcase White Percale" },

  // Sizes we do.
  { pattern: /\btwin\b/g, name: "twin", example: "Twin Flat Sheet White Percale" },
  // "full" is also an ordinary word: "full case", "full elastic".
  {
    pattern: /\bfull\b(?! (?:set|case|dozen|length|elastic|all|around|refund))/g,
    name: "full",
    example: "Full Size Flat Sheet White Percale",
  },
  { pattern: /\bdouble (?:bed|size)\b/g, name: "full", example: "Double Bed Flat Sheet White Percale" },
  { pattern: /\bqueen\b/g, name: "queen", example: "Queen Flat Sheet White Percale" },
  { pattern: /\bking\b/g, name: "king", example: "King Flat Sheet White Percale" },
  // On a sheet, "standard" is a sales word ("hotel standard"), not a size.
  {
    pattern: /\b(?:standard|std)\b/g,
    name: "standard",
    only: ["pillowcase"],
    example: "Standard Pillowcase White Percale",
  },
];

/** Which of our sizes a name means, for things on a bed and for pillowcases. */
export const SIZE_MEANS: { bed: Record<string, Size>; pillowcase: Record<string, Size> } = {
  bed: { twin: "twin", full: "full", queen: "queen", king: "king" },
  pillowcase: { standard: "standard", king: "king_pillow" },
};

/** Categories that come in no sizes. */
export const UNSIZED: Category[] = ["bath_towel", "hand_towel"];

// ---------- colors ----------

/** In order: "off white" has to be taken out before "white" is looked for. */
export const COLORS: { pattern: RegExp; means: Color; example: string }[] = [
  { pattern: /\b(?:ivory|cream|ecru|off[\s-]?white)\b/g, means: "ivory", example: "Off White Queen Flat Sheet Percale" },
  { pattern: /\bwhite\b/g, means: "white", example: "Bright White Queen Flat Sheet Percale" },
  { pattern: /\bgr[ae]y\b/g, means: "gray", example: "Grey Queen Flat Sheet Percale" },
];

/** Colors we don't buy. Any of these in a title means it isn't plainly one of ours. */
export const OTHER_COLORS = [
  "black", "blue", "navy", "red", "pink", "green", "sage", "beige", "tan", "taupe", "brown",
  "yellow", "gold", "purple", "lavender", "lilac", "burgundy", "maroon", "teal", "aqua",
  "turquoise", "orange", "coral", "charcoal", "silver", "khaki", "mint", "blush",
  "multi[\\s-]?colou?r(?:ed)?", "assorted", "colou?rs",
];

// ---------- materials ----------

/** Materials we don't buy. Checked first: "cotton velour" is velour. */
export const OTHER_MATERIALS: NamedRule[] = [
  { pattern: /\bbamboo\b/, name: "bamboo", example: "White Bamboo Queen Flat Sheet" },
  // "Hotel linen" and "bed linens" are just words for bedding; only these mean the fabric.
  { pattern: /\b(?:100% |pure |flax |french |belgian )linen\b/, name: "linen", example: "White Pure Linen Queen Flat Sheet" },
  { pattern: /\bsilk\b/, name: "silk", example: "White Silk Standard Pillowcase" },
  { pattern: /\bsatin\b/, name: "satin", example: "White Satin Standard Pillowcase" },
  { pattern: /\bflannel\b/, name: "flannel", example: "White Flannel Queen Flat Sheet" },
  { pattern: /\bjersey\b/, name: "jersey", example: "White Jersey Queen Fitted Sheet" },
  { pattern: /\btencel\b|\blyocell\b|\bmodal\b|\brayon\b|\bviscose\b/, name: "rayon", example: "White Tencel Queen Flat Sheet" },
  { pattern: /\bvelour\b/, name: "velour", example: "White Cotton Velour Bath Towel" },
  { pattern: /\bwaffle\b/, name: "waffle weave", example: "White Waffle Bath Towels Cotton" },
  { pattern: /\bfleece\b|\bsherpa\b/, name: "fleece", example: "White Fleece Queen Flat Sheet" },
  { pattern: /\bmuslin\b|\bgauze\b/, name: "muslin", example: "White Muslin Queen Flat Sheet" },
];

export const COTTON = /\bcotton\b/;
export const POLYESTER = /\bpoly(?:ester)?\b/;
export const MICROFIBER = /\bmicro\s?-?\s?fib(?:er|re)\b/;

/**
 * Ways of saying cotton-polyester blend. Cotton and polyester anywhere in the
 * same title also counts, however it's written ("60% cotton 40% poly").
 */
export const BLENDS: { pattern: RegExp; example: string }[] = [
  { pattern: /\bpoly(?:ester)?\s?[-/ ]?\s?cotton\b|\bpolycotton\b/, example: "White Queen Flat Sheet Poly-Cotton T180" },
  { pattern: /\bcotton\s?[-/ ]?\s?poly(?:ester)?\b/, example: "White Queen Flat Sheet Cotton/Poly T180" },
  { pattern: /\bcotton[\s-]?(?:rich|blend)\b|\bblend(?:ed)?\b|\bcvc\b/, example: "White Cotton Rich Queen Flat Sheet T200" },
  { pattern: /\b[1-9]0\s?\/\s?[1-9]0\b|\b[1-9]5\s?\/\s?[1-9]5\b/, example: "White Queen Flat Sheet 60/40 Percale T180" },
];

/** How it's woven. What it's made of wins over this: a poly-cotton percale is a blend. */
export const WEAVES: { pattern: RegExp; means: Material; name: string; example: string }[] = [
  { pattern: /\bpercale\b/, means: "percale", name: "percale", example: "White Queen Flat Sheet Percale" },
  { pattern: /\bsateen\b/, means: "sateen", name: "sateen", example: "White Queen Flat Sheet Sateen" },
  { pattern: /\bterry(?:\s?cloth)?\b/, means: "cotton_terry", name: "terry", example: "White Bath Towels Terry Cloth" },
];

/**
 * What "cotton" on its own means, by kind of item. A cotton towel is terry
 * unless the title names another weave (those are in OTHER_MATERIALS).
 * Sheets aren't here: a cotton sheet could be percale or sateen.
 */
export const COTTON_MEANS: Partial<Record<Category, Material>> = {
  bath_towel: "cotton_terry",
  hand_towel: "cotton_terry",
};

/**
 * Weaves that say nothing about the fiber. "Percale" alone is read as cotton
 * percale, but hotel percale is often a poly-cotton blend that doesn't say
 * so. The listing still matches; the card warns the person approving it.
 */
export const WEAVES_NEEDING_FIBER: Material[] = ["percale", "sateen"];

export const FIBER_NOT_STATED: ListingCaution = {
  label: "Fiber not stated",
  detail:
    "The title names the weave but not what it's made of. Hotel percale and sateen are often poly-cotton blends. Check the listing before approving.",
};

/** Negated words that are about the material: "NOT percale". */
export const MATERIAL_WORDS = /percale|sateen|terry|microfib|cotton/;

// ---------- thread count ----------

/** Group 1 is the number. "T-180" is hotel shorthand for a 180 thread count. */
export const THREAD_COUNTS: { pattern: RegExp; example: string; expect: number }[] = [
  {
    pattern: /\b(\d{3,4})\s?-?\s?(?:tc|thread[\s-]?count|thread|t\/c)\b/g,
    example: "White Queen Flat Sheet Percale 400 Thread Count",
    expect: 400,
  },
  { pattern: /\b(?:tc|thread[\s-]?count)\s?-?\s?(\d{3,4})\b/g, example: "White Queen Flat Sheet Percale TC 300", expect: 300 },
  { pattern: /\bt-?(\d{3})\b/g, example: "White Queen Flat Sheet Percale T-250", expect: 250 },
];

export const THREAD_COUNT_RANGE = { min: 100, max: 1500 };

// ---------- lot sizes ----------

/** Numbers that are measurements, not counts. Removed before counting. */
export const NOT_COUNTS: { pattern: RegExp; example: string }[] = [
  {
    // 24x50, 27" x 54", 90 x 110 x 15
    pattern: /\b\d+(?:\.\d+)?\s?(?:"|''|in|inch|inches|cm)?\s?[x×]\s?\d+(?:\.\d+)?\s?(?:"|''|in|inch|inches|cm)?(?:\s?[x×]\s?\d+(?:\.\d+)?)?/g,
    example: "White Bath Towel Terry 27x54",
  },
  {
    // 10.5 lbs/dz: a towel's weight per dozen, not a dozen towels
    pattern: /\b\d+(?:\.\d+)?\s?(?:lbs?|pounds?|oz|#)\s?(?:\/|per)?\s?(?:dz|doz|dozen)?\b/g,
    example: "White Bath Towel Terry 10.5 lbs/dz",
  },
  {
    pattern: /\b\d+(?:\.\d+)?\s?(?:gsm|g\/m2|%|percent|inch(?:es)?|in\b|"|cm|mm|series)/g,
    example: "White Bath Towel Terry 600 GSM",
  },
  { pattern: /\b\d+\s?\/\s?\d+\b/g, example: "White Queen Flat Sheet 50/50 Percale" },
];

export interface LotPhrase {
  /**
   * Regex source. `{N}` stands for a count, as digits or a number word, and
   * `{D}` for digits only. Where the count is optional and missing, it's 1
   * ("a dozen", "pair").
   */
  phrase: string;
  /** What one of these is worth: 12 for a dozen, 2 for a pair. */
  times: number;
  example: string;
  expect: number;
}

/**
 * In order. Each match is taken out before the next phrase runs, so
 * "2 dozen" isn't counted again as "2 ... towels".
 */
export const LOT_PHRASES: LotPhrase[] = [
  { phrase: String.raw`\bhalf (?:a )?(?:dozen|doz|dz)\b`, times: 6, example: "Half Dozen White Bath Towels Terry", expect: 6 },
  { phrase: String.raw`\b(?:{N}|a)? ?(?:dozens?|doz|dz)\b`, times: 12, example: "2 Dozen White Bath Towels Terry", expect: 24 },
  { phrase: String.raw`\b(?:{N} )?pairs?\b`, times: 2, example: "King Pillowcase White Sateen Pair", expect: 2 },
  {
    phrase: String.raw`\b(?:lots?|packs?|sets?|cases?|box|bundle|bag|bale|qty|quantity)\s?(?:of\s)?[:#]?\s?{N}\b`,
    times: 1,
    example: "White Queen Flat Sheets Percale Case of 24",
    expect: 24,
  },
  {
    phrase: String.raw`\b{N}\s?[-/]?\s?(?:packs?|pk|pcs?|pieces?|count|ct|ea|each|units?)\b`,
    times: 1,
    example: "White Queen Fitted Sheet Percale 12pk",
    expect: 12,
  },
  // "12 white queen flat sheets": a count, up to eight words, then what's counted.
  {
    phrase: String.raw`\b{N} (?:[a-z-]+ ){0,8}?(?:sheets|pillowcases|towels|covers)\b`,
    times: 1,
    example: "24 New White Hotel Bath Towels Terry",
    expect: 24,
  },
  { phrase: String.raw`(?:^|\s)x\s?{D}(?=\s|$)`, times: 1, example: "White Queen Flat Sheet Percale x12", expect: 12 },
  { phrase: String.raw`\b{D}\s?x(?=\s|$)`, times: 1, example: "White Queen Flat Sheet Percale 6x", expect: 6 },
  { phrase: String.raw`\bsingle\b`, times: 1, example: "White Queen Flat Sheet Percale Single", expect: 1 },
];

/** Counts above this are something else (a model number, a year). */
export const MAX_LOT_SIZE = 1000;

/**
 * Words that suggest more than one item. With one of these and no count we
 * can't price a unit, so the lot size is unknown rather than assumed to be 1.
 */
export const MULTIPACK_HINTS = ["lots?", "bulk", "wholesale", "cases?", "bundles?", "multi[\\s-]?packs?", "packs?", "sets?"];
