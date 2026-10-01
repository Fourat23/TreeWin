"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SameEventPolicy } from "@/domain/strategy/settings";
import type { Profile, ProfileRecord, Workspace } from "@/domain/types";
import { BranchDrawer } from "@/components/branch/branch-drawer";
import { CreateBranchDialog } from "@/components/branch/create-branch-dialog";
import { CorrectionDialog } from "@/components/corrections/correction-dialog";
import { CommandPalette } from "@/components/layout/command-palette";
import { NewTicketDialog, type TicketPrefill } from "@/components/tickets/new-ticket-dialog";
import { SettleDialog } from "@/components/tickets/settle-dialog";
import type { CorrectionTarget } from "@/server/services/correction-service";

export interface StrategyHints {
  oddsMinBp: number;
  oddsMaxBp: number;
  sameEventPolicy: SameEventPolicy;
  defaultProfile: Profile;
  corridors: ProfileRecord<{ minBp: number; maxBp: number }>;
  strategyVersion: string;
}

/** Last undoable change of the displayed workspace. */
export interface LastChangeInfo {
  label: string;
  at: number;
}

interface NewTicketRequest {
  branchId?: string;
  prefill?: TicketPrefill;
  candidateId?: string;
}

interface UiContextValue {
  /** Workspace displayed by this page; every action names it explicitly. */
  workspace: Workspace;
  hints: StrategyHints;
  lastChange: LastChangeInfo | null;
  dataVersion: number;
  /** Call after any successful mutation: refreshes server data and open panels. */
  notifyMutation: () => void;
  openBranch: (idOrCode: string) => void;
  closeBranch: () => void;
  selectedBranch: string | null;
  openNewTicket: (request?: NewTicketRequest) => void;
  openSettle: (betId: string) => void;
  openCreateBranch: () => void;
  openPalette: () => void;
  /** Generic destructive workflow: impact preview → snapshot → explicit confirmation. */
  openCorrection: (target: CorrectionTarget, options?: { onDone?: () => void }) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({
  workspace,
  hints,
  lastChange,
  children,
}: {
  workspace: Workspace;
  hints: StrategyHints;
  lastChange: LastChangeInfo | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dataVersion, setDataVersion] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [newTicket, setNewTicket] = useState<NewTicketRequest | null>(null);
  const [settleBetId, setSettleBetId] = useState<string | null>(null);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [correction, setCorrection] = useState<{
    target: CorrectionTarget;
    onDone?: () => void;
  } | null>(null);

  const notifyMutation = useCallback(() => {
    setDataVersion((v) => v + 1);
    router.refresh();
  }, [router]);

  const value = useMemo<UiContextValue>(
    () => ({
      workspace,
      hints,
      lastChange,
      dataVersion,
      notifyMutation,
      selectedBranch,
      openBranch: (id) => setSelectedBranch(id),
      closeBranch: () => setSelectedBranch(null),
      openNewTicket: (request) => setNewTicket(request ?? {}),
      openSettle: (betId) => setSettleBetId(betId),
      openCreateBranch: () => setCreateBranchOpen(true),
      openPalette: () => setPaletteOpen(true),
      openCorrection: (target, options) => setCorrection({ target, onDone: options?.onDone }),
    }),
    [workspace, hints, lastChange, dataVersion, notifyMutation, selectedBranch],
  );

  return (
    <UiContext.Provider value={value}>
      {children}
      <BranchDrawer branchId={selectedBranch} onClose={() => setSelectedBranch(null)} />
      <NewTicketDialog
        request={newTicket}
        onClose={() => setNewTicket(null)}
        onCreated={() => {
          setNewTicket(null);
          notifyMutation();
        }}
      />
      <SettleDialog
        betId={settleBetId}
        onClose={() => setSettleBetId(null)}
        onSettled={() => {
          setSettleBetId(null);
          notifyMutation();
        }}
      />
      <CreateBranchDialog
        open={createBranchOpen}
        onOpenChange={setCreateBranchOpen}
        onCreated={(id) => {
          setCreateBranchOpen(false);
          notifyMutation();
          setSelectedBranch(id);
        }}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <CorrectionDialog
        target={correction?.target ?? null}
        onClose={() => setCorrection(null)}
        onDone={() => {
          const done = correction?.onDone;
          setCorrection(null);
          notifyMutation();
          done?.();
        }}
      />
    </UiContext.Provider>
  );
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}
