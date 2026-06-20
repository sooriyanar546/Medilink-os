import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Client-Side Configuration — MediLink
 * PHI SAFETY: Personal health information must NEVER appear in error reports.
 * All sensitive fields are scrubbed before transmission.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only capture errors in production — skip in dev to avoid noise
  enabled: process.env.NODE_ENV === 'production',

  // 10% of transactions sampled for performance monitoring (adjust as needed)
  tracesSampleRate: 0.1,

  // Capture 100% of errors (not performance traces)
  sampleRate: 1.0,

  environment: process.env.NODE_ENV,

  // ─── PHI Safety: Scrub sensitive fields before transmission ───────────────
  beforeSend(event) {
    // Strip request body data — may contain patient demographics
    if (event.request?.data) {
      event.request.data = '[PHI SCRUBBED]';
    }

    // Scrub query string parameters (may contain patientId, visitId)
    if (event.request?.query_string) {
      event.request.query_string = '[SCRUBBED]';
    }

    // Remove user identifying info from client errors
    if (event.user) {
      event.user = {
        id: event.user.id ? '[HASHED]' : undefined,
        // Never send email, name, or IP in error reports
      };
    }

    return event;
  },

  // Ignore known non-errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection',
    'AbortError',
    'Network request failed',
  ],
});
