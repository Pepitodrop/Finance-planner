import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['server/**', 'node_modules/**', 'dist/**'],
    // Heavy integration suites (full App render, chart-bearing dashboards) can
    // exceed the 5s default under full-suite parallel CPU contention even
    // though they complete quickly in isolation. 15s gives headroom without
    // masking a genuinely hung test.
    testTimeout: 15000,
  },
})
