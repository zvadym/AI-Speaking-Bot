import { env } from './env.js';
import { createApp, shutdown } from './app.js';

const app = await createApp();

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('API shutdown failed', error);
      process.exit(1);
    });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('API shutdown failed', error);
      process.exit(1);
    });
});

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
