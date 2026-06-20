import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Server-Side Configuration — MediLink
 * PHI SAFETY: Scrubs all patient data before transmission.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: process.env.NODE_ENV === 'production',

  // 5% of server transactions sampled — lower than client to reduce overhead
  tracesSampleRate: 0.05,
  sampleRate: 1.0,

  environment: process.env.NODE_ENV,

  // ─── PHI Safety ────────────────────────────────────────────────────────────
  beforeSend(event) {
    // Scrub HTTP request bodies — contain patient demographics, PHI, and tokens
    if (event.request?.data) {
      event.request.data = '[PHI SCRUBBED]';
    }

    // Scrub query strings — may expose patientId, visitId, consentId
    if (event.request?.query_string) {
      event.request.query_string = '[SCRUBBED]';
    }

    // Scrub response bodies if captured
    if (event.extra?.responseBody) {
      event.extra.responseBody = '[SCRUBBED]';
    }

    // Scrub user info — only keep a non-identifying role label
    if (event.user) {
      event.user = {
        role: event.user.role || 'UNKNOWN',
        // No email, no name, no real ID
      };
    }

    return event;
  },

  ignoreErrors: [
    'PrismaClientKnownRequestError: Record to delete does not exist',
    'AbortError',
  ],
});
