"use client";

import {
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import {
  importBackupAction,
  previewBackupAction,
  resetDemoDataAction,
  wipeDataAction,
} from "@/server/actions/data-actions";

interface Preview {
  content: string;
  fileName: string;
  counts: Record<string, number>;
  exportedAt: string;
  databaseEmpty: boolean;
}

export function DataPanel({
  dbPath,
  isDev,
  history,
}: {
  dbPath: string;
  isDev: boolean;
  history: { id: number; changedAt: number; note: string | null }[];
}) {
  const f = useFormat();
  const { notifyMutation } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [danger, setDanger] = useState<"reset" | "wipe" | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    const content = await file.text();
    startTransition(async () => {
      const result = await previewBackupAction(content);
      if (!result.ok) {
        setProblems((result.details?.problems as string[] | undefined) ?? [result.message]);
        setPreview(null);
        return;
      }
      setProblems(null);
      setPreview({ content, fileName: file.name, ...result.data });
    });
  }

  function runImport() {
    if (!preview) return;
    startTransition(async () => {
      const result = await importBackupAction({ content: preview.content, confirmation });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Backup imported", {
        description: result.data.safetyBackup
          ? `Previous data saved to ${result.data.safetyBackup}`
          : undefined,
      });
      setPreview(null);
      setConfirmation("");
      notifyMutation();
    });
  }

  function runDanger() {
    const action = danger === "reset" ? resetDemoDataAction : wipeDataAction;
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.message);
      else toast.success(danger === "reset" ? "Demo data reloaded" : "Ledger wiped");
      setDanger(null);
      notifyMutation();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Backup & export"
          description="Everything stays on this machine. Keep regular JSON backups."
        />
        <CardBody className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-xs text-fg-subtle">
            <Database className="size-3.5" /> Database:{" "}
            <code className="font-mono text-fg-muted">{dbPath}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" asChild>
              <a href="/api/export/backup" download>
                <FileJson /> Export backup (JSON)
              </a>
            </Button>
            {(["tickets", "branches", "bank"] as const).map((kind) => (
              <Button key={kind} asChild>
                <a href={`/api/export/csv/${kind}`} download>
                  <FileSpreadsheet />{" "}
                  {kind === "bank" ? "BANK" : kind.charAt(0).toUpperCase() + kind.slice(1)} CSV
                </a>
              </Button>
            ))}
          </div>
          <div className="rounded-xl border border-dashed border-border-strong p-4">
            <p className="text-sm font-medium">Import a backup</p>
            <p className="mt-1 text-xs text-fg-subtle">
              Strictly validated (format, references, and every branch capital re-explained by its
              events). Importing replaces the current ledger — never silently: a safety copy of the
              current data is written first.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
            <Button className="mt-3" onClick={() => fileRef.current?.click()} disabled={pending}>
              <Upload /> Choose backup file…
            </Button>
            {problems ? (
              <div
                className="mt-3 rounded-lg border border-critical/40 bg-critical/5 p-3 text-sm"
                role="alert"
              >
                <p className="font-medium text-critical">Backup rejected</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
                  {problems.slice(0, 10).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview ? (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                <p>
                  <span className="font-medium">{preview.fileName}</span> — exported{" "}
                  {preview.exportedAt}
                </p>
                <p className="text-fg-muted">
                  {preview.counts.branches} branches · {preview.counts.bets} tickets ·{" "}
                  {preview.counts.bankTransactions} BANK transfers · {preview.counts.branchEvents}{" "}
                  events · {preview.counts.candidates} candidates
                </p>
                {!preview.databaseEmpty ? (
                  <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
                    The current database is not empty. Type{" "}
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
                    disabled={pending || (!preview.databaseEmpty && confirmation !== "REPLACE")}
                  >
                    <Download /> Import
                  </Button>
                  <Button variant="ghost" onClick={() => setPreview(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

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
                  <span>{h.note ?? "Settings changed"}</span>
                  <span className="num text-xs text-fg-subtle">{f.dateTime(h.changedAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {isDev ? (
        <Card className="border-critical/30">
          <CardHeader
            title="Development tools"
            description="Only available when running `npm run dev`. A safety backup is written first."
          />
          <CardBody className="flex flex-wrap gap-2">
            <Button onClick={() => setDanger("reset")}>
              <RotateCcw /> Reset demo data
            </Button>
            <Button variant="danger" onClick={() => setDanger("wipe")}>
              <Trash2 /> Wipe all data
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Dialog
        open={danger !== null}
        onOpenChange={(o) => (!o ? setDanger(null) : undefined)}
        title={danger === "reset" ? "Reset demo data?" : "Wipe all data?"}
        description={
          danger === "reset"
            ? "The ledger is replaced by the demo dataset. Strategy settings are kept."
            : "Every branch, ticket, BANK transfer, event and candidate is removed. Strategy settings are kept."
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDanger(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={runDanger} disabled={pending}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          A JSON copy of the current data is saved in the backups folder first.
        </p>
      </Dialog>
    </div>
  );
}
