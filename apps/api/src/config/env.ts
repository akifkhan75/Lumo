/**
 * Environment access with no silent defaults for anything security-relevant.
 *
 * KI-9: JWT_SECRET previously fell back to the string
 * 'super-secret-default-key' in two separate files. A deployment that simply
 * forgot to set it would boot, look healthy, and sign every token with a
 * value published in this repository — anyone could mint a token for any
 * account. A safety product must refuse to start in that state.
 */

const MIN_JWT_SECRET_LENGTH = 32;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `See apps/api/.env.example. The API will not start without it.`,
    );
  }
  return value;
}

export function getJwtSecret(): string {
  const secret = requireEnv('JWT_SECRET');
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. ` +
        `Generate one with: openssl rand -base64 48`,
    );
  }
  if (secret.includes('change-in-production') || secret === 'super-secret-default-key') {
    throw new Error(
      'JWT_SECRET is still set to an example value. Generate a real secret: openssl rand -base64 48',
    );
  }
  return secret;
}

/**
 * Origins allowed to call the API from a browser. The web journey page
 * (Phase 1) is the only browser client; the mobile app is not subject to CORS.
 * An empty list means no browser origin is permitted, which is the correct
 * default until that page exists.
 */
export function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

export function getPort(): number {
  const raw = process.env.API_PORT ?? '3005';
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`API_PORT must be a valid port number, got "${raw}".`);
  }
  return port;
}
