import cookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  registrarContextoDeRequisicao,
  registrarHsts,
  registrarLogDeRequisicao,
} from './request-context';

/**
 * Preparo da borda HTTP: tudo o que precisa existir no Fastify **antes** das
 * rotas do Nest serem registradas.
 *
 * Concentrado numa função só, e não espalhado pelo `main.ts`, porque os testes
 * E2E montam a aplicação por conta própria: se cada um tivesse que lembrar da
 * lista, um plugin novo passaria a valer em produção e não no teste — que é a
 * pior das duas ordens, porque o teste continua verde.
 *
 * O `await` importa: registro de plugin do Fastify é adiado, e um hook que
 * chega depois das rotas simplesmente não vale para elas.
 *
 * O limite de requisições NÃO entra aqui de propósito — ele é ligado à parte
 * (`rate-limit.ts`), para que os demais E2E não gastem franquia fazendo login
 * a cada caso de teste.
 */
export async function prepararBordaHttp(
  app: NestFastifyApplication,
  opcoes: { readonly hsts?: boolean } = {},
): Promise<void> {
  const instancia = app.getHttpAdapter().getInstance();
  registrarContextoDeRequisicao(instancia);
  if (opcoes.hsts) {
    registrarHsts(instancia);
  }
  registrarLogDeRequisicao(instancia);
  // Lê e escreve o cookie `httpOnly` do refresh token (ver
  // `auth/refresh-cookie.ts`).
  await app.register(cookie);
}
