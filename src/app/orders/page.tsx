import type { Metadata } from "next";
import { Card, Empty, Pill, SectionHeader, Stat } from "@/components/ui";
import { loadOrders } from "@/data/loaders";
import { actorLabel } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Orders" };

function howBought(mode: string, placedBy: string) {
  if (mode === "auto") return <Pill tone="good">Auto-bought</Pill>;
  if (mode === "approved") return <Pill tone="accent">Approved by {actorLabel(placedBy)}</Pill>;
  return <Pill>Checked out by {actorLabel(placedBy)}</Pill>;
}

export default async function OrdersPage() {
  const { orders, weekSpendCents, weekUnits } = await loadOrders();
  const totalCents = orders.reduce((s, o) => s + o.totalCents, 0);
  const totalUnits = orders.reduce((s, o) => s + o.units, 0);
  const avgUnit = totalUnits ? Math.round(totalCents / totalUnits) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted">Everything bought through Linen Watch. In mock mode, none of these are real.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="This week" value={formatCents(weekSpendCents)} sub={`${weekUnits} units`} />
        <Stat label="All time" value={formatCents(totalCents)} sub={`${totalUnits} units`} />
        <Stat label="Average landed / unit" value={avgUnit ? formatCents(avgUnit) : "—"} sub="across all orders" />
        <Stat label="Orders" value={orders.length} sub={`${orders.filter((o) => o.mode === "auto").length} by the agent`} />
      </div>

      <Card>
        <SectionHeader title="Order history" />
        {orders.length === 0 ? (
          <Empty>No orders yet. Approve something in the queue, or turn on auto-buy in Settings.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 font-medium">How</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(o.createdAt)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{o.spec.name}</div>
                      <div className="text-xs text-muted">{o.listing.title}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {o.source.name}
                      {o.externalRef ? <div className="font-mono text-[11px]">{o.externalRef}</div> : null}
                    </td>
                    <td className="tabular px-3 py-3 text-right font-mono">{o.units}</td>
                    <td className="tabular px-3 py-3 text-right font-mono">
                      {formatCents(o.totalCents)}
                      <div className="text-[11px] text-muted">{formatCents(Math.round(o.totalCents / o.units))}/unit</div>
                    </td>
                    <td className="px-5 py-3">{howBought(o.mode, o.placedBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
