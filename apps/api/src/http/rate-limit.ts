import { createHash } from 'node:crypto';

import type { Env } from '@ecojotaduo/config';
import rateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

export const ROTA_DE_LOGIN = '/api/v1/auth/login';

/**
 * Limite de requisições da API.
 *
 * Duas decisões que valem explicação:
 *
 * **A chave é a credencial, não o IP.** Um ERP é usado atrás de NAT
 * corporativo: dezenas de pessoas da mesma empresa saem pelo mesmo endereço, e
 * um balde por IP puniria a empresa inteira pelo uso de uma pessoa. Cada
 * credencial tem o seu. Só o que chega sem credencial cai no balde do IP.
 *
 * **O login tem balde próprio.** Se dividisse o balde com as rotas
 * autenticadas, uso normal consumiria a franquia de login e uma pessoa
 * legítima acabaria barrada ao renovar a sessão. Separando, o teto apertado
 * vale só para quem está tentando adivinhar segredo.
 *
 * O contador vive na memória do processo: a plataforma não tem Redis
 * (ADR-0012), então com N réplicas o teto efetivo é N vezes maior. Isso ainda
 * contém força bruta, e trocar por um store compartilhado é configuração.
 */
export function opcoesDeRateLimit(env: Env): RateLimitPluginOptions {
  return {
    global: true,
    timeWindow: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    max: (requisicao: FastifyRequest) =>
      ehLogin(requisicao) ? env.RATE_LIMIT_LOGIN_MAX : env.RATE_LIMIT_MAX,
    keyGenerator: (requisicao: FastifyRequest) => chaveDoBalde(requisicao),
    // Health check não entra na conta: ele é chamado por orquestrador, em
    // laço, e barrá-lo derrubaria a instância por parecer doente.
    allowList: (requisicao: FastifyRequest) => requisicao.url === '/health',
    // Sem `errorResponseBuilder`: o plugin lança um `Error` com
    // `statusCode`, e quem formata erro nesta API é o `ProblemDetailsFilter`.
    // Um segundo formatador aqui daria duas formas de erro para o SDK
    // aprender, e uma delas ficaria para trás na primeira mudança.
  };
}

function ehLogin(requisicao: FastifyRequest): boolean {
  return requisicao.url.startsWith(ROTA_DE_LOGIN);
}

/**
 * Chave do balde.
 *
 * A credencial é reduzida a um hash: a chave fica na memória do processo, e
 * guardar o token inteiro ali seria guardar segredo sem precisar. O hash
 * distingue credenciais, que é tudo o que o contador precisa.
 */
function chaveDoBalde(requisicao: FastifyRequest): string {
  if (ehLogin(requisicao)) {
    return `login:${requisicao.ip}`;
  }

  const credencial = requisicao.headers.authorization;
  if (!credencial) {
    return `ip:${requisicao.ip}`;
  }
  return `cred:${createHash('sha256').update(credencial).digest('hex').slice(0, 32)}`;
}

/**
 * Liga o limitador na aplicação.
 *
 * Função à parte, e não dentro do `bootstrap`, porque os testes montam a
 * aplicação por conta própria: assim o E2E do limite exercita exatamente o que
 * a produção usa, e os demais E2E não gastam franquia fazendo login a cada
 * caso de teste.
 */
export async function registrarLimiteDeRequisicoes(
  app: NestFastifyApplication,
  env: Env,
): Promise<void> {
  await app.register(rateLimit, opcoesDeRateLimit(env));
}
