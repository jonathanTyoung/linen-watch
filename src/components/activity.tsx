import type { EventRow, Notification } from "@/db/schema";
import { actorLabel } from "@/lib/catalog";
import { formatDateTime, timeAgo } from "@/lib/time";
import { cx } from "./ui";

const dot: Record<string, string> = {
  purchased: "bg-good",
  queued: "bg-warn",
  approved: "bg-accent",
  blocked: "bg-danger",
  order_failed: "bg-danger",
  error: "bg-danger",
  rejected: "bg-muted",
  scan: "bg-line",
};

export function ActivityFeed({ events }: { events: EventRow[] }) {
  if (!events.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ol className="flex flex-col">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 border-b border-line/70 py-2.5 last:border-0">
          <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot[e.type] ?? "bg-line")} aria-hidden />
          <div className="min-w-0 text-xs leading-relaxed">
            <p className={cx(e.type === "scan" ? "text-muted" : "text-ink")}>{e.message}</p>
            <p className="text-muted" title={formatDateTime(e.createdAt)}>
              {actorLabel(e.actor)} · {timeAgo(e.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Mock outbox. In production these go out over Twilio / email. */
export function TextsPanel({ texts, phone }: { texts: Notification[]; phone: string | null }) {
  if (!texts.length) {
    return <p className="text-sm text-muted">No texts yet. One goes out whenever a scan finds something.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {texts.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <div className="max-w-[95%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-xs leading-relaxed">
            {t.body}
          </div>
          <span className="pl-1 text-[11px] text-muted">
            To {actorLabel(t.recipient)}
            {phone ? ` ${phone}` : ""} · {timeAgo(t.createdAt)} · not actually sent
          </span>
        </div>
      ))}
    </div>
  );
}
