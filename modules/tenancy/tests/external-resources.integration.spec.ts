import {
  createDatabase,
  runMigrations,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { toTenantId } from '@ecojotaduo/tenant-context';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleExternalResourceRepository } from '../src/adapters/persistence/external-resources.repository';
import {
  ConfirmarRecursoExternoUseCase,
  ListarRecursosExternosUseCase,
  RecursoExternoNaoEncontradoError,
  RegistrarRecursoExternoUseCase,
  RevogarRecursoExternoUseCase,
} from '../src/application/external-resources.use-cases';

exigirBancoEmCI();

describe.skipIf(!temBancoDeTeste)('Recursos externos (ADR-0017)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;
  let repo: DrizzleExternalResourceRepository;

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });
    repo = new DrizzleExternalResourceRepository(handle.db);
  });

  afterAll(async () => {
    await handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      nome: 'Empresa A',
      email: 'ana@empresa-a.com.br',
      modulos: ['tenancy'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      nome: 'Empresa B',
      email: 'bruno@empresa-b.com.br',
      modulos: ['tenancy'],
    });
  });

  const alvoStudio = (t: TenantSemeado) =>
    ({
      tenantId: toTenantId(t.tenantId),
      system: 'studio',
      kind: 'group',
    }) as const;

  it('registra pendente e confirma com o identificador do sistema de destino', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    const confirmar = new ConfirmarRecursoExternoUseCase(repo);

    const pendente = await registrar.execute(alvoStudio(empresaA));
    expect(pendente.state).toBe('pending');
    expect(pendente.externalId).toBeNull();

    const ativo = await confirmar.execute({
      ...alvoStudio(empresaA),
      externalId: 'grp-abc',
    });
    expect(ativo.state).toBe('active');
    expect(ativo.externalId).toBe('grp-abc');
  });

  // É o que permite o worker retomar do ponto seguro depois de um reinício
  // sem precisar saber se já tinha passado por aqui.
  it('registrar de novo devolve o mesmo recurso, não cria um segundo', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);

    const primeiro = await registrar.execute(alvoStudio(empresaA));
    const segundo = await registrar.execute(alvoStudio(empresaA));

    expect(segundo.id).toBe(primeiro.id);
    const todos = await new ListarRecursosExternosUseCase(repo).execute(
      toTenantId(empresaA.tenantId),
    );
    expect(todos).toHaveLength(1);
  });

  it('registrar de novo NÃO desfaz uma confirmação já feita', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    const confirmar = new ConfirmarRecursoExternoUseCase(repo);

    await registrar.execute(alvoStudio(empresaA));
    await confirmar.execute({ ...alvoStudio(empresaA), externalId: 'grp-abc' });

    const denovo = await registrar.execute(alvoStudio(empresaA));
    expect(denovo.state).toBe('active');
    expect(denovo.externalId).toBe('grp-abc');
  });

  // O sintoma de esquecer o escopo não é erro, é ZERO LINHAS — e uma empresa
  // que parece não provisionada seria provisionada de novo.
  it('uma empresa não enxerga o recurso da outra', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    const confirmar = new ConfirmarRecursoExternoUseCase(repo);
    const listar = new ListarRecursosExternosUseCase(repo);

    await registrar.execute(alvoStudio(empresaA));
    await confirmar.execute({ ...alvoStudio(empresaA), externalId: 'grp-de-A' });

    const daB = await listar.execute(toTenantId(empresaB.tenantId));
    expect(daB).toHaveLength(0);

    const daA = await listar.execute(toTenantId(empresaA.tenantId));
    expect(daA.map((r) => r.externalId)).toEqual(['grp-de-A']);
  });

  it('sem escopo nenhum, a RLS não devolve linha alguma', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    await registrar.execute(alvoStudio(empresaA));

    const vistas = await handle.db.execute(
      sql`select id from tenancy_external_resources`,
    );
    expect([...vistas]).toHaveLength(0);
  });

  it('a mesma chave natural em empresas diferentes convive', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    await registrar.execute(alvoStudio(empresaA));
    await registrar.execute(alvoStudio(empresaB));

    const listar = new ListarRecursosExternosUseCase(repo);
    expect(await listar.execute(toTenantId(empresaA.tenantId))).toHaveLength(1);
    expect(await listar.execute(toTenantId(empresaB.tenantId))).toHaveLength(1);
  });

  it('revogar guarda o estado e some com o identificador na leitura', async () => {
    const registrar = new RegistrarRecursoExternoUseCase(repo);
    const confirmar = new ConfirmarRecursoExternoUseCase(repo);
    const revogar = new RevogarRecursoExternoUseCase(repo);

    await registrar.execute(alvoStudio(empresaA));
    await confirmar.execute({ ...alvoStudio(empresaA), externalId: 'grp-abc' });
    const revogado = await revogar.execute(alvoStudio(empresaA));

    expect(revogado.state).toBe('revoked');
    expect(revogado.externalId).toBeNull();

    // A linha continua lá: revogar é estado, não ausência.
    const [linha] = [
      ...(await dono`select external_id, state from tenancy_external_resources`),
    ];
    expect(linha).toMatchObject({ external_id: 'grp-abc', state: 'revoked' });
  });

  it('confirmar recurso nunca registrado é not-found, não silêncio', async () => {
    const confirmar = new ConfirmarRecursoExternoUseCase(repo);
    await expect(
      confirmar.execute({ ...alvoStudio(empresaA), externalId: 'grp-abc' }),
    ).rejects.toThrow(RecursoExternoNaoEncontradoError);
  });

  it('o banco recusa ativo sem identificador — a rede de baixo do domínio', async () => {
    await expect(
      dono`insert into tenancy_external_resources (id, tenant_id, system, kind, state)
           values (gen_random_uuid(), ${empresaA.tenantId}, 'studio', 'group', 'active')`,
    ).rejects.toThrow(/tenancy_external_resources_ativo_tem_id/);
  });
});
