import fs from "node:fs";

/**
 * Next.js reads .env files for the web app on its own. Scripts run outside
 * Next, so they load the same files here. Values already set in the shell
 * win, and .env.local wins over .env.
 */
export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
}
