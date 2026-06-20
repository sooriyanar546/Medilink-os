/** @type {import('next').NextConfig} */

// HTTP Security Headers — applied to every response.
// Verified against OWASP Secure Headers Project recommendations.
const securityHeaders = [
  // Prevent MIME type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Enable HSTS — forces HTTPS for 2 years including subdomains
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Prevent PHI from leaking in Referer headers to third-party services
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable unused browser APIs
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Enable DNS prefetching for performance
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  // Content Security Policy — restricts resource origins to prevent XSS
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline and unsafe-eval for its runtime
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Allow connections to Neon DB (via server), Pusher WebSockets, and Groq AI
      "connect-src 'self' https://*.neon.tech wss://*.pusher.com https://*.pusher.com https://api.groq.com",
      "img-src 'self' blob: data:",
      // Allow audio clinical chimes
      "media-src 'self' https://assets.mixkit.co",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  // Standalone output traces only required files — shrinks Docker image from ~800MB to ~120MB
  output: 'standalone',

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
