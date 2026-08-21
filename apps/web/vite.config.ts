import react from '@vitejs/plugin-react';
// `vitest/config` e não `vite`: é o que conhece o campo `test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * A API é servida na mesma origem em desenvolvimento.
     *
     * É proxy, e não CORS: abrir CORS na API para o servidor de dev seria
     * afrouxar o servidor por conveniência do front. Em produção, os dois
     * ficam atrás do mesmo domínio (ou de um proxy), e nada muda no código.
     */
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    // A Testing Library limpa o DOM entre testes usando o `afterEach` global.
    globals: true,
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
