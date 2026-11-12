/**
 * Environment access with no silent defaults for anything security-relevant.
 *
 * KI-9: JWT_SECRET previously fell back to the string
 * 'super-secret-default-key' in two separate files. A deployment that simply
 * forgot to set it would boot, look healthy, and sign every token with a
 * value published in this repository — anyone could mint a token for any
 * account. A safety product must refuse to start in that state.
 */

import { createRegionRegistry, parseEnabledRegions, type RegionRegistry } from '@lumo/region-profiles';

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

/**
 * The keys personal data is encrypted with at rest (KI-26).
 *
 * Required, with no default, for the same reason JWT_SECRET has none: a deployment
 * that forgot to set it must refuse to start, not quietly run with a value that is
 * published in this repository.
 *
 *   DATA_ENCRYPTION_KEY            base64 of 32 random bytes:  openssl rand -base64 32
 *   DATA_ENCRYPTION_KEY_ID         names the key (default "k1"); stored with every value
 *   DATA_ENCRYPTION_KEYS_PREVIOUS  "id:base64,id:base64" — retired keys that can still
 *                                  DECRYPT. Rotating means: set the new key and id,
 *                                  move the old one here, run db:encrypt-pii, then
 *                                  drop it once nothing refers to it.
 *
 * Losing the key loses the data: there is no recovery. Back it up separately from
 * the database it protects.
 */
export function getDataEncryptionKeyring(env: NodeJS.ProcessEnv = process.env): {
  currentId: string;
  keys: Map<string, Buffer>;
} {
  const KEY_BYTES = 32;
  const decode = (name: string, value: string): Buffer => {
    const key = Buffer.from(value, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`${name} must be base64 of exactly ${KEY_BYTES} bytes. Generate one with: openssl rand -base64 32`);
    }
    if (key.every(b => b === 0)) {
      throw new Error(`${name} is all zero bytes, which is not a real key. Generate one with: openssl rand -base64 32`);
    }
    return key;
  };
  const validId = (id: string, where: string) => {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new Error(`${where}: a key id may only contain letters, digits, "_" and "-" (max 32). Got "${id}".`);
    }
  };

  const raw = env.DATA_ENCRYPTION_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'Missing required environment variable DATA_ENCRYPTION_KEY. ' +
        'Personal data is encrypted at rest and the API will not start without a key. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
  const currentId = (env.DATA_ENCRYPTION_KEY_ID ?? 'k1').trim();
  validId(currentId, 'DATA_ENCRYPTION_KEY_ID');

  const keys = new Map<string, Buffer>();
  keys.set(currentId, decode('DATA_ENCRYPTION_KEY', raw.trim()));

  for (const entry of (env.DATA_ENCRYPTION_KEYS_PREVIOUS ?? '').split(',').map(e => e.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    if (at < 1) throw new Error(`DATA_ENCRYPTION_KEYS_PREVIOUS entries must look like "id:base64key", got "${entry.slice(0, 12)}…"`);
    const id = entry.slice(0, at);
    validId(id, 'DATA_ENCRYPTION_KEYS_PREVIOUS');
    if (keys.has(id)) throw new Error(`Key id "${id}" appears twice; ids must be unique`);
    keys.set(id, decode(`DATA_ENCRYPTION_KEYS_PREVIOUS["${id}"]`, entry.slice(at + 1)));
  }

  return { currentId, keys };
}

/**
 * Which markets Lumo serves, and the gate that decides whether it may (ADR-0011).
 *
 *   ENABLED_REGIONS   comma-separated profile ids, e.g. "PK,US". Unset or blank means
 *                     none — which is allowed: the API starts and serves no market.
 *
 * A market can be switched on only if its profile is complete AND its legal review
 * is approved. In production anything less makes the API REFUSE TO START, rather
 * than serve users under rules nobody has signed off. Outside production a draft may
 * be enabled so the system can be built against it; it is marked internal-testing and
 * can never pass for live.
 *
 * This gates SERVICE, not safety information: emergency numbers are shown from any
 * known profile whether or not its market is enabled.
 */
export function getRegionRegistry(env: NodeJS.ProcessEnv = process.env): RegionRegistry {
  const environment = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  return createRegionRegistry({ enabled: parseEnabledRegions(env.ENABLED_REGIONS), environment });
}
