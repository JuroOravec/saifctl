import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'saifctl/**/tests/**/*.spec.ts'],
    // Per-phase spec files emitted by feature compilers (saifdocs, custom
    // designers, etc.) live under saifctl/features/<id>/phases/.../tests/
    // and are meant to run inside the saifctl test-runner container against
    // the staging sidecar — not on the host. Vitest's default glob would
    // otherwise sweep them up and fail with ECONNREFUSED on localhost:8080.
    exclude: [
      'node_modules/**',
      'dist/**',
      'test/integration/**',
      'saifctl/features/*/phases/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/__generated__/**',
      ],
      reporter: ['text', 'lcov'],
      // TODO - require 98% test coverage
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 35,
        statements: 40,
      },
    },
  },
});
