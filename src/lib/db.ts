import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

// Server-side only (API routes). Uses the Supabase transaction pooler, so prepared
// statements must be disabled.
const url = process.env.DATABASE_URL;

// EAS Hosting runs these routes on Cloudflare Workers (many short-lived, globally
// distributed isolates). Keep the per-isolate pool tiny so the fleet doesn't
// exhaust the Supabase transaction pooler, and recycle idle sockets so stale
// connections don't hang a later request. `prepare: false` is required by the pooler.
const queryClient = url
  ? postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15 })
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
