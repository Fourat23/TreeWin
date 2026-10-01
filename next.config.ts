import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native SQLite driver must stay a plain Node require on the server.
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: false,
  // Don't generate AGENTS.md / CLAUDE.md in the project on `next dev`.
  agentRules: false,
};

export default nextConfig;
