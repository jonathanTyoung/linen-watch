/**
 * First thing to run once eBay API keys exist. Makes a handful of calls and
 * reports, in order:
 *
 *   1. whether the keys sign in
 *   2. whether this app may search eBay at all (eBay's docs disagree on
 *      whether production search needs partner approval; this settles it)
 *   3. the real daily call limit
 *   4. whether the category ids in src/engine/sources/ebay/config.ts are right
 *
 *   npm run ebay:check
 *
 * Read-only. Uses about 6 of the day's calls. Never prints the keys or token.
 */
import { readCredentials, createTokenProvider } from "@/engine/sources/ebay/auth";
import { endUserContext } from "@/engine/sources/ebay/client";
import { EBAY_CATEGORY_IDS, EBAY_DAILY_CALL_LIMIT, EBAY_HOSTS, EBAY_MARKETPLACE } from "@/engine/sources/ebay/config";
import { loadEnvFiles } from "./env";

interface TreeNode {
  category?: { categoryId?: string; categoryName?: string };
  leafCategoryTreeNode?: boolean;
  childCategoryTreeNodes?: TreeNode[];
}

async function main() {
  loadEnvFiles();
  const creds = readCredentials();
  if (!creds) {
    console.log("No eBay keys found. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (and EBAY_ENV) to .env.local.");
    process.exit(1);
  }
  const host = EBAY_HOSTS[creds.environment];
  console.log(`Checking eBay (${creds.environment})\n`);

  // 1. Sign in.
  let token: string;
  try {
    token = await createTokenProvider(creds).getToken();
    console.log("1. Sign-in: OK");
  } catch (err) {
    console.log(`1. Sign-in: FAILED. ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const get = async (path: string) => {
    const res = await fetch(`${host}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE,
        "X-EBAY-C-ENDUSERCTX": endUserContext("37203"),
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, ok: res.ok, body };
  };
  const firstError = (body: Record<string, unknown> | null) => {
    const e = (body?.errors as { errorId?: number; message?: string; longMessage?: string }[] | undefined)?.[0];
    return e ? `error ${e.errorId}: ${e.longMessage ?? e.message}` : "no details given";
  };

  // 2. One search. This is the answer to "is Browse open to us?".
  const search = await get(
    `/buy/browse/v1/item_summary/search?q=${encodeURIComponent("white queen flat sheet")}&category_ids=20460&limit=3` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE},priceCurrency:USD,deliveryCountry:US")}`,
  );
  if (search.ok) {
    const items = (search.body?.itemSummaries as { title?: string }[] | undefined) ?? [];
    console.log(`2. Search: OK (HTTP ${search.status}). eBay reports ${search.body?.total ?? "?"} results.`);
    for (const i of items) console.log(`     - ${i.title}`);
    if (creds.environment === "sandbox") {
      console.log("   Note: this is the sandbox. Its listings are test data, and it says nothing about production access.");
    }
  } else {
    console.log(`2. Search: REFUSED (HTTP ${search.status}, ${firstError(search.body)})`);
    console.log("   If this is production, the app likely needs eBay's approval for the Buy APIs before it can search.");
  }

  // 3. The real call limit.
  const limits = await get("/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy");
  if (limits.ok) {
    const resources =
      (limits.body?.rateLimits as { resources?: { name?: string; rates?: { limit?: number; remaining?: number; timeWindow?: number }[] }[] }[] | undefined)?.flatMap(
        (r) => r.resources ?? [],
      ) ?? [];
    console.log(`3. Call limits (config assumes ${EBAY_DAILY_CALL_LIMIT} a day):`);
    for (const r of resources) {
      for (const rate of r.rates ?? []) {
        console.log(`     - ${r.name}: ${rate.remaining} of ${rate.limit} left per ${Math.round((rate.timeWindow ?? 0) / 3600)}h`);
      }
    }
    if (resources.length === 0) console.log("     (eBay returned no limits for the Browse API)");
  } else {
    console.log(`3. Call limits: couldn't read them (HTTP ${limits.status}, ${firstError(limits.body)})`);
  }

  // 4. Category ids.
  console.log("4. Categories in config.ts:");
  const wanted = [...new Set(Object.values(EBAY_CATEGORY_IDS).filter((id): id is string => id != null))];
  for (const id of wanted) {
    const res = await get(`/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${id}`);
    const node = res.body?.categorySubtreeNode as TreeNode | undefined;
    if (res.ok && node?.category) {
      const kind = node.leafCategoryTreeNode ? "leaf" : `not a leaf, ${node.childCategoryTreeNodes?.length ?? 0} children`;
      console.log(`     - ${id}: "${node.category.categoryName}" (${kind})`);
    } else {
      console.log(`     - ${id}: NOT FOUND (HTTP ${res.status}, ${firstError(res.body)})`);
    }
  }
  for (const q of ["bath towels", "hand towels", "duvet cover"]) {
    const res = await get(`/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(q)}`);
    const top = (res.body?.categorySuggestions as { category?: { categoryId?: string; categoryName?: string } }[] | undefined)?.[0];
    console.log(
      res.ok && top?.category
        ? `     - eBay's suggestion for "${q}": ${top.category.categoryId} "${top.category.categoryName}"`
        : `     - no suggestion for "${q}" (HTTP ${res.status}; eBay doesn't offer suggestions in the sandbox)`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
