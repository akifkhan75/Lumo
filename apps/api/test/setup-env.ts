/**
 * class-transformer's @Type decorator reads design-time metadata, which only
 * exists once reflect-metadata is loaded. Nest loads it for the app and the
 * e2e suite, so a unit spec that imports a DTO directly was the one place it
 * was missing — and it failed with "Reflect.getMetadata is not a function"
 * rather than anything that named the cause.
 */
import 'reflect-metadata';

/**
 * Test environment. The API refuses to start without a real JWT_SECRET
 * (KI-9), so the suite must supply one rather than relying on a fallback —
 * the absence of that fallback is the thing being protected.
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-only-secret-not-used-anywhere-real-0123456789';

/**
 * Personal data is encrypted at rest and the API refuses to start without a key
 * (KI-26), so the suite supplies one. A fixed, obviously-not-secret value: tests
 * that need to see ciphertext read it back from the database, not from here.
 */
process.env.DATA_ENCRYPTION_KEY =
  process.env.DATA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

/**
 * Test suites run in parallel processes against ONE database. Every app that boots would start
 * a pg-boss worker on the same queue and steal each other's jobs, so the queue is off by default
 * in tests; the notifications suite turns it on with a schema of its own.
 */
process.env.NOTIFICATIONS_QUEUE = process.env.NOTIFICATIONS_QUEUE ?? 'off';
