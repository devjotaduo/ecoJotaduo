import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/**
 * Guarda contra SSRF no destino do webhook.
 *
 * Sem isto, "entregar num endereço configurado pela empresa" seria a tool
 * `call_any_url` proibida (docs/architecture/mcp-model.md) com outro nome: o
 * administrador de uma empresa apontaria o webhook para `169.254.169.254` ou
 * para um serviço interno e usaria o servidor da plataforma como procurador
 * para alcançar a rede privada.
 *
 * A checagem resolve o nome e olha TODOS os endereços: validar só a string da
 * URL não protege de um domínio público que aponta para 127.0.0.1.
 */

export class DestinoRecusadoError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(motivo: string) {
    super(`Destino do webhook recusado: ${motivo}`);
  }
}

/** Política de destino, injetável para que o teste use um servidor local. */
export type PoliticaDeDestino = (url: URL) => Promise<void>;

function ehPrivado(endereco: string, familia: number): boolean {
  if (familia === 6) {
    const normalizado = endereco.toLowerCase();
    return (
      normalizado === '::1' ||
      normalizado === '::' ||
      normalizado.startsWith('fc') || // unique-local
      normalizado.startsWith('fd') ||
      normalizado.startsWith('fe80') || // link-local
      // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) burlaria a checagem v4.
      normalizado.startsWith('::ffff:')
    );
  }

  const octetos = endereco.split('.').map(Number);
  const [a = 0, b = 0] = octetos;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, inclui o metadata das nuvens
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast e reservados
  );
}

/**
 * Política padrão: HTTPS e nenhum endereço privado.
 *
 * Janela residual conhecida: entre a resolução e a conexão o DNS pode mudar
 * (rebinding). Fechar isso exige conectar no IP já validado com o Host
 * original — entra quando houver uma biblioteca de saída controlada.
 */
export const destinoPublicoHttps: PoliticaDeDestino = async (url) => {
  if (url.protocol !== 'https:') {
    throw new DestinoRecusadoError('apenas https é aceito.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const enderecos = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new DestinoRecusadoError('o endereço não pôde ser resolvido.');
      });

  for (const { address, family } of enderecos) {
    if (ehPrivado(address, family)) {
      throw new DestinoRecusadoError(
        'o endereço resolve para a rede interna do servidor.',
      );
    }
  }
};
