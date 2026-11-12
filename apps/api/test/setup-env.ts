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
