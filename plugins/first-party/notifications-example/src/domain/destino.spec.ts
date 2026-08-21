import { describe, expect, it } from 'vitest';

import { DestinoRecusadoError, destinoPublicoHttps } from './destino';

/**
 * Sem esta política, "entregar no endereço configurado pela empresa" seria a
 * ferramenta `call_any_url` proibida com outro nome: quem administra uma
 * empresa usaria o servidor da plataforma como procurador para alcançar a
 * rede interna.
 */
describe('política de destino', () => {
  it('recusa http', async () => {
    await expect(
      destinoPublicoHttps(new URL('http://exemplo.com/hook')),
    ).rejects.toThrow(DestinoRecusadoError);
  });

  it('recusa loopback', async () => {
    for (const alvo of [
      'https://127.0.0.1/hook',
      'https://127.1.2.3/hook',
      'https://[::1]/hook',
    ]) {
      await expect(destinoPublicoHttps(new URL(alvo))).rejects.toThrow(
        /rede interna/,
      );
    }
  });

  it('recusa as faixas privadas e o endereço de metadados das nuvens', async () => {
    for (const alvo of [
      'https://10.0.0.5/hook',
      'https://172.16.0.9/hook',
      'https://172.31.255.1/hook',
      'https://192.168.1.10/hook',
      'https://100.64.0.1/hook', // CGNAT
      'https://169.254.169.254/latest/meta-data', // credenciais de instância
      'https://0.0.0.0/hook',
    ]) {
      await expect(destinoPublicoHttps(new URL(alvo))).rejects.toThrow(
        /rede interna/,
      );
    }
  });

  it('recusa IPv4 mapeado em IPv6, que burlaria a checagem v4', async () => {
    await expect(
      destinoPublicoHttps(new URL('https://[::ffff:127.0.0.1]/hook')),
    ).rejects.toThrow(/rede interna/);
  });

  it('recusa link-local e unique-local v6', async () => {
    for (const alvo of ['https://[fe80::1]/hook', 'https://[fd00::1]/hook']) {
      await expect(destinoPublicoHttps(new URL(alvo))).rejects.toThrow(
        /rede interna/,
      );
    }
  });

  it('aceita endereço público', async () => {
    await expect(
      destinoPublicoHttps(new URL('https://93.184.216.34/hook')),
    ).resolves.toBeUndefined();
  });

  it('recusa nome que não resolve, em vez de tentar conectar', async () => {
    await expect(
      destinoPublicoHttps(
        new URL('https://nao-existe.invalido-de-proposito.test/hook'),
      ),
    ).rejects.toThrow(DestinoRecusadoError);
  });
});
