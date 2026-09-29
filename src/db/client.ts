import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { ensureSources, seedIfEmpty } from "./seed";

export type DB = BetterSQLite3Database<typeof schema>;

/** The connection or a transaction on it. Engine helpers take this so they can run inside either. */
export type Queryable = BaseSQLiteDatabase<"sync", Database.RunResult, typeof schema>;

const globalForDb = globalThis as unknown as { __linenDb?: DB };

export function dbPath(): string {
  // The DB lives outside the bundle; tell the tracer not to follow this path.
  return path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    process.env.LINEN_DB_PATH ?? "data/linen-watch.db",
  );
}

/** Open (creating, migrating and seeding if needed) a database file. */
export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  // WAL lets the worker write while the Next server reads.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  // Changing a column in SQLite means rebuilding the table, and dropping the
  // old one fails while other tables point at it. Migrations run inside a
  // transaction, where the `PRAGMA foreign_keys=OFF` they contain is ignored,
  // so foreign keys are switched off here, then checked and switched back on.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  if (broken.length > 0) {
    throw new Error(`Database migration left ${broken.length} broken reference(s). Restore a backup or run \`npm run db:reset\`.`);
  }
  sqlite.pragma("foreign_keys = ON");

  seedIfEmpty(db);
  ensureSources(db);
  return db;
}

/**
 * One connection per process, reused across hot reloads. The Next dev server
 * and the worker each get their own; SQLite + WAL handles the concurrency.
 */
export function getDb(): DB {
  if (!globalForDb.__linenDb) globalForDb.__linenDb = openDb(dbPath());
  return globalForDb.__linenDb;
}
