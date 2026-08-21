/**
 * Espelho, no cliente, da decisão que o servidor toma.
 *
 * Serve para ESCONDER o que não adianta mostrar: um botão que só levaria a
 * 403. Não é barreira — a mesma decisão roda no servidor a cada chamada, e é
 * lá que ela vale (docs/architecture/security-model.md). Se as duas
 * divergirem, quem está certo é o servidor.
 */

/** Mesma regra de curinga do motor: `*`, `crm.*`, `crm.customer.*`. */
export function concede(
  padroes: readonly string[],
  permissao: string,
): boolean {
  return padroes.some((padrao) => {
    if (padrao === '*' || padrao === permissao) return true;
    if (!padrao.endsWith('.*')) return false;
    const prefixo = padrao.slice(0, -1);
    return permissao.startsWith(prefixo) && permissao.length > prefixo.length;
  });
}

/** Unidade de contratação: `plugin.<id>` para plugin, primeiro segmento no resto. */
export function moduloDe(permissao: string): string {
  const partes = permissao.split('.');
  if (partes[0] === 'plugin' && partes.length > 1) {
    return `plugin.${partes[1]}`;
  }
  return partes[0] ?? permissao;
}

export function podeNaInterface(
  acesso: {
    readonly permissions: readonly string[];
    readonly entitlements: readonly string[];
  } | null,
  permissao: string,
): boolean {
  if (!acesso) return false;
  const modulo = moduloDe(permissao);
  // `platform.*` é o único prefixo isento de contratação.
  if (modulo !== 'platform' && !acesso.entitlements.includes(modulo)) {
    return false;
  }
  return concede(acesso.permissions, permissao);
}
