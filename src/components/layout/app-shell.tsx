"use client";

import {
  Activity,
  Binoculars,
  ChartColumn,
  ChartNetwork,
  FlaskConical,
  GitBranch,
  Landmark,
  LayoutDashboard,
  ListTree,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { THEME_COOKIE } from "@/lib/theme";
import { Logo } from "./logo";
import { UndoBar } from "./undo-bar";
import { WorkspaceBadge, WorkspaceSwitch } from "./workspace-switch";

const NAV: { section: string; items: { href: string; label: string; icon: typeof Activity }[] }[] =
  [
    {
      section: "Ecosystem",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/tree", label: "Tree", icon: ListTree },
        { href: "/network", label: "Network", icon: ChartNetwork },
        { href: "/branches", label: "Branches", icon: GitBranch },
      ],
    },
    {
      section: "Ledger",
      items: [
        { href: "/tickets", label: "Tickets", icon: Ticket },
        { href: "/bank", label: "BANK", icon: Landmark },
        { href: "/activity", label: "Activity", icon: Activity },
      ],
    },
    {
      section: "Research",
      items: [
        { href: "/analytics", label: "Analytics", icon: ChartColumn },
        { href: "/candidates", label: "Candidates", icon: Binoculars },
        { href: "/simulation", label: "Simulation", icon: FlaskConical },
      ],
    },
  ];

function ThemeToggle({ initialTheme }: { initialTheme: "dark" | "light" }) {
  const [theme, setTheme] = useState(initialTheme);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="mb-1.5 px-2.5 text-[10px] font-medium tracking-[0.14em] text-fg-subtle uppercase">
            {group.section}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
                      active && "bg-surface-2 text-fg",
                    )}
                  >
                    <Icon
                      className={cn("size-4", active ? "text-fg" : "text-fg-subtle")}
                      aria-hidden
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme: "dark" | "light";
}) {
  const { openNewTicket, openPalette, workspace } = useUi();
  const pathname = usePathname();
  // The mobile menu belongs to the page it was opened on: navigating closes it.
  // Switching workspace closes it too.
  const menuKey = `${workspace}:${pathname}`;
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const mobileOpen = menuOpenedAt === menuKey;
  const setMobileOpen = (open: boolean) => setMenuOpenedAt(open ? menuKey : null);

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-border bg-surface/60 px-3 py-4 backdrop-blur lg:flex">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2.5 px-2">
          <Logo />
        </Link>
        <WorkspaceSwitch className="mb-4" />
        <Button
          variant="primary"
          className="mb-2 w-full justify-start"
          onClick={() => openNewTicket()}
        >
          <Plus /> New round
        </Button>
        <button
          type="button"
          onClick={openPalette}
          className="mb-6 flex h-8 w-full items-center gap-2 rounded-lg border border-border px-2.5 text-[13px] text-fg-subtle hover:border-border-strong hover:text-fg-muted"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border px-1 pt-3">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-fg-muted hover:text-fg",
              pathname.startsWith("/settings") && "text-fg",
            )}
          >
            <Settings className="size-4" /> Settings
          </Link>
          <ThemeToggle initialTheme={initialTheme} />
        </div>
        <p className="mt-3 px-2 text-[10px] leading-relaxed text-fg-subtle">
          Local tracker. Tickets are placed manually on Winamax — nothing is ever automated.
        </p>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard" aria-label="CELLTREE home">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <WorkspaceBadge className="mr-1" compact />
          <Button variant="ghost" size="icon-sm" onClick={openPalette} aria-label="Search">
            <Search />
          </Button>
          <Button
            variant="primary"
            size="icon-sm"
            onClick={() => openNewTicket()}
            aria-label="New round"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            <MenuIcon />
          </Button>
        </div>
      </header>
      {mobileOpen ? (
        <div className="fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto border-t border-border bg-bg px-4 py-5 lg:hidden">
          <WorkspaceSwitch className="mb-5" />
          <NavLinks onNavigate={() => setMobileOpen(false)} />
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <Link href="/settings" className="flex items-center gap-2 text-sm text-fg-muted">
              <Settings className="size-4" /> Settings
            </Link>
            <ThemeToggle initialTheme={initialTheme} />
          </div>
        </div>
      ) : null}

      <main
        className="lg:pl-[232px]"
        style={{ "--chrome-h": workspace === "DEMO" ? "4rem" : "2.25rem" } as CSSProperties}
      >
        <div className="sticky top-14 z-20 flex h-9 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 py-1 backdrop-blur lg:top-0 lg:px-8">
          <WorkspaceBadge className="hidden lg:inline-flex" />
          <UndoBar />
        </div>
        {workspace === "DEMO" ? (
          <div
            role="status"
            className="flex h-7 items-center justify-center gap-2 overflow-hidden border-b border-warning/40 bg-warning/12 px-4 text-center text-[12px] font-semibold tracking-[0.06em] text-warning"
            data-testid="demo-banner"
          >
            <FlaskConical className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              DEMO / SIMULATION DATA
              <span className="hidden sm:inline"> — nothing on these pages is real money</span>
            </span>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
