import { randomBytes, randomUUID } from 'node:crypto';

import { hashPassword } from '@ecojotaduo/auth';
import { loadEnv } from '@ecojotaduo/config';
import { Email } from '@ecojotaduo/identity';
import { catalogoDeModulos } from '@ecojotaduo/platform-core';
import postgres from 'postgres';

/**
 * Provisiona uma empresa: organização, tenant, a primeira pessoa (dona) e os
 * módulos contratados.
 *
 * É um procedimento **operado**, e não uma rota. Uma rota precisaria responder
 * quem pode chamá-la, e as duas respostas disponíveis hoje são ruins: aberta
 * vira auto-registro (decisão de produto que ninguém tomou), e fechada exigiria
 * inventar um administrador que atravessa empresas — justamente o que
 * `tenant_id` + RLS existem para impedir. Quem roda este comando já tem a
 * conexão do dono do banco na mão; não há privilégio novo a inventar.
 *
 * Conecta como DONO das tabelas (`DATABASE_ADMIN_URL`), como as migrações: a
 * primeira empresa nasce antes de existir qualquer sessão a que a RLS possa
 * dar escopo.
 *
 * A trilha aqui é o registro do operador e o `created_at` das linhas — não a
 * auditoria de negócio, que pressupõe uma requisição autenticada e uma empresa
 * já existente.
 */

/** Papel de sistema criado pela migração do tenancy. */
const PAPEL_OWNER = '00000000-0000-4000-8000-000000000001';

const FORMATO_DE_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Módulos sem os quais ninguém entra: são contratados sempre, mesmo quando a
 * lista pedida não os inclui. Uma empresa sem `identity` nem `tenancy` seria
 * uma empresa em que o dono não consegue fazer login.
 */
const NUCLEO = ['identity', 'tenancy'] as const;

export interface OpcoesDeProvisionamento {
  readonly slug: string;
  readonly nome?: string;
  readonly email: string;
  /**
   * Ausente: uma senha forte é gerada e devolvida uma vez.
   *
   * Existe para o `seed:dev` fixar a senha de desenvolvimento. O comando de
   * linha NÃO oferece este parâmetro — ver `lerArgumentos`.
   */
  readonly senha?: string;
  /** Ausente: todos os módulos desta instalação. */
  readonly modulos?: readonly string[];
}

export interface EmpresaProvisionada {
  readonly tenantId: string;
  readonly slug: string;
  readonly email: string;
  /**
   * A senha da primeira pessoa. Sai UMA vez, como o token pessoal.
   *
   * `null` quando a pessoa já tinha conta na plataforma: senha alheia não se
   * sobrescreve — quem já entra em outra empresa entra nesta com a mesma.
   */
  readonly senha: string | null;
  readonly modulosContratados: readonly string[];
  /** A empresa já existia; o comando apenas completou o que faltava. */
  readonly jaExistia: boolean;
  /** A pessoa já tinha conta e ganhou vínculo com esta empresa. */
  readonly pessoaJaExistia: boolean;
}

/**
 * 192 bits. `base64url` para poder ser colada em qualquer lugar sem escapar
 * nada — inclusive num campo de formulário ou numa variável de ambiente.
 */
function gerarSenha(): string {
  return randomBytes(24).toString('base64url');
}

function resolverModulos(pedidos?: readonly string[]): readonly string[] {
  const conhecidos = catalogoDeModulos().ordered.map((manifest) => manifest.id);
  if (!pedidos || pedidos.length === 0) {
    return conhecidos;
  }

  // Recusa nome inventado: contratar "crm-v2" gravaria uma linha que nenhuma
  // permissão jamais consulta, e a empresa ficaria sem o módulo achando que
  // tem. Mesma regra do ManageEntitlementsUseCase, aplicada antes do banco.
  const desconhecido = pedidos.find((id) => !conhecidos.includes(id));
  if (desconhecido) {
    throw new Error(
      `Módulo desconhecido: "${desconhecido}". Nesta instalação existem: ${conhecidos.join(', ')}.`,
    );
  }

  return [...new Set([...NUCLEO, ...pedidos])];
}

/**
 * Provisiona sobre uma conexão já aberta (a do dono das tabelas).
 *
 * Idempotente em cada peça: rodar de novo depois de acrescentar um módulo à
 * instalação contrata o que faltava, sem tocar no resto.
 */
