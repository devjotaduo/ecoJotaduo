/**
 * Formatação para a tela.
 *
 * Dinheiro chega da API em CENTAVOS inteiros (convenção da plataforma). A
 * divisão por 100 acontece só aqui, na última hora, e nada volta para a API
 * neste formato — o caminho inverso (`emCentavos`) é o único que converte de
 * volta, e arredonda de propósito para não mandar fração de centavo.
 */

const MOEDA = new Map<string, Intl.NumberFormat>();

export function dinheiro(centavos: number, moeda: string): string {
  let formatador = MOEDA.get(moeda);
  if (!formatador) {
    formatador = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: moeda,
    });
    MOEDA.set(moeda, formatador);
  }
  return formatador.format(centavos / 100);
}

/** Converte o que a pessoa digitou ("1.999,90") em centavos inteiros. */
export function emCentavos(texto: string): number {
  const normalizado = texto.trim().replace(/\./g, '').replace(',', '.');
  // Texto vazio precisa virar NaN, e não zero: `Number('')` é 0, e sem esta
  // guarda um campo de preço em branco viraria uma proposta de R$ 0,00 sem
  // ninguém notar.
  if (normalizado === '') {
    return Number.NaN;
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) {
    return Number.NaN;
  }
  return Math.round(valor * 100);
}

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function data(iso: string): string {
  return DATA.format(new Date(iso));
}

export function dataHora(iso: string): string {
  return DATA_HORA.format(new Date(iso));
}

/** Rótulos de situação em português, para não vazar o enum da API na tela. */
export const SITUACAO: Record<string, string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  accepted: 'Aceita',
  rejected: 'Recusada',
  expired: 'Vencida',
  active: 'Ativo',
  finished: 'Encerrado',
  canceled: 'Cancelado',
  archived: 'Arquivado',
  scheduled: 'Agendado',
  done: 'Realizado',
};

export function situacao(chave: string): string {
  return SITUACAO[chave] ?? chave;
}
