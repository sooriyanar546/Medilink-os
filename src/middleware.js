import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

export default NextAuth(authConfig).auth((req) => {
  const isLoggedIn = !!req.auth;
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
    let callbackUrl = req.nextUrl.pathname;
    if (req.nextUrl.search) {
      callbackUrl += req.nextUrl.search;
    }
    const encodedCallbackUrl = encodeURIComponent(callbackUrl);
    return Response.redirect(new URL(`/login?callbackUrl=${encodedCallbackUrl}`, req.nextUrl));
  }

  return null;
});

// Optionally, don't invoke Middleware on some paths
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
