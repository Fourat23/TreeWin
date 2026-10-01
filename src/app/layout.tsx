import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { FormatProvider } from "@/components/providers/format-provider";
import { UiProvider } from "@/components/providers/ui-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceErrorScreen } from "@/components/layout/workspace-error";
import { THEME_COOKIE } from "@/lib/theme";
import { getRepository } from "@/server/state";
import { createEmptyState } from "@/server/state/integrity";
import { StateLoadError } from "@/server/state/repository";
import type { WorkspaceState } from "@/server/state/schema";
import { requestWorkspace } from "@/server/state/workspace";
import "./globals.css";

// Every page reads the local workspace files: never prerender or cache at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "CELLTREE", template: "%s · CELLTREE" },
  description:
    "Local tracker, rules engine and visualizer for a branch-based bankroll strategy. Tickets are placed manually on Winamax.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d11",
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const workspace = await requestWorkspace();
  const repository = getRepository();
  let state: WorkspaceState;
  let loadError: StateLoadError | null = null;
  try {
    state = await repository.load(workspace);
  } catch (error) {
    if (!(error instanceof StateLoadError)) throw error;
    loadError = error;
    state = createEmptyState(workspace);
  }
  const settings = state.settings;
  const change = state.metadata.lastChange;
  // Theme preference lives in a cookie so the server renders the right theme (no flash).
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <FormatProvider
          config={{
            locale: settings.locale,
            currency: settings.currency,
            roundLabel: settings.roundLabel,
            roundShortLabel: settings.roundShortLabel,
          }}
        >
          <TooltipProvider>
            <UiProvider
              workspace={workspace}
              hints={{
                oddsMinBp: settings.odds.minBp,
                oddsMaxBp: settings.odds.maxBp,
                sameEventPolicy: settings.sameEventPolicy,
                defaultProfile: "BALANCED",
                strategyVersion: settings.strategyVersion,
                corridors: {
                  HARVEST: {
                    minBp: settings.profiles.HARVEST.oddsTargetMinBp,
                    maxBp: settings.profiles.HARVEST.oddsTargetMaxBp,
                  },
                  BALANCED: {
                    minBp: settings.profiles.BALANCED.oddsTargetMinBp,
                    maxBp: settings.profiles.BALANCED.oddsTargetMaxBp,
                  },
                  GROWTH: {
                    minBp: settings.profiles.GROWTH.oddsTargetMinBp,
                    maxBp: settings.profiles.GROWTH.oddsTargetMaxBp,
                  },
                },
              }}
              lastChange={change ? { label: change.label, at: change.at } : null}
            >
              <AppShell initialTheme={theme}>
                {loadError ? (
                  <WorkspaceErrorScreen
                    workspace={workspace}
                    path={loadError.path}
                    problems={loadError.problems}
                    backups={await repository.listBackups(workspace)}
                  />
                ) : (
                  children
                )}
              </AppShell>
            </UiProvider>
          </TooltipProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: "bg-surface-2! border! border-border! text-fg! rounded-xl! shadow-panel!",
                description: "text-fg-muted!",
              },
            }}
          />
        </FormatProvider>
      </body>
    </html>
  );
}
