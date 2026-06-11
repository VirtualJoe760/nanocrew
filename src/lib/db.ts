import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

// Server-side only (API routes). Uses the Supabase transaction pooler, so prepared
// statements must be disabled.
const url = process.env.DATABASE_URL;

const queryClient = url
  ? postgres(url, { prepare: false, max: 5 })
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
