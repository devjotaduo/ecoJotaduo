import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { AUDIENCIA_INTERNA, TokenService } from '@ecojotaduo/auth';
import { loadEnv } from '@ecojotaduo/config';
import {
  createDatabase,
  runMigrations,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import { CrmService, DrizzleCustomerRepository } from '@ecojotaduo/crm';
import type { CrmPublicApi } from '@ecojotaduo/crm';
import {
  CrmHttpClient,
  ServicoDeCrmIndisponivelError,
  type EmissorDeTokenInterno,
} from '@ecojotaduo/crm/remote';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  temBancoDeTeste,
  urlDaAplicacao,
  urlDoDono,
} from '@ecojotaduo/test-support';
import { createContext, runWithContext } from '@ecojotaduo/tenant-context';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarServicoDeCrm, type ServicoDeCrm } from '../src/service';

exigirBancoEmCI();

const JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
const EMISSOR = 'ecojotaduo-platform';

/** Banco próprio do serviço extraído: só as tabelas `crm_*` vivem aqui. */
const BANCO_DO_CRM = 'ecojotaduo_test_crm_extraido';

const EMPRESA_A = '019a0000-0000-7000-8000-00000000000a';
const EMPRESA_B = '019a0000-0000-7000-8000-00000000000b';

/** Troca o nome do banco na URL, preservando credenciais e host. */
function comBanco(url: string, banco: string): string {
  const destino = new URL(url);
  destino.pathname = `/${banco}`;
  return destino.toString();
}

/**
 * Fase 12 — extração seletiva.
 *
 * O ADR-0001 prometeu, desde a primeira fase, que extrair um módulo seria
 * "mudança de infraestrutura, não reescrita". Este arquivo cobra a promessa.
 *
 * A prova tem três partes:
 *
 * 1. **O contrato não muda.** As MESMAS asserções rodam contra as duas
 *    implementações de `CrmPublicApi` — em processo e por HTTP — e precisam
 *    dar o mesmo resultado. Uma tabela de casos, dois adaptadores.
 * 2. **O banco pode ser outro.** O serviço extraído sobe contra um banco que
 *    contém SÓ as tabelas do CRM. Isso só funciona porque nenhuma delas tem
 *    chave estrangeira para fora do módulo — e há um teste que trava essa
 *    propriedade.
 * 3. **A fronteira é de confiança, não só de rede.** Em processo, `tenantId`
 *    vinha de código do mesmo build. Por HTTP, ele chega de fora — e por isso
 *    vem num token assinado, verificado antes de qualquer consulta.
 */
