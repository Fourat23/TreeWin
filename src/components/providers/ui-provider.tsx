"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SameEventPolicy } from "@/domain/strategy/settings";
import type { Profile } from "@/domain/types";
import { BranchDrawer } from "@/components/branch/branch-drawer";
import { CreateBranchDialog } from "@/components/branch/create-branch-dialog";
import { CommandPalette } from "@/components/layout/command-palette";
import { NewTicketDialog, type TicketPrefill } from "@/components/tickets/new-ticket-dialog";
import { SettleDialog } from "@/components/tickets/settle-dialog";

export interface StrategyHints {
  oddsMinBp: number;
  oddsMaxBp: number;
  sameEventPolicy: SameEventPolicy;
  isDev: boolean;
  defaultProfile: Profile;
}

interface NewTicketRequest {
  branchId?: string;
  prefill?: TicketPrefill;
  candidateId?: string;
}

interface UiContextValue {
  hints: StrategyHints;
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
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ hints, children }: { hints: StrategyHints; children: ReactNode }) {
  const router = useRouter();
  const [dataVersion, setDataVersion] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [newTicket, setNewTicket] = useState<NewTicketRequest | null>(null);
  const [settleBetId, setSettleBetId] = useState<string | null>(null);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const notifyMutation = useCallback(() => {
    setDataVersion((v) => v + 1);
    router.refresh();
  }, [router]);

  const value = useMemo<UiContextValue>(
    () => ({
      hints,
      dataVersion,
      notifyMutation,
      selectedBranch,
      openBranch: (id) => setSelectedBranch(id),
      closeBranch: () => setSelectedBranch(null),
      openNewTicket: (request) => setNewTicket(request ?? {}),
      openSettle: (betId) => setSettleBetId(betId),
      openCreateBranch: () => setCreateBranchOpen(true),
      openPalette: () => setPaletteOpen(true),
    }),
    [hints, dataVersion, notifyMutation, selectedBranch],
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
    </UiContext.Provider>
  );
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}
