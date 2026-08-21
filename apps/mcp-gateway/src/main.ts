import { loadEnv } from '@ecojotaduo/config';

import { criarGateway, ROTA_MCP, type Gateway } from './gateway';

export async function bootstrap(): Promise<Gateway> {
  // Fail-fast: ambiente inválido derruba o boot com mensagem clara.
  const env = loadEnv();
  const gateway = await criarGateway(env);

  // Drena o pool de conexões antes de sair. Sem isto, um deploy sem downtime
  // derrubaria chamadas de agente em andamento junto com o processo.
  const encerrar = async (): Promise<void> => {
    await gateway.app.close();
    await gateway.nucleo.handle.close();
  };
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void encerrar().finally(() => process.exit(0));
    });
  }

  await gateway.app.listen({ port: env.MCP_PORT, host: '0.0.0.0' });
  gateway.app.log.info(
    `Gateway MCP ouvindo na porta ${env.MCP_PORT} em ${ROTA_MCP} (${env.NODE_ENV}).`,
  );

  return gateway;
}

// Só sobe o servidor quando este arquivo é o ponto de entrada: importar o
// módulo (em teste ou ferramenta) não pode ter efeito colateral.
if (require.main === module) {
  void bootstrap();
}
