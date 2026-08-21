import { provisionarEmpresa } from './provisionar-empresa';

/**
 * Cria a empresa e o usuário de desenvolvimento local.
 *
 * É o MESMO provisionamento usado em produção, com os padrões de dev: senha
 * conhecida e fixa. Dois caminhos de criação de empresa divergiriam em
 * silêncio — o de dev funcionaria e o operado só seria exercitado no dia em
 * que houvesse uma empresa de verdade para criar.
 *
 * Recusa rodar em produção justamente por causa da senha fixa. Lá o comando é
 * `provision`, que gera uma senha forte e a mostra uma vez.
 */
export async function semearDesenvolvimento(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed:dev não roda em produção — use "provision", que gera senha forte.',
    );
  }

  const empresa = await provisionarEmpresa({
    slug: process.env.SEED_TENANT_SLUG ?? 'demo',
    email: process.env.SEED_USER_EMAIL ?? 'admin@demo.local',
    senha: process.env.SEED_USER_PASSWORD ?? 'senha-de-desenvolvimento',
  });

  console.log(
    empresa.jaExistia
      ? `Empresa "${empresa.slug}" já existia — módulos conferidos.`
      : `Empresa "${empresa.slug}" criada com o usuário ${empresa.email}.`,
  );
  console.log(`Módulos contratados: ${empresa.modulosContratados.join(', ')}.`);
  console.log('Senha definida por SEED_USER_PASSWORD (padrão de dev).');
}

if (require.main === module) {
  semearDesenvolvimento().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
