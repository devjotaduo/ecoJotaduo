import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['@ecojotaduo/test-support/vitest-setup'],
    // Criar o banco do pacote e rodar todas as migrações da plataforma passa
    // dos 10s padrão do Vitest quando as suítes sobem em paralelo no CI.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
