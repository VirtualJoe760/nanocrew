import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

// Lazy: `next build` evaluates route modules without env; the connection is
// only needed (and DATABASE_URL only required) at request time.
// Supabase transaction pooler → prepared statements must stay off.
type Db = ReturnType<typeof drizzle<typeof schema>>;
let instance: Db | null = null;

function getDb(): Db {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    instance = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  }
  return instance;
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    return Reflect.get(getDb() as object, prop);
  },
});
export { schema };
