import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig);

// Public routes that never require authentication
const PUBLIC_ROUTES = ['/login'];
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/health', '/api/kiosk'];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const pathname = nextUrl.pathname;
  const isAuthenticated = !!session?.user;

  // Allow public static assets and service workers to bypass authentication
  if (
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.pdf') ||
    pathname.endsWith('.ico')
  ) {
    return;
  }

  // Always allow public API prefixes (auth callbacks, health checks, kiosk)
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return;
  }

  // Always allow public page routes
  if (PUBLIC_ROUTES.includes(pathname)) {
    // If already authenticated, redirect away from login to dashboard
    if (isAuthenticated) {
      return Response.redirect(new URL('/', nextUrl));
    }
    return;
  }

  // Not authenticated — enforce protection
  if (!isAuthenticated) {
    // API routes get a clean 401 JSON response (not an HTML redirect)
    if (pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Active session not found.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Page routes get redirected to /login with return URL preserved
    const loginUrl = new URL('/login', nextUrl);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(loginUrl);
  }

  // --- ROLE-BASED ACCESS CONTROL (RBAC) FOR API ROUTES ---
  if (pathname.startsWith('/api/')) {
    const role = session.user?.role?.toUpperCase();

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
});

// Apply middleware to all routes except Next.js internals and static assets
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons|images).*)',
  ],
};
