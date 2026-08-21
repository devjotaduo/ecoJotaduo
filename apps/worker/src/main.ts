import { loadEnv } from '@ecojotaduo/config';

import { criarWorker, type Worker } from './worker';

export function bootstrap(): Worker {
  // Fail-fast: ambiente inválido derruba o boot com mensagem clara.
  const env = loadEnv();
  const worker = criarWorker(env);

  // Termina o ciclo em curso antes de sair. Matar o processo no meio de uma
  // entrega não perde o evento (ele volta a `pending` no rollback), mas
  // deixaria o handler pela metade se o efeito for externo.
  const encerrar = async (): Promise<void> => {
    worker.parar();
    await worker.nucleo.handle.close();
  };
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void encerrar().finally(() => process.exit(0));
    });
  }

  console.log(`Worker de eventos iniciado (${env.NODE_ENV}).`);
  void worker.iniciar();
  return worker;
}

// Só sobe o laço quando este arquivo é o ponto de entrada: importar o módulo
// (em teste ou ferramenta) não pode ter efeito colateral.
if (require.main === module) {
  bootstrap();
}
