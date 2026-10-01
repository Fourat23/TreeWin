import { openDatabase, runMigrations } from "../src/server/db/client";

const handle = openDatabase();
runMigrations(handle.db);
handle.sqlite.close();
console.info(`✔ Migrations applied to ${handle.path}`);
