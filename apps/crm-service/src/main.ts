import { loadEnv } from '@ecojotaduo/config';

import { criarServicoDeCrm, type ServicoDeCrm } from './service';

export async function bootstrap(): Promise<ServicoDeCrm> {
  // Fail-fast: ambiente inválido derruba o boot com mensagem clara.
  const env = loadEnv();
  const servico = criarServicoDeCrm(env);

  // Drena o pool antes de sair, como as outras bordas: um deploy sem downtime
  // não pode derrubar consulta em andamento junto com o processo.
  const encerrar = async (): Promise<void> => {
    await servico.app.close();
    await servico.handle.close();
  };
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void encerrar().finally(() => process.exit(0));
    });
  }

  const porta = env.CRM_SERVICE_PORT;
  await servico.app.listen({ port: porta, host: '0.0.0.0' });
  servico.app.log.info(
    `Serviço de CRM ouvindo na porta ${porta} (${env.NODE_ENV}).`,
  );

  return servico;
}

// Só sobe o servidor quando este arquivo é o ponto de entrada: importar o
// módulo (em teste ou ferramenta) não pode ter efeito colateral.
if (require.main === module) {
  void bootstrap();
}
