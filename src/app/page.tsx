import Link from "next/link";
import { ActivityFeed, TextsPanel } from "@/components/activity";
import { AutoRefresh } from "@/components/auto-refresh";
import { ListingCard } from "@/components/listing-card";
import { ScanButton } from "@/components/scan-button";
import { Card, Empty, Pill, Progress, SectionHeader, Stat, cx } from "@/components/ui";
import { loadDashboard } from "@/data/loaders";
import { formatCents, formatCentsWhole } from "@/lib/money";
import { timeAgo } from "@/lib/time";

export default async function DashboardPage() {
  const d = await loadDashboard();
  const { settings } = d;
  const capPct = settings.weeklyCapCents ? d.weekSpendCents / settings.weeklyCapCents : 0;
  const pendingCount = d.needsCall.filter((l) => l.status === "pending").length;
  const checkoutCount = d.needsCall.length - pendingCount;

  const mode = settings.paused
    ? { tone: "danger" as const, label: "Buying paused", detail: "Scans keep running; nothing gets bought until you resume." }
    : settings.autoBuyEnabled
      ? { tone: "good" as const, label: "Auto-buy on", detail: "Matches from trusted sources are bought within your caps." }
      : { tone: "neutral" as const, label: "Auto-buy off", detail: "Every match waits for a tap. Turn on auto-buy in Settings." };

  return (
    <div className="flex flex-col gap-6">
      {/* Agent status */}
      <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={mode.tone}>{mode.label}</Pill>
            <Pill tone={d.workerAlive ? "good" : "neutral"}>
              {d.workerAlive ? `Agent running · every ${settings.scanIntervalSeconds}s` : "Agent not running"}
            </Pill>
            <AutoRefresh />
          </div>
          <p className="text-sm text-muted">
            {mode.detail}{" "}
            {d.lastScan ? <>Last scan {timeAgo(d.lastScan.startedAt)}.</> : <>No scans yet.</>}
            {!d.workerAlive ? (
              <>
                {" "}
                Start it with <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">npm run worker</code>, or
                scan by hand.
              </>
            ) : null}
          </p>
        </div>
        <ScanButton />
      </Card>

      {/* Numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Needs your call"
          value={pendingCount}
          tone={pendingCount ? "warn" : undefined}
          sub={checkoutCount ? `+ ${checkoutCount} awaiting checkout` : "approvals waiting"}
        />
        <Stat label="Bought this week" value={d.weekUnits} sub={`units · ${formatCents(d.weekSpendCents)}`} />
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <span className="text-xs font-medium text-muted">Weekly cap</span>
          <span className="tabular font-mono text-2xl font-semibold leading-tight">
            {formatCentsWhole(d.weekSpendCents)}
            <span className="text-base font-normal text-muted"> / {formatCentsWhole(settings.weeklyCapCents)}</span>
          </span>
          <Progress value={d.weekSpendCents} max={settings.weeklyCapCents} tone={capPct > 0.85 ? "warn" : "accent"} />
        </div>
        <Stat label="Listings checked" value={d.seen24h} sub="last 24 hours" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Queue */}
          <Card>
            <SectionHeader
              title="Needs your call"
              hint="Matches waiting on an approval, plus approved buys that need a person to check out."
              action={
                <Link href="/queue" className="text-sm font-medium text-accent hover:underline">
                  Full queue →
                </Link>
              }
            />
            {d.needsCall.length ? (
              <div className="flex flex-col gap-3">
                {d.needsCall.slice(0, 6).map((item) => (
                  <ListingCard key={item.id} item={item} />
                ))}
                {d.needsCall.length > 6 ? (
                  <Link href="/queue" className="text-center text-sm text-accent hover:underline">
                    {d.needsCall.length - 6} more in the queue
                  </Link>
                ) : null}
              </div>
            ) : (
              <Empty>Nothing waiting. Run a scan, or leave the agent running and matches will show up here.</Empty>
            )}
          </Card>

          {/* Stock */}
          <Card>
            <SectionHeader
              title="Stock toward targets"
              hint="Units bought through Linen Watch against each spec's target. Specs stop matching once they're full."
              action={
                <Link href="/specs" className="text-sm font-medium text-accent hover:underline">
                  Edit specs →
                </Link>
              }
            />
            <ul className="flex flex-col gap-4">
              {d.stock.map(({ spec, owned }) => {
                const full = owned >= spec.targetUnits;
                return (
                  <li key={spec.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{spec.name}</span>
                      <span className={cx("tabular font-mono text-xs", full ? "text-good" : "text-muted")}>
                        {owned} / {spec.targetUnits}
                        {full ? " · full" : ""}
                      </span>
                    </div>
                    <Progress value={owned} max={spec.targetUnits} tone={full ? "good" : "accent"} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <SectionHeader title="Texts to Nick" hint="What the text alerts would say. Nothing is actually sent." />
            <TextsPanel texts={d.texts} phone={settings.notifyPhone} />
          </Card>
          <Card>
            <SectionHeader title="Activity" />
            <ActivityFeed events={d.events} />
          </Card>
        </div>
      </div>
    </div>
  );
}
