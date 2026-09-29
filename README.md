# Linen Watch

An agent that watches suppliers for white linens matching J&N Cleaners' specs, and buys them (or asks first) when the landed price per unit is under the limit. Built for Nick and Jake at J&N.

**This is the local MVP.** Every source is simulated and no real orders are placed. The buying logic, guardrails and data model are the real ones, so real sources plug in without rework.

## Run it

```bash
nvm use            # Node 22
npm install
npm run dev:all    # web app on :3000 + the agent worker, in one terminal
```

Open http://localhost:3000. The database creates itself on first boot with example specs and four mock sources.

Other ways to run:

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app only. Use **Scan now** on the dashboard to run the agent by hand. |
| `npm run worker` | The agent on its own, scanning on the interval set in Settings. |
| `npm run worker -- --once` | One scan, then exit. |
| `npm run db:reset` | Wipe the local database back to the example data. |
| `npm run db:demo` | Same, plus four scans so the queue has something in it. |
| `npm test` | Unit + integration tests for matching, guardrails and scanning. |
| `npm run build` | Production build (the real TypeScript gate). |

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
      ├─ decide      guardrails + order sizing     → auto_buy | queue | blocked
      ├─ placeOrder  (api sources only)            → order row, listing purchased
      └─ one text digest per scan (mock outbox)
```

- **Landed cost per unit** = (lot price + shipping) ÷ units in the lot. Specs are judged on this, not the sticker price.
- **Order sizing** fills the spec's remaining target, never past its per-order unit limit, then shrinks to fit the per-order and weekly dollar caps.
- **Auto-buy only happens when all of these are true:** auto-buy is on, buying isn't paused, the source has an ordering API, that source has been trusted for auto-buy, and the order fits the weekly cap. Anything else goes to the queue with the reason.
- **Approvals re-check the guardrails** at the moment someone taps Approve, since spend may have changed since the listing was queued.
- **Approving claims the listing first.** The check and the claim are one database write, so two people tapping Approve on the same listing place one order, not two.
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
| `src/engine/sources/` | Source adapter interface, mock adapters, registry |
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
- **Real sources:** implement `SourceAdapter` for each one (eBay Browse + Buy APIs, any B2B supplier with an ordering API) and register it in `src/engine/sources/index.ts`. Retail and liquidation sites stay manual-checkout; no bot checkout.
- **Auth:** replace the Nick/Jake cookie switcher (`src/lib/session.ts`) with Clerk or Supabase auth, two invited users.
- **Database:** move from SQLite to Postgres/Supabase. The Drizzle schema ports with a dialect change.
- **Notifications:** swap the mock outbox for Twilio SMS / email.
- **Hosting:** web app on Vercel; the worker as a small always-on process (Railway, Render or a VPS), not a serverless function.
- **Payment:** a dedicated card with its own limit for any source that auto-buys.
