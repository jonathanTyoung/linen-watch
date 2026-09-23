import type { Metadata } from "next";
import { SpecForm } from "@/components/spec-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "New spec" };

export default function NewSpecPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New spec</h1>
        <p className="mt-1 text-sm text-muted">Describe one linen J&amp;N stocks and the most it&apos;s worth per unit.</p>
      </div>
      <Card>
        <SpecForm />
      </Card>
    </div>
  );
}
