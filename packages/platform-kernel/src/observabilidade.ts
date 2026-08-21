/**
 * Cabeçalhos de segurança e log de requisição — as duas coisas que toda borda
 * HTTP desta plataforma precisa e que não têm nada de específico de módulo.
 *
 * Vive no kernel, e não no `http-kit`, por um motivo concreto: o `http-kit`
 * depende de NestJS, e o gateway MCP não pode arrastar NestJS para dentro do
 * processo só para saber quais cabeçalhos mandar. Aqui são funções puras que
 * devolvem dados — quem liga o hook é cada app, com o seu transporte.
 */

/**
 * Cabeçalhos de resposta.
 *
 * Esta é uma API **JSON**, não um site: metade do que um `helmet` da vida
 * configura (política de imagens, de fontes, de frames aninhados) protege
 * páginas que aqui não existem. O que resta é curto o bastante para ficar
 * explícito, com o motivo de cada um ao lado.
 */
export const CABECALHOS_DE_SEGURANCA: Readonly<Record<string, string>> = {
  // O navegador não deve adivinhar o tipo do corpo. Sem isto, uma resposta
  // que carregue texto controlado por quem cadastrou pode ser interpretada
  // como HTML e executar no contexto do domínio.
  'x-content-type-options': 'nosniff',
  // Nada aqui deve ser exibido dentro de um frame — não há tela para
  // enquadrar, e permitir seria abrir clickjacking à toa.
  'x-frame-options': 'DENY',
  // Uma resposta de API não deve carregar nada para fora, nem a si mesma.
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  // O caminho da requisição costuma ter id de recurso. Não vaza no `Referer`.
  'referrer-policy': 'no-referrer',
  // Nenhum recurso do navegador é usado por respostas JSON.
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** HSTS só faz sentido sob HTTPS: em HTTP puro o navegador ignora. */
export const HSTS = 'max-age=31536000; includeSubDomains';

export interface LinhaDeRequisicao {
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  readonly correlationId: string;
  readonly tenantId?: string;
  readonly actorKind?: string;
  readonly actorId?: string;
  readonly channel: string;
}

/**
 * Uma linha por requisição, em JSON.
 *
 * O critério de aceite da fase é conseguir responder, para qualquer chamada:
 * **quem, de qual empresa, por qual interface, o quê, quanto tempo e com que
 * resultado**. A trilha de auditoria responde isso para ações de negócio; esta
 * linha responde para o resto — leitura, erro, recusa, health check.
 *
 * JSON e não texto porque o destino é um agregador, e um formato que precisa
 * de expressão regular para virar campo acaba não sendo consultado.
 *
 * O que NUNCA entra: corpo, query string, cabeçalho de autorização. Uma linha
 * de log atravessa processos, fica guardada por meses e sai da plataforma —
 * é o mesmo cuidado que vale para evento de domínio.
 */
export function linhaDeRequisicao(dados: LinhaDeRequisicao): string {
  return JSON.stringify({
    nivel:
      dados.status >= 500 ? 'error' : dados.status >= 400 ? 'warn' : 'info',
    tipo: 'requisicao',
    ...dados,
  });
}
