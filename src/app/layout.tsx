import type { Metadata } from "next";
import Link from "next/link";
import { inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/archivo/latin-700.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";
import { NavLinks } from "@/components/nav-links";
import { ebayActive } from "@/engine/sources/selection";
import { UserSwitcher } from "@/components/user-switcher";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Linen Watch", template: "%s · Linen Watch" },
  description: "Finds white linens under J&N's price and buys them within your limits.",
};

async function needsAttentionCount(): Promise<number> {
  await connection();
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(listings)
      .where(inArray(listings.status, ["pending", "awaiting_checkout"]))
      .get()?.n ?? 0
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [user, pendingCount] = await Promise.all([currentUser(), needsAttentionCount()]);
  // Read after the awaits above, so it's decided per request, not at build time.
  const liveEbay = ebayActive();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                    <path
                      d="M4 6L8 3H16L20 6V9C20 10.1 19.1 11 18 11C17.2 11 16.5 10.6 16.1 10V20C16.1 20.6 15.6 21 15 21H9C8.4 21 7.9 20.6 7.9 20V10C7.5 10.6 6.8 11 6 11C4.9 11 4 10.1 4 9V6Z"
                      stroke="var(--accent-ink)"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="leading-tight">
                  <span className="block font-display text-[15px] font-bold tracking-tight">Linen Watch</span>
                  <span className="block text-[11px] text-muted">J&amp;N Cleaners</span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <span
                  className="hidden rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn sm:inline"
                  title={
                    liveEbay
                      ? "eBay listings are real. Linen Watch never orders on eBay itself; a person checks out."
                      : "Sources are simulated and no real orders are placed"
                  }
                >
                  {liveEbay ? "eBay is live · you check out" : "Mock mode · no real orders"}
                </span>
                <UserSwitcher current={user} />
              </div>
            </div>
            <NavLinks pendingCount={pendingCount} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted sm:px-6">
          {liveEbay
            ? "eBay listings are real. Linen Watch never orders on eBay itself: a person checks out in the eBay app, then marks it bought here."
            : "Mock sources and orders. Nothing here spends real money."}
        </footer>
      </body>
    </html>
  );
}
