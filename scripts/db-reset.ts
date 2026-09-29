/**
 * Wipe the local database and start fresh with the example specs and sources.
 *
 *   npm run db:reset             empty queue, ready for a first scan
 *   npm run db:reset -- --demo   also runs a few scans so there's data to look at
 */
import fs from "node:fs";
import { dbPath, getDb } from "@/db/client";
import { runScan } from "@/engine/scan";
import { loadEnvFiles } from "./env";

async function main() {
  loadEnvFiles();
  const file = dbPath();
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  const db = getDb();
  console.log(`Fresh database at ${file}`);

  if (process.argv.includes("--demo")) {
    for (let i = 0; i < 4; i++) {
      const r = await runScan(db, { trigger: "manual" });
      if (!r.skipped) console.log(`  scan ${i + 1}: ${r.listingsSeen} seen, ${r.matched} matched, ${r.queued} queued`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
