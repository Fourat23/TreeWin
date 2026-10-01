"use client";

import {
  Archive,
  Camera,
  Download,
  FileJson,
  FileSpreadsheet,
  FlaskConical,
  HardDrive,
  History,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { withWorkspace } from "@/lib/workspace";
import { purgeArchiveEntryAction } from "@/server/actions/correction-actions";
import {
  createBackupAction,
  importWorkspaceAction,
  initializeDemoAction,
  previewImportAction,
  resetDemoAction,
  resetRealAction,
  restoreBackupAction,
  restorePreviousSnapshotAction,
} from "@/server/actions/workspace-actions";
import type { ImportPreview } from "@/server/services/backup-service";
import type { BackupInfo } from "@/server/state/repository";

export interface StorageInfo {
  statePath: string;
  backupsPath: string;
  exists: boolean;
  savedAt: string | null;
  strategyVersion: string;
  strategyRevision: number;
  counts: { branches: number; tickets: number; bankTransactions: number; candidates: number };
  keepAutomatic: number;
}

export interface ArchiveSummary {
  id: string;
  at: number;
  label: string;
  branches: number;
  tickets: number;
  bankCents: number;
}

type Danger =
  | "reset-real"
  | "reset-demo"
  | "init-demo"
  | { purgeArchive: ArchiveSummary }
  | { restore: BackupInfo };

export function DataPanel({
  storage,
  backups,
  archive,
  history,
}: {
  storage: StorageInfo;
  backups: BackupInfo[];
  archive: ArchiveSummary[];
  history: { id: number; changedAt: number; note: string | null; revision: number }[];
}) {
  const f = useFormat();
  const { workspace, notifyMutation } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [backupNote, setBackupNote] = useState("");
  const [importFile, setImportFile] = useState<{ name: string; content: string } | null>(null);
  const [asCopy, setAsCopy] = useState(false);
  const [preview, setPreview] = useState<(ImportPreview & { targetHasData: boolean }) | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [danger, setDanger] = useState<Danger | null>(null);
  const [typed, setTyped] = useState("");

  const run = <T,>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>,
    success: (data: T) => string,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(success(result.data));
      setDanger(null);
      setTyped("");
      notifyMutation();
    });

  function loadPreview(file: { name: string; content: string }, copy: boolean) {
    startTransition(async () => {
      const result = await previewImportAction(workspace, { content: file.content, asCopy: copy });
      if (!result.ok) {
        setProblems(
          (result.details?.problems as string[] | undefined)?.length
            ? (result.details?.problems as string[])
            : [result.message],
        );
        setPreview(null);
        return;
      }
      setProblems(null);
      setPreview(result.data);
    });
  }

  function runImport() {
    if (!importFile || !preview) return;
    run(
      () => importWorkspaceAction(workspace, { content: importFile.content, asCopy, confirmation }),
      (p) =>
        `Imported into ${workspace}: ${p.counts.branches} branches, ${p.counts.tickets} tickets`,
    );
    setImportFile(null);
    setPreview(null);
    setConfirmation("");
  }

  const dangerTitle =
    danger === "reset-real"
      ? "Reset the REAL workspace?"
      : danger === "reset-demo"
        ? "Reset DEMO data?"
        : danger === "init-demo"
          ? "Initialize DEMO data?"
          : danger && "purgeArchive" in danger
            ? "Permanently delete archived records?"
            : danger && "restore" in danger
              ? "Restore this snapshot?"
              : "";
  const typedRequired =
    danger === "reset-real"
      ? "RESET REAL"
      : danger && typeof danger === "object" && "purgeArchive" in danger
        ? "DELETE"
        : null;

  function confirmDanger() {
    if (!danger) return;
    if (danger === "reset-real")
      run(
        () => resetRealAction(workspace, typed),
        () => "REAL workspace reset (snapshot kept)",
      );
    else if (danger === "reset-demo")
      run(
        () => resetDemoAction(workspace),
        (s) => `DEMO reset: ${s.branches} branches, ${s.tickets} tickets`,
      );
    else if (danger === "init-demo")
      run(
        () => initializeDemoAction(workspace),
        (s) => `DEMO initialized: ${s.branches} branches, ${s.tickets} tickets`,
      );
    else if ("purgeArchive" in danger)
      run(
        () =>
          purgeArchiveEntryAction(workspace, {
            archiveId: danger.purgeArchive.id,
            confirmation: typed,
          }),
        (label) => label,
      );
    else
      run(
        () => restoreBackupAction(workspace, danger.restore.id),
        () => `Restored ${danger.restore.id}`,
      );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Workspace storage"
          description="Validated JSON files on this machine — written atomically, never in place."
        />
        <CardBody className="flex flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2" data-testid="storage-path">
            <HardDrive className="size-4 text-fg-subtle" aria-hidden />
            <span className="text-fg-muted">Workspace storage:</span>
            <strong>{workspace}</strong>
            <span className="text-fg-subtle">—</span>
            <code className="font-mono text-fg">{storage.statePath}</code>
            {!storage.exists ? <Badge>not created yet</Badge> : null}
          </p>
          <p className="text-xs text-fg-subtle">
            Snapshots in <code className="font-mono">{storage.backupsPath}</code> · strategy{" "}
            {storage.strategyVersion} (revision {storage.strategyRevision}) ·{" "}
            {storage.counts.branches} branches · {storage.counts.tickets} tickets ·{" "}
            {storage.counts.bankTransactions} BANK entries · {storage.counts.candidates} candidates
            {storage.savedAt ? ` · saved ${f.dateTime(Date.parse(storage.savedAt))}` : ""}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Backups & snapshots"
          description={`An automatic snapshot is taken before every change that can be undone (the ${storage.keepAutomatic} newest are kept). Manual backups are never deleted.`}
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              value={backupNote}
              onChange={(e) => setBackupNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-56"
              aria-label="Backup note"
            />
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(
                  () => createBackupAction(workspace, backupNote),
                  (info) => `Manual backup ${info.id} created`,
                )
              }
            >
              <Camera /> Create manual backup
            </Button>
            <Button
              disabled={pending || backups.length === 0}
              onClick={() =>
                run(
                  () => restorePreviousSnapshotAction(workspace),
                  (id) => `Restored previous snapshot ${id}`,
                )
              }
            >
              <RotateCcw /> Restore previous snapshot
            </Button>
          </div>
          {backups.length === 0 ? (
            <p className="text-sm text-fg-subtle">No snapshot yet for {workspace}.</p>
          ) : (
            <ul
              className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border"
              data-testid="backup-list"
            >
              {backups.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Badge
                        tone={
                          b.kind === "MANUAL" ? "info" : b.kind === "EXPORT" ? "mature" : "neutral"
                        }
                      >
                        {b.kind}
                      </Badge>
                      <span className="truncate">{b.reason || "Snapshot"}</span>
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {b.createdAt ? f.dateTime(b.createdAt) : b.id} ·{" "}
                      {(b.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setDanger({ restore: b })}
                  >
                    <History /> Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Export & import"
          description={`Files carry their workspace identity. A DEMO file can never be imported into REAL.`}
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={withWorkspace("/api/export/backup", workspace)} download>
                <FileJson /> Export {workspace} (JSON)
              </a>
            </Button>
            {(["tickets", "branches", "bank"] as const).map((kind) => (
              <Button key={kind} variant="ghost" asChild>
                <a href={withWorkspace(`/api/export/csv/${kind}`, workspace)} download>
                  <FileSpreadsheet />{" "}
                  {kind === "bank" ? "BANK" : kind.charAt(0).toUpperCase() + kind.slice(1)} CSV
                </a>
              </Button>
            ))}
          </div>
          <div className="rounded-xl border border-dashed border-border-strong p-4">
            <p className="text-sm font-medium">Import into {workspace}</p>
            <p className="mt-1 text-xs text-fg-subtle">
              Strictly validated (format, references, ledger). The current {workspace} state is
              snapshotted first, so an import can be undone. V1.0 exports are migrated
              automatically.
            </p>
            {workspace === "DEMO" ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={asCopy}
                  onChange={(e) => {
                    setAsCopy(e.target.checked);
                    if (importFile) loadPreview(importFile, e.target.checked);
                  }}
                />
                Import a REAL file into DEMO as a copy (for experiments)
              </label>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              data-testid="import-file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const next = { name: file.name, content: await file.text() };
                setImportFile(next);
                loadPreview(next, asCopy);
              }}
            />
            <Button className="mt-3" onClick={() => fileRef.current?.click()} disabled={pending}>
              <Upload /> Choose file…
            </Button>
            {problems ? (
              <div
                className="mt-3 rounded-lg border border-critical/40 bg-critical/5 p-3 text-sm"
                role="alert"
              >
                <p className="font-medium text-critical">Import rejected</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
                  {problems.slice(0, 10).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview && importFile ? (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                <p>
                  <span className="font-medium">{importFile.name}</span> —{" "}
                  {preview.source === "LEGACY" ? "V1.0 export" : `${preview.source} file`}
                  {preview.asCopy ? " (imported as a DEMO copy)" : ""}
                </p>
                <p className="text-fg-muted">
                  {preview.counts.branches} branches · {preview.counts.tickets} tickets ·{" "}
                  {preview.counts.bankTransactions} BANK entries · {preview.counts.events} events ·{" "}
                  {preview.counts.candidates} candidates
                </p>
                {preview.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning">
                    {w}
                  </p>
                ))}
                {preview.targetHasData ? (
                  <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
                    {workspace} already contains data. Type{" "}
                    <strong className="text-fg">REPLACE</strong> to confirm.
                    <Input
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      className="w-48 font-mono"
                      aria-label="Confirmation"
                    />
                  </label>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    onClick={runImport}
                    disabled={pending || (preview.targetHasData && confirmation !== "REPLACE")}
                  >
                    <Download /> Import into {workspace}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPreview(null);
                      setImportFile(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {archive.length > 0 ? (
        <Card>
          <CardHeader
            title="Archived corrections"
            description="Records removed by “delete from this point” (archive mode). Kept out of the ledger."
          />
          <CardBody>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {archive.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Archive className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                      <span className="truncate">{a.label}</span>
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {f.dateTime(a.at)} · {a.tickets} ticket(s) · {a.branches} branch(es) · BANK{" "}
                      {f.money(a.bankCents)}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setDanger({ purgeArchive: a })}>
                    <Trash2 /> Purge
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <CardHeader
            title="Settings history"
            description="Previous versions are kept on every save"
          />
          <CardBody>
            <ul className="flex flex-col gap-1 text-sm text-fg-muted">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span>
                    {h.note ?? "Settings changed"}{" "}
                    <span className="text-xs text-fg-subtle">(was revision {h.revision})</span>
                  </span>
                  <span className="num text-xs text-fg-subtle">{f.dateTime(h.changedAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {workspace === "DEMO" ? (
        <Card className="border-warning/30">
          <CardHeader
            title="DEMO data"
            description="Only data/demo/state.json is ever written here. REAL is never touched."
          />
          <CardBody className="flex flex-wrap gap-2">
            <Button
              onClick={() => setDanger("init-demo")}
              disabled={storage.counts.branches > 0 || storage.counts.candidates > 0}
            >
              <FlaskConical /> Initialize demo data
            </Button>
            <Button variant="danger" onClick={() => setDanger("reset-demo")}>
              <RotateCcw /> Reset DEMO
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card className="border-critical/30">
          <CardHeader
            title="Danger zone"
            description="Deletes every REAL branch, ticket, BANK entry and candidate. Settings are kept; a snapshot is taken first."
          />
          <CardBody>
            <Button variant="danger" onClick={() => setDanger("reset-real")}>
              <Trash2 /> Reset REAL workspace…
            </Button>
          </CardBody>
        </Card>
      )}

      <Dialog
        open={danger !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDanger(null);
            setTyped("");
          }
        }}
        title={dangerTitle}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDanger(null)}>
              Cancel
            </Button>
            <Button
              variant={danger === "init-demo" ? "primary" : "danger"}
              onClick={confirmDanger}
              disabled={pending || (typedRequired !== null && typed.trim() !== typedRequired)}
              data-testid="confirm-danger"
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-fg-muted">
          {danger === "reset-real" ? (
            <p>
              Every REAL record is deleted. The current state is saved as a snapshot first, so this
              can be undone.
            </p>
          ) : danger === "reset-demo" ? (
            <p>
              data/demo/state.json is recreated with fresh demonstration data. Nothing in REAL
              changes.
            </p>
          ) : danger === "init-demo" ? (
            <p>
              Fills the empty DEMO workspace with demonstration branches, tickets and candidates.
            </p>
          ) : danger && "purgeArchive" in danger ? (
            <p>
              “{danger.purgeArchive.label}” will be removed from the file for good (older snapshots
              still contain it).
            </p>
          ) : danger && "restore" in danger ? (
            <p>
              {workspace} returns to the state saved{" "}
              {danger.restore.createdAt ? f.dateTime(danger.restore.createdAt) : danger.restore.id}.
              The current state is snapshotted first, so the restore can be undone.
            </p>
          ) : null}
          {typedRequired ? (
            <label className="flex flex-col gap-1.5 text-xs">
              Type <strong className="font-mono text-fg">{typedRequired}</strong> to confirm
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="font-mono"
                autoComplete="off"
                data-testid="danger-typed"
              />
            </label>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
