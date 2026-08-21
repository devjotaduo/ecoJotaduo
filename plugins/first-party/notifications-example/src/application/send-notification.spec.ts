import { createHmac } from 'node:crypto';

import { NoopAuditLogger } from '@ecojotaduo/audit';
import {
  PermissaoDoPluginNegadaError,
  type PluginRuntime,
} from '@ecojotaduo/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { ConfiguracaoDeNotificacoes } from '../config';
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
} from '../domain/assinatura';
import { DestinoRecusadoError } from '../domain/destino';

import {
  EntregaFalhouError,
  SendNotificationUseCase,
  type LeitorDeClientes,
} from './send-notification.use-case';

const SEGREDO = 'segredo-de-assinatura-do-teste';
const TENANT = '11111111-1111-4111-8111-111111111111';

function runtime(
  parcial: Partial<PluginRuntime<ConfiguracaoDeNotificacoes>> = {},
): PluginRuntime<ConfiguracaoDeNotificacoes> {
  return {
    pluginId: 'notifications-example',
    tenantId: TENANT,
    actorId: 'usuario-1',
    config: { webhookUrl: 'https://destino.test/hook' },
    grant: {
      permissions: ['crm.customer.read'],
      scopes: ['crm.customer.read'],
      entitlements: ['crm'],
    },
    segredo: () => SEGREDO,
    ...parcial,
  };
}

const clientes: LeitorDeClientes = {
  nomeDoCliente: () => Promise.resolve('Construtora Alfa'),
};

const permissiva = () => Promise.resolve();

function fetchQueResponde(status = 200): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(null, { status })));
}

/** Captura o que seria enviado, sem sair da máquina. */
function espiaoDeFetch(): { espiao: typeof fetch; chamadas: Request[] } {
  const chamadas: Request[] = [];
  const espiao: typeof fetch = (entrada, init) => {
    chamadas.push(new Request(entrada, init));
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  return { espiao, chamadas };
}

describe('envio de notificação', () => {
  it('assina o corpo JUNTO com o timestamp', async () => {
    // Assinar só o corpo deixaria a mesma entrega válida para sempre: quem
    // capturasse uma poderia repeti-la indefinidamente.
    const { espiao, chamadas } = espiaoDeFetch();

    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      espiao,
      permissiva,
    );
    await caso.execute({ runtime: runtime(), message: 'olá' });

    const enviada = chamadas[0];
    expect(enviada).toBeDefined();
    const corpo = await enviada!.text();
    const timestamp = enviada!.headers.get(CABECALHO_TIMESTAMP);
    const esperada = `v1=${createHmac('sha256', SEGREDO)
      .update(`${timestamp}.${corpo}`, 'utf8')
      .digest('hex')}`;

    expect(enviada!.headers.get(CABECALHO_ASSINATURA)).toBe(esperada);
  });

  it('não coloca o segredo no corpo nem em nenhum cabeçalho legível', async () => {
    const { espiao, chamadas } = espiaoDeFetch();

    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      espiao,
      permissiva,
    );
    await caso.execute({ runtime: runtime(), message: 'olá' });

    const enviada = chamadas[0]!;
    const tudo = `${await enviada.text()}${JSON.stringify([...enviada.headers])}`;
    expect(tudo).not.toContain(SEGREDO);
  });

  it('exige a permissão CONCEDIDA NA INSTALAÇÃO para citar um cliente', async () => {
    const semPermissao = runtime({
      grant: { permissions: [], scopes: [], entitlements: ['crm'] },
    });
    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      fetchQueResponde(),
      permissiva,
    );

    await expect(
      caso.execute({
        runtime: semPermissao,
        message: 'olá',
        customerId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(PermissaoDoPluginNegadaError);
  });

  it('cancelar o módulo CRM corta o acesso do plugin, mesmo com a permissão concedida', async () => {
    // A concessão da instalação continua lá; o que sumiu foi o entitlement.
    const semModulo = runtime({
      grant: {
        permissions: ['crm.customer.read'],
        scopes: ['crm.customer.read'],
        entitlements: [],
      },
    });
    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      fetchQueResponde(),
      permissiva,
    );

    await expect(
      caso.execute({
        runtime: semModulo,
        message: 'olá',
        customerId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(PermissaoDoPluginNegadaError);
  });

  it('mensagem sem cliente não exige permissão nenhuma da plataforma', async () => {
    const semNada = runtime({
      grant: { permissions: [], scopes: [], entitlements: [] },
    });
    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      fetchQueResponde(202),
      permissiva,
    );

    const resultado = await caso.execute({ runtime: semNada, message: 'olá' });
    expect(resultado.status).toBe(202);
    expect(resultado.customerName).toBeNull();
  });

  it('passa pela política de destino antes de conectar', async () => {
    const conectou = vi.fn<typeof fetch>();
    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      conectou,
      () => Promise.reject(new DestinoRecusadoError('teste')),
    );

    await expect(
      caso.execute({ runtime: runtime(), message: 'olá' }),
    ).rejects.toThrow(DestinoRecusadoError);
    expect(conectou).not.toHaveBeenCalled();
  });

  it('destino que recusa vira erro de negócio, com o status', async () => {
    const caso = new SendNotificationUseCase(
      clientes,
      new NoopAuditLogger(),
      fetchQueResponde(500),
      permissiva,
    );

    await expect(
      caso.execute({ runtime: runtime(), message: 'olá' }),
    ).rejects.toThrow(EntregaFalhouError);
  });

  it('audita o host e o status, nunca a URL inteira', async () => {
    // Caminho e query de webhook costumam carregar token do destino.
    const audit = new NoopAuditLogger();
    const caso = new SendNotificationUseCase(
      clientes,
      audit,
      fetchQueResponde(),
      permissiva,
    );
    await caso.execute({
      runtime: runtime({
        config: { webhookUrl: 'https://destino.test/hook?token=abc' },
      }),
      message: 'olá',
    });

    const registro = audit.entries[0];
    expect(registro?.metadata).toEqual({ host: 'destino.test', status: 200 });
    expect(JSON.stringify(registro)).not.toContain('token=abc');
  });
});
