import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['@ecojotaduo/test-support/vitest-setup'],
    // Isolamento de banco é por PACOTE: duas suítes de banco em paralelo aqui
    // se truncariam uma à outra no `beforeEach`.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
