/**
 * Test environment. The API refuses to start without a real JWT_SECRET
 * (KI-9), so the suite must supply one rather than relying on a fallback —
 * the absence of that fallback is the thing being protected.
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-only-secret-not-used-anywhere-real-0123456789';
