import pg from 'pg';
import { env } from './env.js';

const ssl = env.databaseSsl
  ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
  : undefined;

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl,
  // Settings hold one advisory-lock connection while using another for effects.
  // Retain two idle clients instead of reconnecting after every short pause.
  min: 2,
  idleTimeoutMillis: 60000
});
