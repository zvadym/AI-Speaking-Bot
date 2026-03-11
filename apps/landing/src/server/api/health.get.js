export default defineEventHandler(() => {
  return {
    ok: true,
    service: 'landing',
    runtime: 'nitro',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  };
});
