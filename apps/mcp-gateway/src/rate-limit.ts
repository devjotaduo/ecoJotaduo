import { createHash } from 'node:crypto';

import type { Env } from '@ecojotaduo/config';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

/**
 * Limite de chamadas do gateway MCP.
 *
 * O que se está contendo aqui é diferente do que a API contém. Ali o risco é
 * força bruta contra segredo; aqui é **agente em laço**: um host que erre a
 * condição de parada bate na mesma tool centenas de vezes por minuto, e cada
 * chamada resolve acesso e consulta o banco. Não é ataque — é defeito de quem
 * integra, e mesmo assim derruba a plataforma para as outras empresas.
 *
 * Por isso a chave é a **credencial**: o teto pertence a quem conecta, e o
 * laço de um agente não consome a franquia de outra empresa. O contador vive
 * na memória do processo (a plataforma não tem Redis — ADR-0012), então com N
 * réplicas o teto efetivo é N vezes maior; ainda assim contém o laço.
 */
export function opcoesDeRateLimit(env: Env): RateLimitPluginOptions {
  return {
    global: true,
    timeWindow: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    max: env.RATE_LIMIT_MCP_MAX,
    keyGenerator: (requisicao: FastifyRequest) => chaveDaCredencial(requisicao),
    // Health check é chamado em laço por orquestrador: barrá-lo faria a
    // instância parecer doente e ser reiniciada.
    allowList: (requisicao: FastifyRequest) => requisicao.url === '/health',
    // Sem `errorResponseBuilder`: o plugin lança um `Error` com
    // `statusCode`, e quem formata erro aqui é o handler do gateway.
  };
}

/**
 * A credencial vira hash antes de ser usada como chave: o contador só precisa
 * distinguir quem chama, e guardar o token inteiro na memória do processo
 * seria guardar segredo sem necessidade.
 */
function chaveDaCredencial(requisicao: FastifyRequest): string {
  const credencial = requisicao.headers.authorization;
  if (!credencial) {
    return `ip:${requisicao.ip}`;
  }
  return `cred:${createHash('sha256').update(credencial).digest('hex').slice(0, 32)}`;
}
