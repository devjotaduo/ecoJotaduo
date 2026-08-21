import type {
  CrmCustomerSummary,
  CrmPublicApi,
} from '../../contracts/public-api';

/**
 * A MESMA superfície pública do CRM, atendida por HTTP em vez de em processo.
 *
 * É a peça que a Fase 12 existe para provar: quem consome o CRM depende de
 * `CrmPublicApi`, e não de onde o CRM roda. Trocar `CrmService` por este
 * cliente é uma linha no composition root — nenhum caso de uso muda, nenhuma
 * assinatura muda, nenhum teste de negócio muda.
 */

/**
 * O que o cliente precisa para se autenticar, dito com as palavras deste
 * módulo. Uma porta, e não `TokenService` direto: o CRM não deveria conhecer
 * o formato do token da plataforma para conseguir chamar a si mesmo.
 */
export interface EmissorDeTokenInterno {
  /**
   * Token de vida curta para UMA chamada, preso à empresa.
   *
   * A empresa viaja no token assinado, e não no corpo nem na URL. É o ponto
   * que separa "chamada interna" de "buraco de multi-tenancy": quem alcançar
   * a porta do serviço não escolhe de qual empresa quer ler.
   */
  emitirParaEmpresa(tenantId: string): string;
}

export class ServicoDeCrmIndisponivelError extends Error {
  constructor(detalhe: string, opcoes?: ErrorOptions) {
    super(`Serviço de CRM não respondeu: ${detalhe}`, opcoes);
    this.name = 'ServicoDeCrmIndisponivelError';
  }
}

export interface OpcoesDoClienteDeCrm {
  readonly baseUrl: string;
  readonly emissor: EmissorDeTokenInterno;
  /** Injetável para teste; por padrão o fetch global. */
  readonly fetch?: typeof fetch;
  /** Sem teto, uma chamada travada segura a requisição inteira. */
  readonly timeoutMs?: number;
}

export class CrmHttpClient implements CrmPublicApi {
  private readonly baseUrl: string;
  private readonly emissor: EmissorDeTokenInterno;
  private readonly fetchInterno: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opcoes: OpcoesDoClienteDeCrm) {
    this.baseUrl = opcoes.baseUrl.replace(/\/+$/, '');
    this.emissor = opcoes.emissor;
    this.fetchInterno = opcoes.fetch ?? globalThis.fetch;
    this.timeoutMs = opcoes.timeoutMs ?? 3000;
  }

  async findCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<CrmCustomerSummary | null> {
    const resposta = await this.chamar(
      `/internal/crm/customers/${encodeURIComponent(customerId)}`,
      tenantId,
    );

    // Ausência é resposta legítima, e o contrato diz `null` — não erro. O
    // serviço responde 200 com `customer: null` justamente para não confundir
    // "cliente não existe" com "rota não existe".
    if (resposta.status === 404) {
      return null;
    }
    if (!resposta.ok) {
      throw new ServicoDeCrmIndisponivelError(
        `HTTP ${resposta.status} em ${customerId}`,
      );
    }

    const corpo = (await resposta.json()) as {
      customer: CrmCustomerSummary | null;
    };
    return corpo.customer;
  }

  private async chamar(caminho: string, tenantId: string): Promise<Response> {
    const cancelamento = AbortSignal.timeout(this.timeoutMs);
    try {
      return await this.fetchInterno(`${this.baseUrl}${caminho}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.emissor.emitirParaEmpresa(tenantId)}`,
          accept: 'application/json',
        },
        signal: cancelamento,
      });
    } catch (causa) {
      // Rede fora, DNS errado, tempo esgotado: falha de INFRAESTRUTURA, e não
      // "cliente não encontrado". Devolver `null` aqui faria uma proposta ser
      // recusada por indisponibilidade como se o cliente não existisse.
      throw new ServicoDeCrmIndisponivelError(
        causa instanceof Error ? causa.message : 'erro desconhecido',
        { cause: causa },
      );
    }
  }
}
