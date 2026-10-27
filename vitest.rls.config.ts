import { defineConfig } from 'vitest/config';

// Testes de RLS rodam contra um Supabase REAL (local ou de teste). Veja README.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.ts'],
    testTimeout: 30000,
  },
});
