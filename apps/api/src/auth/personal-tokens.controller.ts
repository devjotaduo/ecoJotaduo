import type { PersonalAccessTokenUseCase } from '@ecojotaduo/identity';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  tokenPessoalCriadoResposta,
  tokensPessoaisResposta,
} from './auth.responses';

import { PERSONAL_TOKENS_USE_CASE } from '../bootstrap/tokens';
import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodResponse,
  problemaSchema,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';

/** Máximo de 1 ano: uma credencial sem prazo é uma credencial esquecida. */
const DIAS_MAXIMOS = 365;
const DIAS_PADRAO = 90;

const criarTokenSchema = z.object({
  name: z.string().min(1).max(80),
  /**
   * Teto de permissão do token. Padrão `*` NÃO significa "tudo": a decisão de
   * acesso continua sendo a interseção com os papéis vivos da pessoa. Reduzir
   * aqui restringe o agente; ampliar além do que ela pode é impossível.
   */
  scopes: z.array(z.string().min(1).max(120)).max(50).default(['*']),
  expiresInDays: z.number().int().min(1).max(DIAS_MAXIMOS).default(DIAS_PADRAO),
});

@ApiTags('Autenticação')
@ApiBearerAuth()
@Controller('api/v1/auth/personal-tokens')
export class PersonalTokensController {
  constructor(
    @Inject(PERSONAL_TOKENS_USE_CASE)
    private readonly tokens: PersonalAccessTokenUseCase,
  ) {}

  /**
   * Emite um token pessoal. O valor aparece UMA vez.
   *
   * Não exige permissão especial: uma pessoa sempre pode administrar as
   * próprias credenciais, e o token nunca alcança mais do que ela alcança.
   * Exige, isso sim, **sessão de verdade** — ver abaixo.
   */
  @Post()
  @HttpCode(201)
  @ApiErrosPadrao()
  @ApiOperation({
    operationId: 'authCreatePersonalToken',
    summary: 'Emite um token pessoal de longa duração',
  })
  @ApiZodBody(criarTokenSchema)
  @ApiZodResponse(201, tokenPessoalCriadoResposta, 'Token emitido.')
  @ApiZodResponse(403, problemaSchema, 'Exige sessão, não token pessoal.')
  async criar(
    @Body(new ZodValidationPipe(criarTokenSchema))
    corpo: z.infer<typeof criarTokenSchema>,
  ) {
    const auth = requireAuth();
    exigirSessaoDeVerdade();

    const emitido = await this.tokens.issue({
      userId: auth.actor.id,
      tenantId: auth.tenantId,
      name: corpo.name,
      scopes: corpo.scopes,
      expiresAt: new Date(Date.now() + corpo.expiresInDays * 86_400_000),
    });

    return {
      id: emitido.id,
      name: emitido.name,
      // A ÚNICA vez que o valor sai do servidor. Não há caminho de leitura.
      token: emitido.token,
      scopes: emitido.scopes,
      expiresAt: emitido.expiresAt?.toISOString() ?? null,
    };
  }

  @Get()
  @ApiErrosPadrao()
  @ApiOperation({
    operationId: 'authListPersonalTokens',
    summary: 'Lista os tokens pessoais em uso',
  })
  @ApiZodResponse(
    200,
    tokensPessoaisResposta,
    'Tokens da pessoa nesta empresa.',
  )
  async listar() {
    const auth = requireAuth();
    const itens = await this.tokens.list(auth.actor.id, auth.tenantId);

    return {
      // Nunca o valor: a listagem devolve a dica, que serve para reconhecer
      // qual revogar e não ajuda a adivinhar o resto.
      items: itens.map((token) => ({
        id: token.id,
        name: token.name,
        hint: token.hint,
        scopes: token.scopes,
        expiresAt: token.expiresAt?.toISOString() ?? null,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Revoga. Vale na requisição seguinte — não há cache de credencial.
   *
   * Aqui NÃO se exige sessão: alguém que perceba um vazamento precisa
   * conseguir cortar com o que tiver na mão, inclusive de dentro do agente.
   */
  @Delete(':tokenId')
  @HttpCode(204)
  @ApiErrosPadrao()
  @ApiOperation({
    operationId: 'authRevokePersonalToken',
    summary: 'Revoga um token pessoal',
  })
  @ApiZodResponse(404, problemaSchema, 'Token não encontrado.')
  async revogar(@Param('tokenId') tokenId: string): Promise<void> {
    const auth = requireAuth();
    await this.tokens.revoke({
      tokenId,
      userId: auth.actor.id,
      tenantId: auth.tenantId,
    });
  }
}

/**
 * Emitir token pessoal exige sessão de verdade, nunca outro token pessoal.
 *
 * Sem esta regra, um token vazado emite sucessores para sempre e revogar o
 * original não adianta nada — quem o roubou já teria outro. É a diferença
 * entre uma credencial revogável e uma que se renova sozinha.
 */
function exigirSessaoDeVerdade(): void {
  if (requireAuth().credential === 'personal-token') {
    throw new ForbiddenException(
      'Emitir token pessoal exige login. Um token pessoal não emite outro.',
    );
  }
}
