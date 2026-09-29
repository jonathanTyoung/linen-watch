import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ListingCard } from "@/components/listing-card";
import { Card, Empty, SectionHeader, cx } from "@/components/ui";
import { loadQueue } from "@/data/loaders";
import { CONDITIONS, LISTING_STATUSES, MATERIALS, label, type ListingStatus } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Queue" };

const EMPTY: Record<ListingStatus, string> = {
  pending: "Nothing waiting on approval.",
  ordering: "No orders being placed right now.",
  awaiting_checkout: "No approved buys waiting on checkout.",
  purchased: "Nothing bought yet.",
  rejected: "Nothing skipped.",
  blocked: "Nothing blocked by the guardrails.",
  expired: "Nothing expired.",
  unmatched: "No listings checked yet. Run a scan from the dashboard.",
};

const HINT: Record<ListingStatus, string> = {
  pending: "Matched a spec but needs a person: auto-buy is off, the source isn't trusted yet, or it would break a cap.",
  ordering: "An order is being placed right now. Its total already counts against the weekly cap.",
  awaiting_checkout:
    "Approved, but the site has no ordering API. Buy it there, then mark it here. Counts against the weekly cap until it's bought, marked not bought, or expires.",
  purchased: "Bought by the agent or approved by Nick or Jake.",
  rejected: "Skipped by a person.",
  blocked: "Matched a spec, but no order could fit the per-order limits.",
  expired: "Went stale before anyone acted, or the order failed at checkout.",
  unmatched: "Everything the agent looked at that didn't fit a spec, and why. Useful for tuning specs.",
};

export default async function QueuePage({ searchParams }: PageProps<"/queue">) {
  const sp = await searchParams;
  const requested = typeof sp.status === "string" ? sp.status : "pending";
  const status: ListingStatus = requested in LISTING_STATUSES ? (requested as ListingStatus) : "pending";
  const { statuses, counts, items } = await loadQueue(status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm text-muted">Every listing the agent has seen, by what happened to it.</p>
        </div>
        <AutoRefresh />
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Listing status">
        {statuses.map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/queue" : `/queue?status=${s}`}
            role="tab"
            aria-selected={s === status}
            className={cx(
              "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition",
              s === status ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {LISTING_STATUSES[s]}
            <span className="tabular font-mono opacity-80">{counts[s]}</span>
          </Link>
        ))}
      </div>

      <Card>
        <SectionHeader title={LISTING_STATUSES[status]} hint={HINT[status]} />
        {items.length === 0 ? (
          <Empty>{EMPTY[status]}</Empty>
        ) : status === "unmatched" ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Listing</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Landed / unit</th>
                  <th className="px-5 py-2 font-medium">Why it didn&apos;t match</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-ink">{l.title}</div>
                      <div className="text-muted">
                        {label(MATERIALS, l.material)} · {label(CONDITIONS, l.condition)} · seen {timeAgo(l.lastSeenAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{l.source.name}</td>
                    <td className="tabular px-3 py-2.5 text-right font-mono">{formatCents(l.unitCents)}</td>
                    <td className="px-5 py-2.5 text-muted">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {items.map((item) => (
              <ListingCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
