import { describe, expect, it } from "vitest";
import { parseTitle } from "./parse";
import {
  BLENDS,
  COLORS,
  COTTON_MEANS,
  KINDS,
  LOT_PHRASES,
  MULTIPACK_HINTS,
  NEGATION_WORDS,
  NOT_COUNTS,
  NUMBER_WORDS,
  OTHER_COLORS,
  OTHER_MATERIALS,
  OTHER_PRODUCTS,
  SETS,
  SIZES,
  SIZE_MEANS,
  THREAD_COUNTS,
  VAGUE_ITEMS,
  WEAVES,
} from "./vocabulary";

/**
 * Every rule in vocabulary.ts carries an example title. These tests run each
 * one through the real reader, so a rule can't be added or edited without
 * showing that it does what it says. Lists without examples (plain word
 * lists) are covered word by word.
 */

const issue = (title: string, field: string) => parseTitle(title).issues.find((i) => i.field === field)?.reason;

describe("vocabulary: kinds of item", () => {
  it.each(KINDS)("$means: $example", ({ means, example }) => {
    expect(parseTitle(example).category).toBe(means);
  });

  it.each(SETS)("set: $example", ({ reason, example }) => {
    expect(parseTitle(example).category).toBeNull();
    expect(issue(example, "category")).toBe(reason);
  });

  it.each(OTHER_PRODUCTS)("not ours ($name): $example", ({ name, example }) => {
    expect(parseTitle(example).category).toBeNull();
    expect(issue(example, "category")).toBe(`it's a ${name}, which isn't something we track`);
  });

  it.each(VAGUE_ITEMS)("too vague: $example", ({ reason, example }) => {
    expect(parseTitle(example).category).toBeNull();
    expect(issue(example, "category")).toBe(reason);
  });
});

describe("vocabulary: sizes", () => {
  it.each(SIZES)("$name: $example", ({ name, example }) => {
    const got = parseTitle(example);
    expect(got.category, "the example must name a kind of item that comes in sizes").not.toBeNull();
    const ours = (got.category === "pillowcase" ? SIZE_MEANS.pillowcase : SIZE_MEANS.bed)[name];
    if (ours) {
      expect(got.size).toBe(ours);
    } else {
      expect(got.size).toBeNull();
      expect(issue(example, "size")).toBe(
        got.category === "pillowcase" ? `${name} isn't a pillowcase size we track` : `${name} isn't a size we track`,
      );
    }
  });
});

describe("vocabulary: colors", () => {
  it.each(COLORS)("$means: $example", ({ means, example }) => {
    expect(parseTitle(example).color).toBe(means);
  });

  it.each(OTHER_COLORS.filter((c) => /^[a-z]+$/.test(c)))("not ours: %s", (color) => {
    const title = `${color} Queen Flat Sheet Percale`;
    expect(parseTitle(title).color).toBeNull();
    expect(issue(title, "color")).toBe(`it's ${color}, not a color we track`);
  });

  it.each(["Multi-Color", "Multicolored", "Assorted", "Assorted Colors", "Colours"])("not one color: %s", (words) => {
    expect(parseTitle(`${words} Queen Flat Sheets Percale`).color).toBeNull();
  });
});

describe("vocabulary: materials", () => {
  it.each(WEAVES)("$name: $example", ({ means, example }) => {
    expect(parseTitle(example).material).toBe(means);
  });

  it.each(BLENDS)("blend: $example", ({ example }) => {
    expect(parseTitle(example).material).toBe("poly_cotton");
  });

  it.each(OTHER_MATERIALS)("not ours ($name): $example", ({ name, example }) => {
    expect(parseTitle(example).material).toBeNull();
    expect(issue(example, "material")).toBe(`it's ${name}, which isn't a material we track`);
  });

  it.each(Object.entries(COTTON_MEANS))("plain cotton on a %s means %s", (category, material) => {
    const item = KINDS.find((k) => k.means === category)!.example.replace(/terry/i, "100% Cotton");
    expect(parseTitle(item)).toMatchObject({ category, material });
  });

  it("plain cotton on anything else is left unknown", () => {
    const covered = Object.keys(COTTON_MEANS);
    for (const kind of KINDS.filter((k) => !covered.includes(k.means))) {
      const title = kind.example.replace(/percale|sateen/i, "100% Cotton");
      expect(parseTitle(title).material, title).toBeNull();
    }
  });
});

describe("vocabulary: thread counts", () => {
  it.each(THREAD_COUNTS)("$example", ({ example, expect: want }) => {
    expect(parseTitle(example).threadCount).toBe(want);
  });
});

describe("vocabulary: lot sizes", () => {
  it.each(LOT_PHRASES)("$example", ({ example, expect: want }) => {
    expect(parseTitle(example).lotSize).toBe(want);
  });

  it.each(NOT_COUNTS)("a measurement, not a count: $example", ({ example }) => {
    expect(parseTitle(example).lotSize).toBe(1);
  });

  it.each(Object.entries(NUMBER_WORDS))("%s means %i", (word, n) => {
    expect(parseTitle(`${word} White Queen Flat Sheets Percale`).lotSize).toBe(n);
  });

  it.each(["Lot", "Lots", "Bulk", "Wholesale", "Case", "Bundle", "Multipack", "Multi-Pack", "Pack", "Set"])(
    "%s with no count is a multi-pack of unknown size",
    (word) => {
      const title = `${word} White Queen Flat Sheets Percale`;
      expect(parseTitle(title).lotSize).toBeNull();
      expect(issue(title, "lotSize")).toBe("it looks like a multi-pack, but the count isn't in the title");
    },
  );

  it("covers every multi-pack hint", () => {
    // If a hint is added to the vocabulary, add its word to the list above.
    expect(MULTIPACK_HINTS).toHaveLength(8);
  });
});

describe("vocabulary: negation", () => {
  it.each(["Not", "Non", "No", "Without", "w/o", "Excludes", "Exclude", "Excluding"])("%s takes the next word out", (word) => {
    const got = parseTitle(`White Queen Flat Sheet ${word} Percale`);
    expect(got.material).toBeNull();
  });

  it("covers every negation word", () => {
    expect(NEGATION_WORDS).toHaveLength(7);
  });
});
