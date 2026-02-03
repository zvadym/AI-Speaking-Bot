import pg from 'pg';
import { env } from './env.js';

const ssl = env.databaseSsl
  ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
  : undefined;

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl
});
