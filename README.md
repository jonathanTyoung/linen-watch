# Linen Watch

An agent that watches suppliers for white linens matching J&N Cleaners' specs, and buys them (or asks first) when the landed price per unit is under the limit. Built for Nick and Jake at J&N.

**This is the local MVP.** By default every source is simulated and no real orders are placed. The buying logic, guardrails and data model are the real ones.

**eBay is the first real source.** Linen Watch searches eBay for listings that fit each spec, queues the matches and texts Nick. It never orders on eBay: eBay's ordering API is for approved partners only, so a person buys in the eBay app and taps *I bought it*. eBay is off until you turn it on (see [eBay](#ebay)).

## Run it

```bash
nvm use            # Node 22
npm install
npm run dev:all    # web app on :3000 + the agent worker, in one terminal
```

Open http://localhost:3000. The database creates itself on first boot with example specs, four mock sources, and eBay (off until you give it keys).

Other ways to run:

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app only. Use **Scan now** on the dashboard to run the agent by hand. |
| `npm run worker` | The agent on its own, scanning on the interval set in Settings. |
| `npm run worker -- --once` | One scan, then exit. |
| `npm run db:reset` | Wipe the local database back to the example data. |
| `npm run db:demo` | Same, plus four scans so the queue has something in it. |
| `npm test` | Unit + integration tests for matching, guardrails and scanning. No test touches the network. |
| `npm run ebay:check` | With eBay keys set: checks sign-in, that search is open to us, the real call limit and the category ids. |
| `npm run ebay:report` | After an eBay scan: how many listings were read cleanly, the top reasons for not matching, and samples. |
| `npm run build` | Production build (the real TypeScript gate). |

## eBay

Turn it on in `.env.local` (git ignores it; never commit keys):

```bash
LINEN_SOURCES=ebay          # mock (default) | ebay | all
EBAY_CLIENT_ID=...          # App ID from developer.ebay.com/my/keys
EBAY_CLIENT_SECRET=...      # Cert ID
EBAY_ENV=production         # sandbox (default) | production
```

Then, in this order:

1. `npm run ebay:check`. Its second line says whether eBay lets this app search at all. eBay's docs disagree on whether production search needs partner approval, so this is the test. It also confirms the category ids in `src/engine/sources/ebay/config.ts`; fix any it flags there.
2. **Settings → Ship to ZIP code**: set J&N's ZIP. eBay quotes shipping to it, and shipping counts toward the price per unit.
3. **Settings → Scan every**: set 900 (15 minutes). eBay allows about 5,000 calls a day and a scan can use up to 20; Settings warns below 10 minutes.
4. `LINEN_SOURCES=ebay npm run worker -- --once`, then `npm run ebay:report` to see how well titles are being read.

How eBay listings are handled:

