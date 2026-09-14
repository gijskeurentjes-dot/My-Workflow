import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each suite builds its own in-memory database, so files can run in parallel.
    pool: 'threads',
  },
});
