import type { Metadata } from "next";
import { DataPanel } from "@/components/settings/data-panel";
import { StrategyForm } from "@/components/settings/strategy-form";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb, getDbPath } from "@/server/db";
import { getSettings, listSettingsHistory } from "@/server/services/settings-service";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const db = getDb();
  const settings = getSettings(db);
  const history = listSettingsHistory(db, 8).map((h) => ({
    id: h.id,
    changedAt: h.changedAt.getTime(),
    note: h.note,
  }));
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Settings"
        description="Every strategy rule lives here — nothing is hard-coded. Caps are snapshotted on each branch at birth."
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="strategy-heading">
          <h2
            id="strategy-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase"
          >
            Strategy
          </h2>
          <StrategyForm initial={settings} />
        </section>
        <section aria-labelledby="data-heading">
          <h2
            id="data-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase"
          >
            Data
          </h2>
          <DataPanel
            dbPath={getDbPath()}
            isDev={process.env.NODE_ENV !== "production"}
            history={history}
          />
        </section>
      </div>
    </PageContainer>
  );
}
