import { randomUUID } from 'node:crypto';

import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

import type {
  PersonalAccessTokenRecord,
  PersonalAccessTokenRepository,
  SecretHasher,
} from '../ports/repositories';

/**
 * Tokens pessoais de acesso.
 *
 * Servem ao caso em que um programa age em nome de uma PESSOA, de forma
 * continuada: o primeiro é um agente de IA num host MCP, que manda um
 * cabeçalho fixo e não tem como refazer login a cada quinze minutos.
 *
 * A alternativa — uma conta de serviço compartilhada — custaria a propriedade
 * central da plataforma: a trilha diria "conta de serviço" para todo mundo, e
 * as permissões deixariam de ser por pessoa.
 */

/**
 * Prefixo do token.
 *
 * Não é enfeite: torna o valor reconhecível num vazamento (dá para varrer
 * repositório e log procurando por ele) e permite distinguir, no cabeçalho
 * `Authorization`, um token pessoal de um JWT de sessão — sem tentar decodificar
 * o que talvez não seja um JWT.
 */
export const PREFIXO_DE_TOKEN_PESSOAL = 'ecj_pat_';

/** Quantos caracteres do token ficam visíveis na listagem. */
const TAMANHO_DA_DICA = 4;

export function ehTokenPessoal(valor: string): boolean {
  return valor.startsWith(PREFIXO_DE_TOKEN_PESSOAL);
}

/**
 * Falha de AUTENTICAÇÃO, e não erro de domínio.
 *
 * Por isso não estende `DomainError`: nesta API as falhas de autenticação são
 * deliberadamente uniformes — desconhecido, revogado e expirado devolvem o
 * mesmo 401 com o mesmo texto, e o motivo real fica no log. Distinguir diria a
 * quem sonda qual das três hipóteses acertou.
 */
export class PersonalTokenInvalidError extends Error {
  constructor() {
    super('Token pessoal inválido, expirado ou revogado.');
    this.name = 'PersonalTokenInvalidError';
  }
}

/**
 * Erro de domínio: o filtro de Problem Details traduz o `kind` para 404 sem
 * precisar conhecer esta classe.
 */
export class PersonalTokenNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';

  constructor() {
    super('Token pessoal não encontrado.');
  }
}

export interface TokenPessoalEmitido {
  readonly id: string;
  readonly name: string;
  /** O valor em claro. Aparece UMA vez, na criação, e nunca mais. */
  readonly token: string;
  readonly expiresAt: Date | null;
  readonly scopes: readonly string[];
}

export interface TokenPessoalResumo {
  readonly id: string;
  readonly name: string;
  /** Início do valor, para a pessoa saber qual revogar. */
  readonly hint: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

export interface PortadorDoTokenPessoal {
  readonly tokenId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
}

export interface GeradorDeToken {
  create(): string;
}

/** Uma hora: `last_used_at` responde "está esquecido?", não é métrica. */
const INTERVALO_DE_USO_MS = 60 * 60 * 1000;

export class PersonalAccessTokenUseCase {
  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly hasher: SecretHasher,
    private readonly generator: GeradorDeToken,
  ) {}

  /**
   * Emite um token pessoal.
   *
   * `scopes` é um TETO, não uma concessão: a decisão de acesso continua sendo
   * a interseção com os papéis vivos da pessoa. Reduzir aqui restringe o que o
   * agente pode fazer; não há como ampliar além do que ela mesma pode.
   */
  async issue(
    entrada: {
      userId: string;
      tenantId: string;
      name: string;
      scopes: readonly string[];
      expiresAt?: Date | null;
    },
    agora: Date = new Date(),
  ): Promise<TokenPessoalEmitido> {
    const valor = `${PREFIXO_DE_TOKEN_PESSOAL}${this.generator.create()}`;
    const id = randomUUID();
    const expiresAt = entrada.expiresAt ?? null;

    await this.tokens.save({
      id,
      userId: entrada.userId,
      tenantId: entrada.tenantId,
      name: entrada.name,
      tokenHash: this.hasher.hash(valor),
      hint: valor.slice(
        PREFIXO_DE_TOKEN_PESSOAL.length,
        PREFIXO_DE_TOKEN_PESSOAL.length + TAMANHO_DA_DICA,
      ),
      scopes: [...entrada.scopes],
      expiresAt,
      createdAt: agora,
    });

    return {
      id,
      name: entrada.name,
      token: valor,
      expiresAt,
      scopes: entrada.scopes,
    };
  }

  list(userId: string, tenantId: string): Promise<TokenPessoalResumo[]> {
    return this.tokens.listOfUser(userId, tenantId);
  }

  /**
   * Revoga. Só o dono revoga o próprio token — a busca é por (id, usuário),
   * então adivinhar o id de outra pessoa não ajuda.
   */
  async revoke(
    entrada: { tokenId: string; userId: string; tenantId: string },
    agora: Date = new Date(),
  ): Promise<void> {
    const revogou = await this.tokens.revoke(
      entrada.tokenId,
      entrada.userId,
      entrada.tenantId,
      agora,
    );
    if (!revogou) {
      throw new PersonalTokenNotFoundError();
    }
  }

  /**
   * Autentica um token apresentado.
   *
   * Devolve o portador ou lança — e lança a MESMA coisa para desconhecido,
   * revogado e expirado. Distinguir aqui diria a quem sonda qual das três
   * hipóteses acertou.
   */
  async authenticate(
    valor: string,
    agora: Date = new Date(),
  ): Promise<PortadorDoTokenPessoal> {
    const registro = await this.tokens.findByHash(this.hasher.hash(valor));
    if (!registro || registro.revokedAt) {
      throw new PersonalTokenInvalidError();
    }
    if (registro.expiresAt && registro.expiresAt.getTime() <= agora.getTime()) {
      throw new PersonalTokenInvalidError();
    }

    await this.marcarUso(registro, agora);

    return {
      tokenId: registro.id,
      userId: registro.userId,
      tenantId: registro.tenantId,
      scopes: registro.scopes,
    };
  }

  /**
   * Escrita de propósito grosseira: no máximo uma por hora, por token.
   *
   * Gravar a cada requisição transformaria toda leitura autenticada numa
   * escrita — o caminho mais quente da plataforma. O que se quer saber é
   * "este token está esquecido?", e para isso uma hora de resolução sobra.
   */
  private async marcarUso(
    registro: PersonalAccessTokenRecord,
    agora: Date,
  ): Promise<void> {
    const ultimo = registro.lastUsedAt?.getTime() ?? 0;
    if (agora.getTime() - ultimo < INTERVALO_DE_USO_MS) {
      return;
    }
    await this.tokens.markUsed(registro.id, agora);
  }
}
