import { openSecret, sealSecret } from '@ecojotaduo/auth';

import type { DonoDeSegredo, SecretSealer } from '../../ports/repositories';

/**
 * Implementação da porta de cifra sobre o cofre do `@ecojotaduo/auth`.
 *
 * A chave-mestra entra pelo construtor e não sai daqui: nem os casos de uso
 * nem os repositórios a enxergam. Trocar de algoritmo (ou passar a usar um
 * KMS) é substituir esta classe no composition root.
 */
export class CofreDeSegredosDoPlugin implements SecretSealer {
  constructor(private readonly chave: Buffer) {}

  seal(valor: string, dono: DonoDeSegredo): string {
    return sealSecret(valor, this.chave, this.donoDaCifra(dono));
  }

  open(selado: string, dono: DonoDeSegredo): string {
    return openSecret(selado, this.chave, this.donoDaCifra(dono));
  }

  /** O plugin é o "dono" do segredo dentro da empresa. */
  private donoDaCifra(dono: DonoDeSegredo) {
    return {
      tenantId: dono.tenantId,
      ownerId: dono.pluginId,
      key: dono.key,
    };
  }
}
