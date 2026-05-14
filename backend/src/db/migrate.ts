import * as dotenv from "dotenv";
dotenv.config();

import { initDb } from "./database";

console.log("Running database migration...");
initDb();
console.log("Migration complete.");
