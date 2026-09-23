import { defineConfig } from "drizzle-kit";

// Schema lives in TypeScript; `npm run db:generate` writes SQL migrations to
// ./drizzle, which the app applies on boot. Never hand-edit the database.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.LINEN_DB_PATH ?? "./data/linen-watch.db",
  },
});
