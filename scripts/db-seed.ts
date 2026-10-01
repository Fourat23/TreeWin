import { openDatabase, runMigrations } from "../src/server/db/client";
import { isDatabaseEmpty, wipeLedger } from "../src/server/services/backup-service";
import { seedDemoData } from "../src/server/services/demo-seed";

const reset = process.argv.includes("--reset");
const handle = openDatabase();
runMigrations(handle.db);

if (!isDatabaseEmpty(handle.db)) {
  if (!reset) {
    console.error(
      `✖ ${handle.path} already contains data. Nothing was changed.\n` +
        "  Use `npm run db:reset` to wipe it and load the demo dataset (development only).",
    );
    process.exit(1);
  }
  wipeLedger(handle.db);
  console.info("• Existing ledger wiped (strategy settings kept).");
}

const summary = seedDemoData(handle.db);
handle.sqlite.close();
console.info(
  `✔ Demo data loaded into ${handle.path}: ${summary.branches} branches, ${summary.tickets} tickets, ${summary.candidates} candidates.`,
);
