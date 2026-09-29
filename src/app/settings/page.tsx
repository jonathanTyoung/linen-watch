import type { Metadata } from "next";
import { ResetDemo } from "@/components/reset-demo";
import { SettingsForm } from "@/components/settings-form";
import { SourceRow } from "@/components/source-row";
import { Card, SectionHeader } from "@/components/ui";
import { loadSettings } from "@/data/loaders";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { settings, sources, ebay } = await loadSettings();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Guardrails the agent can&apos;t cross, and where it looks.</p>
      </div>

      <Card>
        <SectionHeader
          title="Buying rules"
          hint="Checked on every purchase, whether the agent makes it or a person approves it."
        />
        <SettingsForm settings={settings} ebay={ebay} />
      </Card>

      <Card>
        <SectionHeader
          title="Sources"
          hint="Auto-buy is earned per source, and only possible where the site has an ordering API. Everywhere else, a person checks out."
        />
        <ul className="-my-4 divide-y divide-line">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeader title="Demo tools" hint="For walking Nick and Jake through it from a clean start." />
        <ResetDemo />
      </Card>
    </div>
  );
}
