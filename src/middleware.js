import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

export default NextAuth(authConfig).auth((req) => {
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role?.toUpperCase(); // Extract role in uppercase

  const isAuthRoute = req.nextUrl.pathname.startsWith('/login');
  const isApiAuthRoute = req.nextUrl.pathname.startsWith('/api/auth');

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
    const pathname = req.nextUrl.pathname;
    
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
  const pathname = req.nextUrl.pathname;

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

    // 3. Pharmacy-Only Endpoints
    if (pathname.startsWith('/api/pharmacy')) {
      if (role !== 'PHARMACIST' && role !== 'ADMIN') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Pharmacist credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 4. Cashier-Only Endpoints
    if (pathname.startsWith('/api/billing-claims')) {
      if (role !== 'CASHIER' && role !== 'ADMIN') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Cashier credentials required (Your role: ${role})` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 5. Admin-Only Endpoints
    if (pathname.startsWith('/api/audit') || pathname.startsWith('/api/metrics')) {
      if (role !== 'ADMIN') {
        return new Response(
          JSON.stringify({ error: `Forbidden: Administrative clearance required (Your role: ${role})` }),
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
