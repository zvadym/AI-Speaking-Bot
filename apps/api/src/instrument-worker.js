import { ensureSentryInitialized } from './sentry.js';

ensureSentryInitialized({ processName: 'worker' });
