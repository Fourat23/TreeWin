import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.CELLTREE_DB_PATH ?? "./data/celltree.db",
  },
  strict: true,
  verbose: true,
});
