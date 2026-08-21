import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['@ecojotaduo/test-support/vitest-setup'],
    // O isolamento de banco é por PACOTE (um `ecojotaduo_test_<pacote>`), não
    // por arquivo. Duas suítes de banco aqui em paralelo se truncariam uma à
    // outra no `beforeEach`, e a que perdesse a corrida falharia sem motivo
    // aparente. Serializar os arquivos é mais barato que dar banco a cada um.
    fileParallelism: false,
    // O beforeAll espera o advisory lock que serializa as suítes de banco
    // (elas compartilham a base) e ainda roda migrações. O padrão de 10s do
    // Vitest estoura sob concorrência no CI.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
