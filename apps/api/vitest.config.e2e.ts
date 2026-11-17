import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ['./test/setup-env.ts'],
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Every spec boots the whole app and its own job queue against a real database, and they run in parallel. The 5 s default is for pure
    // unit tests: under that load a correct test timed out (a different one each run), which says nothing about the code.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
