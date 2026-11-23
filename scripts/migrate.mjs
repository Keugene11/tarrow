// Applies scripts/schema.sql (idempotent). Usage: node --env-file=.env.local scripts/migrate.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const text = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const statements = text
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
}
console.log(`applied ${statements.length} statements`);
