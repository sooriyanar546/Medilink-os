import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

export default NextAuth(authConfig).auth((req) => {
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role?.toUpperCase();
  const pathname = req.nextUrl.pathname;

  // Allow public static assets and service workers to bypass authentication
  if (
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.pdf') ||
    pathname.endsWith('.ico')
  ) {
    return null;
  }

  const isAuthRoute = pathname.startsWith('/login');
  const isApiAuthRoute = pathname.startsWith('/api/auth');

  // Rate limit: brute-force protection on the sign-in endpoint
  // 10 attempts per IP per minute before lockout
  if (pathname === '/api/auth/signin' && req.method === 'POST') {
    const rl = checkRateLimit(req, { limit: 10, windowMs: 60_000, prefix: 'signin' });
    if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);
  }

  // Allow next-auth API routes to pass through unhindered
  if (isApiAuthRoute) return null;

  // Allow login page, but redirect to dashboard if already logged in
  if (isAuthRoute) {
    if (isLoggedIn) {
      return Response.redirect(new URL('/', req.nextUrl));
    }
    return null;
  }

  // Require authentication for all other routes
  if (!isLoggedIn) {
    // For API routes, return a 401 Unauthorized JSON response instead of a redirect
    if (pathname.startsWith('/api')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Active session not found.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let callbackUrl = pathname;
    if (req.nextUrl.search) {
      callbackUrl += req.nextUrl.search;
    }
    const encodedCallbackUrl = encodeURIComponent(callbackUrl);
    return Response.redirect(new URL(`/login?callbackUrl=${encodedCallbackUrl}`, req.nextUrl));
  }

  // --- ROLE-BASED ACCESS CONTROL (RBAC) FOR API ROUTES ---
  if (pathname.startsWith('/api')) {
    // 1. Doctor-Only Endpoints
    if (
      (pathname.startsWith('/api/visits/') && pathname.endsWith('/complete')) ||
      pathname.startsWith('/api/ai/scribe')
    ) {
      if (role !== 'DOCTOR' && role !== 'ADMIN') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Doctor credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 2. Nurse-Only Endpoints
    if (pathname.startsWith('/api/visits/') && pathname.endsWith('/vitals')) {
      if (role !== 'NURSE' && role !== 'ADMIN' && role !== 'DOCTOR') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Nurse or Doctor credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Pharmacy-Only Endpoints (Allow Patient, Pharmacist, Admin)
    if (pathname.startsWith('/api/pharmacy')) {
      if (role !== 'PHARMACIST' && role !== 'ADMIN' && role !== 'PATIENT') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Pharmacist, Admin, or Patient credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 4. Cashier-Only Endpoints (Allow Cashier, Admin, or Patient)
    if (pathname.startsWith('/api/billing-claims')) {
      if (role !== 'CASHIER' && role !== 'ADMIN' && role !== 'PATIENT') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Cashier, Admin, or Patient credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 5. Audit logs - Admin or Patient Only
    if (pathname.startsWith('/api/audit')) {
      if (role !== 'ADMIN' && role !== 'PATIENT') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Administrative or Patient clearance required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  return null;
});

// Intercept all UI pages and API routes (excluding next-auth, static files, and icons)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
