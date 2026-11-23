// Deletes QA accounts (emails ending in @tarrow.test) and everything they own.
// Keeps qa+demo@tarrow.test (store screenshots). Usage: node --env-file=.env.local scripts/cleanup-qa.mjs
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`delete from users where email like 'qa+%@tarrow.test' and email <> 'qa+demo@tarrow.test' returning email`;
await sql`delete from auth_attempts where key like 'email:qa+%@tarrow.test'`;
// Local test signups have no x-forwarded-for, so they all share one per-IP signup bucket (20/hour).
await sql`delete from auth_attempts where key in ('signup:unknown', 'signup:::1', 'signup:127.0.0.1')`;
console.log(`deleted ${rows.length} QA users`);
