import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Edge Runtime Configuration — MediLink
 * Used for middleware/proxy (Next.js proxy.js runs on the Edge runtime).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.05,
  environment: process.env.NODE_ENV,

  beforeSend(event) {
    if (event.request?.data) event.request.data = '[PHI SCRUBBED]';
    if (event.request?.query_string) event.request.query_string = '[SCRUBBED]';
    return event;
  },
});
