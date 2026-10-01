import { isAbsolute, relative } from "node:path";
import type { Metadata } from "next";
import { DataPanel } from "@/components/settings/data-panel";
import { StrategyForm } from "@/components/settings/strategy-form";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getRepository } from "@/server/state";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Settings" };

/** Paths are shown relative to the project (./data/real/state.json) when possible. */
function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : `./${rel}`;
}

export default async function SettingsPage() {
  const { workspace, state } = await loadPageState();
  const repository = getRepository();
  const paths = repository.paths(workspace);
  const [backups, exists] = await Promise.all([
    repository.listBackups(workspace),
    repository.exists(workspace),
  ]);
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Settings"
        description={`Strategy rules and data of the ${workspace} workspace. Each workspace keeps its own settings; caps are snapshotted on each branch at birth.`}
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="strategy-heading">
          <h2
            id="strategy-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase"
          >
            Strategy
          </h2>
          <StrategyForm initial={state.settings} />
        </section>
        <section aria-labelledby="data-heading">
          <h2
            id="data-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase"
          >
            Data
          </h2>
          <DataPanel
            storage={{
              statePath: displayPath(paths.state),
              backupsPath: displayPath(paths.backups),
              exists,
              savedAt: exists ? state.savedAt : null,
              strategyVersion: state.strategyVersion,
              strategyRevision: state.metadata.strategyRevision,
              counts: {
                branches: state.branches.length,
                tickets: state.bets.length,
                bankTransactions: state.bankTransactions.length,
                candidates: state.candidates.length,
              },
              keepAutomatic: state.settings.backups.keepAutomatic,
            }}
            backups={backups}
            archive={[...state.archive]
              .sort((a, b) => b.at - a.at)
              .map((a) => ({
                id: a.id,
                at: a.at,
                label: a.label,
                branches: a.branches.length,
                tickets: a.bets.length,
                bankCents: a.bankTransactions.reduce((s, t) => s + t.amountCents, 0),
              }))}
            changeLog={[...state.auditLog].reverse().slice(0, 30)}
            history={[...state.settingsHistory]
              .reverse()
              .slice(0, 8)
              .map((h) => ({
                id: h.id,
                changedAt: h.changedAt,
                note: h.note,
                revision: h.revision,
              }))}
          />
        </section>
      </div>
    </PageContainer>
  );
}
