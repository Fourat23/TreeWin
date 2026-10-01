"use client";

import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import {
  Activity,
  ChartColumn,
  ChartNetwork,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  ListTree,
  Plus,
  Settings,
  Sprout,
  Ticket,
  Binoculars,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { BranchStatus, Profile } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { ProfileDot } from "@/components/ui/domain-badges";
import { STATUS_LABEL } from "@/lib/labels";

interface PaletteBranch {
  id: string;
  code: string;
  profile: Profile;
  status: BranchStatus;
  currentCapitalCents: number;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const f = useFormat();
  const { openNewTicket, openCreateBranch, openBranch } = useUi();
  const [branches, setBranches] = useState<PaletteBranch[]>([]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/branches", { signal: controller.signal, cache: "no-store" })
      .then((r) => r.json() as Promise<PaletteBranch[]>)
      .then(setBranches)
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const go = (href: string) => run(() => router.push(href));

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <D.Content className="fixed top-[12vh] left-1/2 z-50 w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-panel">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search branches and run actions</D.Description>
          <Command label="Command palette" loop>
            <Command.Input
              autoFocus
              placeholder="Type a command or a branch code…"
              className="h-12 w-full border-b border-border bg-transparent px-4 text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-fg-subtle">
                No result.
              </Command.Empty>
              <Command.Group
                heading="Actions"
                className="text-[11px] text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                <Item icon={<Plus />} onSelect={() => run(() => openNewTicket())}>
                  New round / ticket
                </Item>
                <Item icon={<Sprout />} onSelect={() => run(openCreateBranch)}>
                  Create root branch
                </Item>
                <Item icon={<FlaskConical />} onSelect={() => go("/simulation")}>
                  Run simulation
                </Item>
              </Command.Group>
              <Command.Group
                heading="Go to"
                className="text-[11px] text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                <Item icon={<LayoutDashboard />} onSelect={() => go("/dashboard")}>
                  Dashboard
                </Item>
                <Item icon={<ListTree />} onSelect={() => go("/tree")}>
                  Open graph (tree)
                </Item>
                <Item icon={<ChartNetwork />} onSelect={() => go("/network")}>
                  Network view
                </Item>
                <Item icon={<Landmark />} onSelect={() => go("/bank")}>
                  Open BANK
                </Item>
                <Item icon={<Ticket />} onSelect={() => go("/tickets")}>
                  Tickets journal
                </Item>
                <Item icon={<ChartColumn />} onSelect={() => go("/analytics")}>
                  Analytics
                </Item>
                <Item icon={<Binoculars />} onSelect={() => go("/candidates")}>
                  Candidates
                </Item>
                <Item icon={<Activity />} onSelect={() => go("/activity")}>
                  Recent activity
                </Item>
                <Item icon={<Settings />} onSelect={() => go("/settings")}>
                  Settings
                </Item>
              </Command.Group>
              {branches.length > 0 ? (
                <Command.Group
                  heading="Branches"
                  className="text-[11px] text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {branches.map((b) => (
                    <Item
                      key={b.id}
                      value={`branch ${b.code}`}
                      icon={<ProfileDot profile={b.profile} className="size-2.5" />}
                      onSelect={() => run(() => openBranch(b.id))}
                      trailing={`${STATUS_LABEL[b.status]} · ${f.money(b.currentCapitalCents)}`}
                    >
                      <span className="font-mono">{b.code}</span>
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Item({
  children,
  icon,
  onSelect,
  value,
  trailing,
}: {
  children: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  value?: string;
  trailing?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-subtle"
    >
      {icon}
      <span className="flex-1">{children}</span>
      {trailing ? <span className="num text-xs text-fg-subtle">{trailing}</span> : null}
    </Command.Item>
  );
}
