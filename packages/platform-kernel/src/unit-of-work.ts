/**
 * Porta de unidade de trabalho.
 *
 * Um caso de uso que grava o dado E publica o evento precisa que os dois
 * tenham o mesmo destino — senão o outbox passa a conter fatos que não
 * aconteceram. Ele não pode, porém, conhecer transação nem banco: por isso
 * declara esta porta, e o composition root liga na implementação real.
 */
export interface UnitOfWork {
  /** Tudo o que rodar dentro de `fn` comparte a mesma transação e o commit. */
  executar<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Implementação nula: executa direto, sem transação compartilhada.
 *
 * Serve a testes de unidade com dublês, onde não há banco para transacionar.
 * NUNCA use em produção — a atomicidade some em silêncio, que é exatamente a
 * falha que a unidade existe para impedir.
 */
export class NoopUnitOfWork implements UnitOfWork {
  executar<T>(_tenantId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
