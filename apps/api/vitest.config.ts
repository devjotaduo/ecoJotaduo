import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['@ecojotaduo/test-support/vitest-setup'],
    // Testes de integração compartilham o mesmo banco: sem paralelismo entre
    // arquivos, o truncate de um não derruba os dados do outro.
    fileParallelism: false,
    // O beforeAll espera o advisory lock que serializa as suítes de banco
    // (elas compartilham a base) e ainda roda migrações. O padrão de 10s do
    // Vitest estoura sob concorrência no CI.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
