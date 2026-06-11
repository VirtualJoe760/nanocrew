import { config as loadEnv } from 'dotenv';
import type { Config } from 'drizzle-kit';

loadEnv({ path: '.env.local' });

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Session pooler for migrations (transaction pooler can't hold the session state
    // drizzle-kit needs).
    url: process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config;
