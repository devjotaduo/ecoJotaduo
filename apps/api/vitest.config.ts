import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['@ecojotaduo/test-support/vitest-setup'],
    // Testes de integração compartilham o mesmo banco: sem paralelismo entre
    // arquivos, o truncate de um não derruba os dados do outro.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
