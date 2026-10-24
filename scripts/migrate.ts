// Applies supabase/migrations/*.sql in order. Usage: npm run db:migrate
// Works against local Postgres or a Supabase connection string (DATABASE_URL).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export async function migrate(databaseUrl: string, { log = true } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      if (log) console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  migrate(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
