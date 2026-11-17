import type { NextConfig } from 'next';

/**
 * The journey page is unauthenticated by design: the token in the URL is the credential (T6). So the surface stays small and the
 * headers close the leaks around it: not indexed, no referrer (the URL holds the token), nothing cached, no third-party scripts.
 */
const headers = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    // Next needs inline scripts for hydration; nothing is loaded from any other origin, and the page may only post to itself.
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers }];
  },
};
export default config;
