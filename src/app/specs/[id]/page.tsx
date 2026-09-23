import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SpecForm } from "@/components/spec-form";
import { Card } from "@/components/ui";
import { loadSpec } from "@/data/loaders";

export const metadata: Metadata = { title: "Edit spec" };

export default async function EditSpecPage({ params }: PageProps<"/specs/[id]">) {
  const { id } = await params;
  const spec = await loadSpec(Number(id));
  if (!spec) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{spec.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Changes apply to new listings from the next scan. Anything already queued keeps its current decision.
        </p>
      </div>
      <Card>
        <SpecForm spec={spec} />
      </Card>
    </div>
  );
}
