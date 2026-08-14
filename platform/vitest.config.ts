import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
  resolve: {
    // Workspace packages resolve to source, so tests run against what you edit
    // rather than a build artefact that may be stale.
    conditions: ['development', 'import', 'node'],
  },
});
