/**
 * Next.js Instrumentation Hook — MediLink
 * Initializes Sentry on the server side before any request is handled.
 * IMPORTANT: Must guard against build-time execution — Sentry must only
 * run at runtime, not during `next build` static page generation.
 */
export async function register() {
  // Skip during build phase — only run at server startup
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
