import type { ListingView } from "@/data/loaders";
import { CONDITIONS, LISTING_STATUSES, MATERIALS, actorLabel, label, type ListingStatus } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { timeAgo } from "@/lib/time";
import { EBAY_SOURCE_ID } from "@/engine/sources/selection";
import { ListingActions } from "./listing-actions";
import { Pill, cx } from "./ui";

const statusTone: Record<ListingStatus, "neutral" | "accent" | "good" | "warn" | "danger"> = {
  pending: "warn",
  ordering: "accent",
  awaiting_checkout: "accent",
  purchased: "good",
  rejected: "neutral",
  blocked: "danger",
  expired: "neutral",
  unmatched: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone[status as ListingStatus] ?? "neutral"}>{label(LISTING_STATUSES, status)}</Pill>;
}

export function ListingCard({ item, compact = false }: { item: ListingView; compact?: boolean }) {
  const underBy = item.spec && item.unitCents != null ? item.spec.maxUnitPriceCents - item.unitCents : null;
  const onEbay = item.source.id === EBAY_SOURCE_ID;
  const approveLabel =
    item.source.purchaseMethod === "api"
      ? `Approve & order${item.proposal ? ` · ${formatCents(item.proposal.totalCents)}` : ""}`
      : "Approve";

  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-xl border border-line bg-surface p-4",
        item.status === "pending" && "border-l-4 border-l-warn",
        item.status === "awaiting_checkout" && "border-l-4 border-l-accent",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-sm font-semibold leading-snug">{item.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {item.source.name}
            {item.spec ? <> · for <span className="text-ink">{item.spec.name}</span></> : null}
            {" · "}seen {timeAgo(item.firstSeenAt)}
          </p>
        </div>
        <StatusPill status={item.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Landed / unit</dt>
          <dd className="tabular font-mono text-sm font-semibold">
            {item.unitCents != null ? formatCents(item.unitCents) : "—"}
            {underBy != null && underBy >= 0 ? (
              <span className="ml-1 text-[11px] font-medium text-good">−{formatCents(underBy)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Lot</dt>
          <dd className="tabular font-mono">
            {item.lotSize ?? "?"} × {item.lotsAvailable} avail
          </dd>
          {/* eBay's search doesn't say how many the seller has, so we plan for one lot. */}
          {onEbay ? <dd className="text-[11px] text-muted">More may be available on eBay</dd> : null}
        </div>
        <div>
          <dt className="text-muted">Lot price + ship</dt>
          <dd className="tabular font-mono">
            {formatCents(item.lotPriceCents)} +{" "}
            {item.shippingCents != null ? formatCents(item.shippingCents) : "shipping not listed"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{item.status === "purchased" ? "Bought" : "Proposed order"}</dt>
          <dd className="tabular font-mono">
            {item.proposal ? `${item.proposal.units} units · ${formatCents(item.proposal.totalCents)}` : "—"}
          </dd>
        </div>
      </dl>

      {!compact ? (
        <div className="flex flex-wrap gap-1.5">
          {item.material ? <Pill>{label(MATERIALS, item.material)}</Pill> : null}
          {item.threadCount ? <Pill>{item.threadCount} TC</Pill> : null}
          {item.condition ? <Pill>{label(CONDITIONS, item.condition)}</Pill> : null}
          <Pill>{item.source.purchaseMethod === "api" ? "Orders via API" : "Manual checkout"}</Pill>
        </div>
      ) : null}

      {item.note ? (
        <p className="text-xs text-muted">
          {item.note}
          {item.decidedBy && item.status !== "pending" && !item.note.includes(actorLabel(item.decidedBy))
            ? ` · ${actorLabel(item.decidedBy)}`
            : ""}
        </p>
      ) : null}

      <ListingActions
        listingId={item.id}
        status={item.status}
        url={item.url}
        sourceName={item.source.name}
        approveLabel={approveLabel}
        boughtLate={item.status === "expired" && item.checkoutExpiredAt != null}
      />
    </article>
  );
}