describe.skipIf(!temBancoDeTeste)('extração do CRM (E2E)', () => {
  let donoDaPlataforma: postgres.Sql;
  let donoDoCrm: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;

  /** O CRM como sempre foi: no mesmo processo, no banco da plataforma. */
  let emProcesso: CrmPublicApi;
  let handleDaPlataforma: DatabaseHandle;

  /** O CRM extraído: outro processo, outro banco. */
  let servico: ServicoDeCrm;
  let remoto: CrmPublicApi;

  let clienteDaEmpresaA: string;
  let clienteDaEmpresaB: string;

  function emissorDeTokens(
    audiencia: string = AUDIENCIA_INTERNA,
    ator: 'service' | 'user' = 'service',
  ): EmissorDeTokenInterno {
    const tokens = new TokenService({
      secret: JWT_SECRET,
      issuer: EMISSOR,
      audience: audiencia,
      accessTokenTtlSeconds: 60,
    });
    return {
      emitirParaEmpresa: (tenantId) =>
        tokens.issue({
          sub: 'platform',
          tid: tenantId,
          kind: ator,
          scope: ['crm.customer.read'],
          jti: randomUUID(),
        }).token,
    };
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    donoDaPlataforma = conexaoDoDono();
    await runMigrations(donoDaPlataforma, migracoesDaPlataforma());

    // --- o banco SÓ do CRM -------------------------------------------------
    // Aplicar apenas as migrações do módulo num banco vazio é, por si, um
    // teste: se alguma tabela `crm_*` dependesse de tabela de outro módulo, o
    // `create table` falharia aqui.
    const manutencao = postgres(comBanco(urlDoDono(), 'postgres'), { max: 1 });
    try {
      await manutencao.unsafe(`drop database if exists "${BANCO_DO_CRM}"`);
      await manutencao.unsafe(`create database "${BANCO_DO_CRM}"`);
    } finally {
      await manutencao.end({ timeout: 5 });
    }

    donoDoCrm = postgres(comBanco(urlDoDono(), BANCO_DO_CRM), { max: 2 });
    const papel = new URL(urlDaAplicacao()).username;
    await donoDoCrm.unsafe(`grant usage on schema public to ${papel}`);
    await runMigrations(
      donoDoCrm,
      migracoesDaPlataforma().filter((m) => m.moduleId === 'crm'),
    );

    // --- os dois adaptadores ----------------------------------------------
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_ISSUER = EMISSOR;
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    process.env.DATABASE_URL = urlDaAplicacao();
    handleDaPlataforma = createDatabase({
      url: urlDaAplicacao(),
      quiet: true,
    });
    emProcesso = new CrmService(
      new DrizzleCustomerRepository(handleDaPlataforma.db),
    );

    process.env.DATABASE_URL = comBanco(urlDaAplicacao(), BANCO_DO_CRM);
    servico = criarServicoDeCrm(loadEnv());
    await servico.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = servico.app.server.address() as AddressInfo;

    remoto = new CrmHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      emissor: emissorDeTokens(),
    });

    // Restaura, para não vazar o banco do CRM para outra suíte.
    process.env.DATABASE_URL = urlDaAplicacao();
  });

  afterAll(async () => {
    await servico?.app.close();
    await servico?.handle.close();
    await handleDaPlataforma?.close();
    await donoDoCrm?.end({ timeout: 5 });
    await donoDaPlataforma?.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    // O MESMO dado nos dois bancos: é o que permite comparar as respostas.
    for (const sql of [donoDaPlataforma, donoDoCrm]) {
      await sql`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    }
    clienteDaEmpresaA = randomUUID();
    clienteDaEmpresaB = randomUUID();
    for (const sql of [donoDaPlataforma, donoDoCrm]) {
      await sql`
        insert into crm_customers (id, tenant_id, name, status) values
          (${clienteDaEmpresaA}, ${EMPRESA_A}, 'Construtora Alfa', 'active'),
          (${clienteDaEmpresaB}, ${EMPRESA_B}, 'Terraplanagem Beta', 'active')
      `;
    }
  });

  /**
   * As duas implementações do contrato, sob os mesmos nomes.
   *
   * `describe.each` aqui não é economia de digitação: é o que garante que
   * nenhuma asserção exista só de um lado. Um caso que passasse em processo e
   * não por HTTP seria exatamente a "reescrita" que o ADR-0001 diz não haver.
   */
  describe.each([
    ['em processo', () => emProcesso],
    ['por HTTP, com banco próprio', () => remoto],
  ])('CrmPublicApi %s', (_nome, obter) => {
    it('encontra o cliente da empresa', async () => {
      const cliente = await runWithContext(createContext('job'), () =>
        obter().findCustomer(EMPRESA_A, clienteDaEmpresaA),
      );

      expect(cliente).toEqual({
        customerId: clienteDaEmpresaA,
        name: 'Construtora Alfa',
        status: 'active',
      });
    });

    it('devolve null para cliente inexistente — não lança', async () => {
      const cliente = await runWithContext(createContext('job'), () =>
        obter().findCustomer(EMPRESA_A, randomUUID()),
      );

      expect(cliente).toBeNull();
    });

    it('não enxerga o cliente da OUTRA empresa', async () => {
      // O id existe, e o cliente existe — só não nesta empresa. Nos dois
      // adaptadores a resposta precisa ser indistinguível de "não existe".
      const cliente = await runWithContext(createContext('job'), () =>
        obter().findCustomer(EMPRESA_A, clienteDaEmpresaB),
      );

      expect(cliente).toBeNull();
    });
  });

  describe('a fronteira nova: confiança, não só rede', () => {
    it('sem credencial, o serviço recusa', async () => {
      const resposta = await servico.app.inject({
        method: 'GET',
        url: `/internal/crm/customers/${clienteDaEmpresaA}`,
      });

      expect(resposta.statusCode).toBe(401);
    });

    it('token da API pública não abre a porta interna', async () => {
      // Audiência diferente. Um access token de usuário, mesmo válido e no
      // prazo, não pode ser reapresentado a um serviço interno.
      const daApiPublica = new CrmHttpClient({
        baseUrl: enderecoDoServico(),
        emissor: emissorDeTokens('ecojotaduo-api'),
      });

      await expect(
        daApiPublica.findCustomer(EMPRESA_A, clienteDaEmpresaA),
      ).rejects.toThrow(ServicoDeCrmIndisponivelError);
    });

    it('token de usuário não abre a porta interna', async () => {
      const comoUsuario = new CrmHttpClient({
        baseUrl: enderecoDoServico(),
        emissor: emissorDeTokens(AUDIENCIA_INTERNA, 'user'),
      });

      await expect(
        comoUsuario.findCustomer(EMPRESA_A, clienteDaEmpresaA),
      ).rejects.toThrow(ServicoDeCrmIndisponivelError);
    });

    it('a empresa vem do token, não de quem chama', async () => {
      // O emissor assina para a empresa A; o pedido é por um cliente da B.
      // Como o serviço lê `tid` do token verificado, o resultado é `null` —
      // e não haveria como pedir "o cliente da empresa B" nem tentando.
      const cliente = await remoto.findCustomer(EMPRESA_A, clienteDaEmpresaB);
      expect(cliente).toBeNull();

      // Assinando para a empresa certa, o mesmo id responde.
      const comEmpresaB = new CrmHttpClient({
        baseUrl: enderecoDoServico(),
        emissor: emissorDeTokens(),
      });
      const daEmpresaB = await comEmpresaB.findCustomer(
        EMPRESA_B,
        clienteDaEmpresaB,
      );
      expect(daEmpresaB?.name).toBe('Terraplanagem Beta');
    });

    it('serviço fora do ar é INDISPONIBILIDADE, não "cliente não existe"', async () => {
      // A distinção decide uma regra de negócio: devolver `null` aqui faria o
      // Comercial recusar uma proposta dizendo que o cliente não existe,
      // quando o que houve foi a rede cair.
      const paraOVazio = new CrmHttpClient({
        baseUrl: 'http://127.0.0.1:1',
        emissor: emissorDeTokens(),
        timeoutMs: 500,
      });

      await expect(
        paraOVazio.findCustomer(EMPRESA_A, clienteDaEmpresaA),
      ).rejects.toThrow(ServicoDeCrmIndisponivelError);
    });
  });

  describe('o que torna a extração possível', () => {
    it('nenhuma tabela do CRM referencia tabela de outro módulo', async () => {
      // É esta propriedade que permitiu o serviço subir com banco próprio.
      // Sem o teste, a primeira chave estrangeira "conveniente" para
      // `tenancy_tenants` fecharia a porta sem ninguém notar.
      const cruzadas = await donoDaPlataforma<
        { tabela: string; referida: string }[]
      >`
        select conrelid::regclass::text  as tabela,
               confrelid::regclass::text as referida
          from pg_constraint
         where contype = 'f'
           and conrelid::regclass::text like 'crm\\_%'
           and confrelid::regclass::text not like 'crm\\_%'
      `;

      expect(cruzadas).toEqual([]);
    });

    it('o banco do serviço extraído tem só as tabelas do CRM', async () => {
      const tabelas = await donoDoCrm<{ nome: string }[]>`
        select tablename as nome from pg_tables
         where schemaname = 'public'
         order by tablename
      `;
      // `platform_migrations` é o ledger do próprio runner: infraestrutura de
      // quem aplica migração, não tabela de módulo.
      const deModulo = tabelas
        .map((linha) => linha.nome)
        .filter((nome) => nome !== 'platform_migrations');

      expect(deModulo.every((nome) => nome.startsWith('crm_'))).toBe(true);
      expect(deModulo).toContain('crm_customers');
      const nomes = deModulo;
      // Nada de tenancy, identity, outbox ou auditoria: o serviço não os tem
      // e não precisa deles para atender o próprio contrato.
      expect(nomes).not.toContain('tenancy_tenants');
      expect(nomes).not.toContain('platform_outbox');
    });
  });

  function enderecoDoServico(): string {
    const { port } = servico.app.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }
});
