import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

// Supabase transaction pooler → prepared statements must stay off.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { prepare: false, max: 5 });
export const db = drizzle(client, { schema });
export { schema };
