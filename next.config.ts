import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // Don't generate AGENTS.md / CLAUDE.md in the project on `next dev`.
  agentRules: false,
};

export default nextConfig;
