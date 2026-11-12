import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/testing/**'],
      // ADR-0009: 100% branch coverage, enforced. Below this, `pnpm test` fails,
      // and so does CI. A branch in a safety machine that no test reaches is a
      // transition nobody has checked.
      thresholds: { branches: 100, lines: 100, functions: 100, statements: 100 },
    },
  },
});
