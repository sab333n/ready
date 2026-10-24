import postgres from "postgres";
import { env } from "@/lib/env";

// One pooled client per server process (survives Next dev hot reloads).
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ??
  postgres(env.databaseUrl, {
    max: 5,
    onnotice: () => {},
    transform: postgres.camel,
  });

if (!env.isProd) globalForDb.sql = sql;
