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
import { THEME_COOKIE } from "@/lib/theme";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/services/settings-service";
import "./globals.css";

// Every page reads the local SQLite ledger: never prerender or cache at build time.
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
  const settings = getSettings(getDb());
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
              hints={{
                oddsMinBp: settings.odds.minBp,
                oddsMaxBp: settings.odds.maxBp,
                sameEventPolicy: settings.sameEventPolicy,
                isDev: process.env.NODE_ENV !== "production",
                defaultProfile: "BALANCED",
              }}
            >
              <AppShell initialTheme={theme}>{children}</AppShell>
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
