import {
  AUDIENCIA_INTERNA,
  InvalidTokenError,
  TokenService,
} from '@ecojotaduo/auth';
import type { Env } from '@ecojotaduo/config';
import { createDatabase, type DatabaseHandle } from '@ecojotaduo/database';
import { DrizzleCustomerRepository, CrmService } from '@ecojotaduo/crm';
import {
  CABECALHOS_DE_SEGURANCA,
  linhaDeRequisicao,
} from '@ecojotaduo/platform-kernel';
import { createContext, runWithContext } from '@ecojotaduo/tenant-context';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

export const ROTA_CLIENTE = '/internal/crm/customers/:customerId';

export interface ServicoDeCrm {
  readonly app: FastifyInstance;
  readonly handle: DatabaseHandle;
}

/**
 * Composition root do CRM extraído.
 *
 * O ponto da Fase 12 está no que este arquivo **não** faz: não reimplementa
 * nada. Monta o MESMO `CrmService` do monólito sobre o MESMO repositório
 * Drizzle, e só troca a borda — de chamada em processo para HTTP.
 *
 * O que muda de verdade é a fronteira de confiança. Em processo, quem passava
 * `tenantId` era código do mesmo build. Aqui a empresa chega pela rede, e por
 * isso vem no `tid` de um token ASSINADO, verificado antes de qualquer
 * consulta — nunca por parâmetro de rota ou corpo. Quem alcançar esta porta
 * não escolhe de qual empresa quer ler.
 *
 * O banco é o `DATABASE_URL` deste processo, que pode ser outro: nenhuma
 * tabela `crm_*` tem chave estrangeira para fora do módulo, e há teste para
 * isso.
 */
export function criarServicoDeCrm(env: Env): ServicoDeCrm {
  const handle = createDatabase({
    url: env.DATABASE_URL,
    quiet: env.NODE_ENV === 'test',
  });

  // Verificador com a audiência INTERNA: um access token de usuário (audiência
  // da API pública) é recusado aqui, e vice-versa.
  const tokens = new TokenService({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: AUDIENCIA_INTERNA,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });

  const crm = new CrmService(new DrizzleCustomerRepository(handle.db));
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.addHook('onRequest', (_requisicao, resposta, feito) => {
    for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
      void resposta.header(nome, valor);
    }
    feito();
  });

  app.addHook('onResponse', (requisicao, resposta, feito) => {
    app.log.info(
      linhaDeRequisicao({
        method: requisicao.method,
        route: requisicao.routeOptions?.url ?? requisicao.url,
        status: resposta.statusCode,
        durationMs: Math.round(resposta.elapsedTime),
        correlationId: '',
        channel: 'internal',
      }),
    );
    feito();
  });

  /**
   * Erro genérico. A mensagem do erro real carrega nome de tabela e trecho de
   * consulta; o chamador recebe o suficiente para saber que falhou, e o motivo
   * fica no log — mesma regra das outras bordas.
   */
  app.setErrorHandler((erro, _requisicao, resposta) => {
    app.log.error(erro);
    void resposta
      .status(500)
      .send({ error: 'Erro interno no serviço de CRM.' });
  });

  app.get('/health', () => ({ status: 'ok', service: 'crm-service' }));

  app.get('/health/ready', async (_requisicao, resposta) => {
    try {
      await handle.sql`select 1`;
      return { status: 'ready', checks: { database: 'ok' } };
    } catch {
      return resposta.status(503).send({ status: 'unavailable' });
    }
  });

  app.get(ROTA_CLIENTE, async (requisicao, resposta) => {
    const empresa = empresaDoToken(requisicao, tokens);
    if (!empresa) {
      return resposta
        .status(401)
        .header('www-authenticate', 'Bearer realm="ecojotaduo-internal"')
        .send({ error: 'Credencial interna ausente ou inválida.' });
    }

    const { customerId } = requisicao.params as { customerId: string };
    // Dentro do contexto: é dele que a persistência tira a empresa para o
    // escopo da transação (RLS). Sem ele o repositório se recusa a consultar.
    const cliente = await runWithContext(createContext('job'), () =>
      crm.findCustomer(empresa, customerId),
    );

    // 200 com `customer: null`, e não 404: ausência de cliente é resposta
    // legítima do contrato, e confundi-la com "rota não existe" faria um erro
    // de caminho passar por cliente inexistente.
    return { customer: cliente };
  });

  return { app, handle };
}

/**
 * A empresa vem do `tid` do token verificado — nunca de parâmetro.
 *
 * Devolve `undefined` para qualquer recusa (ausente, malformado, expirado,
 * audiência errada, ator errado): quem chama recebe o mesmo 401 nos cinco
 * casos, e o motivo fica no log. Distinguir aqui ajudaria quem está sondando.
 */
function empresaDoToken(
  requisicao: FastifyRequest,
  tokens: TokenService,
): string | undefined {
  const cabecalho = requisicao.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) {
    return undefined;
  }
  try {
    const claims = tokens.verify(cabecalho.slice('Bearer '.length).trim());
    // Só chamada entre serviços. Um token de usuário, mesmo válido para a API
    // pública, não abre esta porta.
    return claims.kind === 'service' ? claims.tid : undefined;
  } catch (causa) {
    if (causa instanceof InvalidTokenError) {
      return undefined;
    }
    throw causa;
  }
}
