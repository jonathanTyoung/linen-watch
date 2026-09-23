/**
 * The always-on agent. Locally it runs next to `npm run dev`; in production it
 * becomes a small worker process (Railway/Render/VPS) pointed at the real DB.
 *
 *   npm run worker            scan forever on the interval set in Settings
 *   npm run worker -- --once  one scan, then exit
 */
import { getDb } from "@/db/client";
import { getSettings } from "@/engine/queries";
import { runScan } from "@/engine/scan";

const once = process.argv.includes("--once");
let stopping = false;

process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("\nStopping after the current scan… (Ctrl+C again to force)");
});

function stamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

async function main() {
  const db = getDb();
  console.log(`[${stamp()}] Linen Watch worker started${once ? " (single scan)" : ""}`);

  while (!stopping) {
    const result = await runScan(db, { trigger: "worker" });
    if (result.skipped) {
      console.log(`[${stamp()}] skipped: ${result.reason}`);
    } else {
      console.log(
        `[${stamp()}] scan #${result.runId}: ${result.listingsSeen} seen, ${result.matched} matched, ` +
          `${result.autoBought} bought, ${result.queued} queued, ${result.blocked} blocked, ${result.expired} expired` +
          (result.errors.length ? `, ${result.errors.length} errors` : ""),
      );
    }
    if (once) break;

    const wait = getSettings(db).scanIntervalSeconds * 1000;
    const until = Date.now() + wait;
    while (!stopping && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.log(`[${stamp()}] worker stopped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
