/**
 * What the last eBay scan brought back, for eyeballing how well titles are
 * being read. Run a scan first:
 *
 *   LINEN_SOURCES=ebay npm run worker -- --once
 *   npm run ebay:report
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";
import { EBAY_SOURCE_ID } from "@/engine/sources/selection";
import { loadEnvFiles } from "./env";

loadEnvFiles();
const db = getDb();
const rows = db.select().from(listings).where(eq(listings.sourceId, EBAY_SOURCE_ID)).orderBy(desc(listings.lastSeenAt)).all();

if (rows.length === 0) {
  console.log("No eBay listings stored. Run a scan with LINEN_SOURCES=ebay first.");
  process.exit(0);
}

const clean = rows.filter((r) => !r.parseIssues?.length);
const byStatus = new Map<string, number>();
for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

console.log(`eBay listings stored: ${rows.length}`);
console.log(`Read cleanly (nothing unknown): ${clean.length} (${Math.round((clean.length / rows.length) * 100)}%)`);
console.log(`By status: ${[...byStatus].map(([s, n]) => `${s} ${n}`).join(", ")}\n`);

// Group reasons so "$9.60/unit is over..." and "$9.71/unit is over..." count together.
const reasons = new Map<string, number>();
for (const r of rows.filter((r) => r.status === "unmatched")) {
  const parts = r.parseIssues?.length ? r.parseIssues.map((i) => i.reason) : [r.note ?? "(no reason recorded)"];
  for (const p of parts) {
    const key = p
      .replace(/^Close to .*?, but /, "")
      .replace(/\$[\d,.]+/g, "$X")
      .replace(/\b\d+ TC\b/g, "N TC")
      .replace(/\(.*?\)/g, "(…)");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
}
console.log("Top reasons for not matching:");
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}

console.log("\n10 sample listings as read:");
const step = Math.max(1, Math.floor(rows.length / 10));
for (const r of rows.filter((_, i) => i % step === 0).slice(0, 10)) {
  const ship = r.shippingCents == null ? "?" : (r.shippingCents / 100).toFixed(2);
  console.log(`\n  ${r.title}`);
  console.log(
    `    ${r.category ?? "?"} | size ${r.size ?? "-"} | ${r.color ?? "?"} | ${r.material ?? "?"} | ${r.threadCount ?? "-"} TC | ${r.condition ?? "?"} | lot of ${r.lotSize ?? "?"} | $${(r.lotPriceCents / 100).toFixed(2)} + $${ship} shipping`,
  );
  console.log(`    ${r.status}: ${r.note ?? ""}`);
}
