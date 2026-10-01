import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native SQLite driver must stay a plain Node require on the server.
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