- **One search per active spec**, newest listings first, up to 400 per spec per scan. US dollars, fixed price, shipped to and from the US.
- **What the item is comes from the seller's title**, so the reader is strict. Anything it can't be sure of (a sheet set, two sizes in one title, a multi-pack with no count, shipping eBay didn't give) is left unknown, and **a listing with anything unknown never matches**. It lands in Queue → Not a match with the reason. Unknown shipping is never treated as free.
- **One lot per listing.** eBay's search doesn't say how many a seller has, so the agent proposes one lot. More may be available on eBay.
- **No seller details are stored**, only item data. That's what lets the app opt out of eBay's account-deletion notifications ("not persisting eBay data").
- **Listing data is kept fresh.** At the end of each scan, eBay listings that came to nothing (not a match, expired, skipped) and haven't shown up in a search for 24 hours are deleted, along with the activity entries that quote them. Anything tied to an order is kept. An approval that expired unbought is kept for 7 days so a late *I bought it* can still be recorded.
- **Conditions:** eBay's New is new. "New other" and "Like New" are like new ("New other" can be a factory second). New with defects, refurbished and every grade of used are used. "For parts" never matches.

## Demo script (for Nick and Jake)

1. **Settings → Demo tools → Reset with sample scans.** Queue fills with matches.
2. **Dashboard.** Walk the "Needs your call" cards: landed price per unit, how far under the limit, what the agent proposes to buy and why it's waiting.
3. **Approve one from the wholesale source** → it orders immediately. **Approve one from the retailer** → it moves to "Awaiting checkout", because that site has no ordering API; a person buys it and taps *I bought it*.
4. **Settings → turn on Auto-buy**, save, then start `npm run worker` (or hit Scan now a few times). Wholesale matches now buy themselves, and stop at the weekly cap.
5. **Pause all buying.** Scans keep finding things; nothing gets bought, even by approval.
6. **Queue → Not a match.** Every listing that didn't qualify says why ("200 TC is under 250", "$10.40/unit is over the $9.50 limit"). This is what you tune the specs with once Nick gives real numbers.
7. **Switch between Nick and Jake** (top right). Approvals and changes are credited to whoever is selected.

## How it works

```
worker / Scan now
      │
      ▼
runScan ──► each enabled source adapter ──► listings (upserted by source + external id)
      │
      ├─ findMatch   listing vs. active specs      → match, or the reason it isn't one
      │              (anything unknown about the listing = never a match)
      ├─ decide      guardrails + order sizing     → auto_buy | queue | blocked
      ├─ placeOrder  (api sources only)            → order row, listing purchased
      ├─ clear out stale marketplace listings
      └─ one text digest per scan (mock outbox)
```

- **Landed cost per unit** = (lot price + shipping) ÷ units in the lot. Specs are judged on this, not the sticker price.
- **Order sizing** fills the spec's remaining target, never past its per-order unit limit, then shrinks to fit the per-order and weekly dollar caps.
- **Auto-buy only happens when all of these are true:** auto-buy is on, buying isn't paused, the source has an ordering API, that source has been trusted for auto-buy, and the order fits the weekly cap. Anything else goes to the queue with the reason.
- **Approvals re-check the guardrails** at the moment someone taps Approve, since spend may have changed since the listing was queued.
- **Approving claims the listing first.** The check and the claim are one database write, so two people tapping Approve on the same listing place one order, not two.
- **Promised units count toward a spec's target** the same way, so open approvals can't push a spec past what Nick wants on hand.
- **"I bought it" still works after an approval expires.** The money is already spent, so the order is recorded even if it goes past the weekly cap, with a warning and a line in the activity feed.
- **Promised money counts against the weekly cap.** An order being placed, or an approved buy waiting on someone to check out, holds its total until it's bought, marked "Didn't buy", fails, or expires (24 hours by default, set in Settings). Two approvals can't squeeze past the cap together, and the agent's auto-buy sees the same holds.
- **Pending matches expire** after the configured window (listings sell).
- Worker and web app are separate processes sharing one SQLite file (WAL mode). A lock row keeps two scans from overlapping.

### Code map

| Path | |
| --- | --- |
| `src/engine/match.ts` | Pure spec matching and the "why not" explanations |
| `src/engine/decide.ts` | Pure guardrails and order sizing |
| `src/engine/scan.ts` | The agent loop: fetch, match, decide, buy/queue, notify |
| `src/engine/purchasing.ts` | Approve / skip / mark-purchased, shared by every UI path |
| `src/engine/holds.ts` | Money held against the weekly cap by in-flight and approved-but-unbought orders |
| `src/engine/sources/` | Source adapter interface, mock adapters, registry, and which sources are on (`selection.ts`) |
| `src/engine/sources/ebay/` | eBay: sign-in, API client, title reader (`parse.ts`), adapter, settings in `config.ts`, saved responses in `__fixtures__/` |
| `src/engine/cleanup.ts` | Deletes stale marketplace listings at the end of each scan |
| `src/db/schema.ts` | Drizzle schema (single source of truth) |
| `drizzle/` | Generated SQL migrations, applied on boot |
| `src/data/loaders.ts` | Read-side queries for the pages |
| `src/app/actions.ts` | Server actions (all writes from the UI) |
| `scripts/worker.ts` | The always-on agent process |

## Changing the schema

Edit `src/db/schema.ts`, then:

```bash
npm run db:generate   # writes a new SQL migration to drizzle/
```

The app applies pending migrations on next boot. Don't hand-edit the database.

## Before this goes live

- **Real specs from Nick:** sizes, materials, thread counts, conditions, price limits, target quantities. Edit them in the app or in `src/db/seed.ts`.
- **eBay, before it's switched on for real:**
  - Production API keys. Before eBay activates them, opt out of marketplace account-deletion notifications in the developer portal ("Not persisting eBay data"). The app stores no seller names or ids to keep that true.
  - Run `npm run ebay:check` and act on what it says (search access, call limit, category ids).
  - Read eBay's API License Agreement, in particular data freshness, storage and mixing eBay content with other sources.
  - Replace the hand-written fixtures in `src/engine/sources/ebay/__fixtures__/` with real captured responses, and tune the title reader against `npm run ebay:report`.
- **More real sources:** implement `SourceAdapter` for each one (any B2B supplier with an ordering API) and register it in `src/engine/sources/index.ts`. Retail and liquidation sites stay manual-checkout; no bot checkout.
- **Auth:** replace the Nick/Jake cookie switcher (`src/lib/session.ts`) with Clerk or Supabase auth, two invited users.
- **Database:** move from SQLite to Postgres/Supabase. The Drizzle schema ports with a dialect change.
- **Notifications:** swap the mock outbox for Twilio SMS / email.
- **Hosting:** web app on Vercel; the worker as a small always-on process (Railway, Render or a VPS), not a serverless function.
- **Payment:** a dedicated card with its own limit for any source that auto-buys.
- **Interrupted orders (before any auto-ordering source goes live):** if the app crashes or the connection drops while an order is being placed with a supplier's API, we can't tell whether it went through, and an order that did go through is never recorded. Today the listing is marked expired with a note to check the supplier. Before a real `api` source is switched on, every order needs an idempotency key sent to the supplier, plus a reconcile step that asks the supplier what happened to any order left mid-flight.