export async function provisionar(
  sql: postgres.Sql,
  opcoes: OpcoesDeProvisionamento,
): Promise<EmpresaProvisionada> {
  const slug = opcoes.slug.trim().toLowerCase();
  if (!FORMATO_DE_SLUG.test(slug)) {
    throw new Error(
      `slug inválido: "${opcoes.slug}". Use minúsculas, números e hífen (2 a 63 caracteres).`,
    );
  }

  // Normaliza para minúsculas aqui pelo mesmo motivo que o login normaliza:
  // gravar "Dev@Empresa.com" criaria uma conta em que ninguém consegue entrar.
  const email = Email.create(opcoes.email).value;
  const nome = opcoes.nome?.trim() || slug;
  const modulos = resolverModulos(opcoes.modulos);
  const senhaNova = opcoes.senha ?? gerarSenha();
  const hashDaSenha = await hashPassword(senhaNova);

  return sql.begin(async (tx) => {
    const [empresaExistente] = await tx<{ id: string }[]>`
      select id from tenancy_tenants where slug = ${slug}
    `;
    const tenantId = empresaExistente?.id ?? randomUUID();

    if (!empresaExistente) {
      const organizationId = randomUUID();
      await tx`
        insert into tenancy_organizations (id, name) values (${organizationId}, ${nome})
      `;
      await tx`
        insert into tenancy_tenants (id, organization_id, slug, name)
        values (${tenantId}, ${organizationId}, ${slug}, ${nome})
      `;
    }

    const [pessoaExistente] = await tx<{ id: string }[]>`
      select id from identity_users where email = ${email}
    `;
    const userId = pessoaExistente?.id ?? randomUUID();

    if (!pessoaExistente) {
      await tx`
        insert into identity_users (id, email, name, password_hash)
        values (${userId}, ${email}, ${email}, ${hashDaSenha})
      `;
    }

    // O vínculo é o que dá acesso; a pessoa pode ter vários, um por empresa.
    await tx`
      insert into tenancy_memberships (id, tenant_id, user_id)
      values (${randomUUID()}, ${tenantId}, ${userId})
      on conflict (tenant_id, user_id) do update set status = 'active'
    `;

    // O papel entra pelo par (empresa, pessoa), e não por um id devolvido: num
    // vínculo que já existia o id é o antigo, não o que esta execução gerou.
    await tx`
      insert into tenancy_membership_roles (membership_id, role_id, tenant_id)
      select m.id, ${PAPEL_OWNER}, ${tenantId}
        from tenancy_memberships m
       where m.tenant_id = ${tenantId} and m.user_id = ${userId}
      on conflict do nothing
    `;

    for (const moduleId of modulos) {
      await tx`
        insert into tenancy_module_entitlements (id, tenant_id, module_id)
        values (${randomUUID()}, ${tenantId}, ${moduleId})
        on conflict (tenant_id, module_id) do nothing
      `;
    }

    return {
      tenantId,
      slug,
      email,
      senha: pessoaExistente ? null : senhaNova,
      modulosContratados: modulos,
      jaExistia: Boolean(empresaExistente),
      pessoaJaExistia: Boolean(pessoaExistente),
    };
  });
}

/** Abre a conexão do dono e provisiona. */
export async function provisionarEmpresa(
  opcoes: OpcoesDeProvisionamento,
): Promise<EmpresaProvisionada> {
  const env = loadEnv();
  const url = env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      'DATABASE_ADMIN_URL é obrigatória para provisionar (conexão do dono das tabelas).',
    );
  }

  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    return await provisionar(sql, opcoes);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const USO = `
Uso: pnpm --filter @ecojotaduo/api provision -- --slug=<slug> --email=<e-mail> [opções]

  --slug=<slug>        Identificador da empresa no login (minúsculas, números, hífen)
  --email=<e-mail>     A primeira pessoa, que entra como proprietária
  --nome="<nome>"      Nome de exibição da empresa (padrão: o slug)
  --modulos=a,b,c      Módulos contratados (padrão: todos os desta instalação)

A senha é gerada e mostrada UMA vez. Não existe parâmetro para informá-la:
argumento de linha de comando fica no histórico do shell e é visível em
"ps" para qualquer processo da máquina.
`.trim();

function lerArgumentos(argv: readonly string[]): OpcoesDeProvisionamento {
  const valores = new Map<string, string>();
  for (const argumento of argv) {
    const separador = argumento.indexOf('=');
    if (!argumento.startsWith('--') || separador < 0) {
      throw new Error(`Argumento não reconhecido: "${argumento}".\n\n${USO}`);
    }
    valores.set(
      argumento.slice(2, separador),
      argumento.slice(separador + 1).trim(),
    );
  }

  if (valores.has('senha') || valores.has('password')) {
    throw new Error(
      'A senha não é informada por argumento: ela ficaria no histórico do shell e visível em "ps".\n' +
        'Rode sem esse parâmetro — uma senha forte é gerada e mostrada uma vez.',
    );
  }

  const slug = valores.get('slug');
  const email = valores.get('email');
  if (!slug || !email) {
    throw new Error(`--slug e --email são obrigatórios.\n\n${USO}`);
  }

  const modulos = valores.get('modulos');
  return {
    slug,
    email,
    nome: valores.get('nome'),
    modulos: modulos
      ? modulos
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined,
  };
}

function relatar(empresa: EmpresaProvisionada): void {
  console.log(
    empresa.jaExistia
      ? `Empresa "${empresa.slug}" já existia — o que faltava foi completado.`
      : `Empresa "${empresa.slug}" criada.`,
  );
  console.log(`  id .......: ${empresa.tenantId}`);
  console.log(`  módulos ..: ${empresa.modulosContratados.join(', ')}`);
  console.log(`  entrar ...: ${empresa.email} (empresa "${empresa.slug}")`);

  if (empresa.senha === null) {
    console.log(
      `\n  ${empresa.email} já tinha conta na plataforma: a senha dela não muda.`,
    );
    return;
  }

  // A única vez que a senha aparece. Não há caminho de leitura, como no
  // token pessoal: guardá-la para "mostrar depois" seria guardá-la em claro.
  console.log(`\n  SENHA (aparece uma vez): ${empresa.senha}`);
  console.log('  Guarde agora e troque no primeiro acesso.');
}

/**
 * `lerArgumentos` fica DENTRO da função assíncrona de propósito: chamada no
 * argumento de `provisionarEmpresa`, ela roda antes de existir promise alguma,
 * e o `catch` abaixo não a alcança — quem errasse o comando veria um stack
 * trace do Node no lugar da mensagem de uso.
 */
async function executar(): Promise<void> {
  relatar(await provisionarEmpresa(lerArgumentos(process.argv.slice(2))));
}

if (require.main === module) {
  executar().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
