import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

// Server-side only (API routes). Uses the Supabase transaction pooler, so prepared
// statements must be disabled.
const url = process.env.DATABASE_URL;

// Runs on a persistent Node server (Railway) — a normal connection pool is fine and
// reused across requests. `prepare: false` is required by the Supabase transaction
// pooler (DATABASE_URL, port 6543). (Cloudflare Workers / EAS Hosting could NOT keep
// these TCP connections alive between requests, which is why the backend moved here.)
const queryClient = url
  ? postgres(url, { prepare: false, max: 10, idle_timeout: 30, connect_timeout: 15 })
  : (null as unknown as ReturnType<typeof postgres>);

export const db = url
  ? drizzle(queryClient, { schema })
  : (new Proxy(
      {},
      {
        get() {
          throw new Error('DATABASE_URL is not set. The DB client was accessed before configuration.');
        },
      },
    ) as ReturnType<typeof drizzle<typeof schema>>);

export { schema };
