#!/usr/bin/env node
// PostToolUse (Write|Edit): guarda das migrações.
//
// Duas invariantes que nenhuma outra ferramenta do repositório verifica —
// o ESLint enxerga TypeScript, não SQL:
//
// 1. Tabela de negócio sem RLS + grant desliga silenciosamente o isolamento
//    entre empresas. A aplicação continua funcionando e os testes existentes
//    continuam verdes; o problema só aparece num incidente. Foi assim que
//    `tenancy_organizations` ficou sem policy.
// 2. Migração já aplicada é imutável (o runner guarda checksum). Editar um
//    arquivo já versionado explode com MigrationDriftError bem mais tarde,
//    no `pnpm migrate`, longe de quem causou.
//
// Node, e não PowerShell, porque o time pode estar em Linux/macOS e o
// projeto já exige Node.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PAPEL_DA_APLICACAO = 'movimentar_app';

// Tabelas globais por natureza (login acontece antes de existir tenant).
// Ver docs/architecture/tenancy.md — "Tabelas de plataforma".
const TABELAS_DE_PLATAFORMA = [
  /^identity_/,
  /^tenancy_organizations$/,
  /^platform_migrations$/,
];

function entradaDoHook() {
  try {
    const bruto = readFileSync(0, 'utf8');
    return bruto.trim() ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function estaVersionado(caminho) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', caminho], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const entrada = entradaDoHook();
const caminho = entrada?.tool_input?.file_path;
if (!caminho || !/[\\/]migrations[\\/][^\\/]+\.sql$/i.test(caminho)) {
  process.exit(0);
}

let sql;
try {
  sql = readFileSync(caminho, 'utf8');
} catch {
  process.exit(0);
}

const problemas = [];

if (estaVersionado(caminho)) {
  problemas.push(
    'esta migração já está versionada (logo, provavelmente já aplicada). ' +
      'Migrações são imutáveis: crie um arquivo novo em vez de editar este, ' +
      'senão o próximo `pnpm migrate` falha com MigrationDriftError.',
  );
}

const tabelas = [
  ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi),
].map((achado) => achado[1]);

for (const tabela of tabelas) {
  if (TABELAS_DE_PLATAFORMA.some((padrao) => padrao.test(tabela))) continue;

  const grant = sql.match(
    new RegExp(
      `grant\\s+([^;]*?)\\s+on\\s+${tabela}\\s+to\\s+([a-z0-9_]+)`,
      'i',
    ),
  );
  if (!grant) {
    problemas.push(
      `${tabela}: falta \`grant ... on ${tabela} to ${PAPEL_DA_APLICACAO}\` — ` +
        'o papel da aplicação não herda privilégio nenhum.',
    );
  }

  const temRls = new RegExp(
    `alter\\s+table\\s+${tabela}\\s+enable\\s+row\\s+level\\s+security`,
    'i',
  ).test(sql);
  if (!temRls) {
    problemas.push(
      `${tabela}: falta \`alter table ${tabela} enable row level security\`. ` +
        'Se a tabela é global de propósito, adicione-a a TABELAS_DE_PLATAFORMA ' +
        'neste hook e explique o motivo na migração.',
    );
    continue;
  }

  const policy = sql.match(
    new RegExp(
      `create\\s+policy[\\s\\S]{0,200}?on\\s+${tabela}([\\s\\S]*?);`,
      'i',
    ),
  );
  if (!policy) {
    problemas.push(
      `${tabela}: RLS ligada mas sem \`create policy\` — nega tudo.`,
    );
    continue;
  }

  if (!/using\s*\(/i.test(policy[1])) {
    problemas.push(
      `${tabela}: a policy precisa de \`using (...)\` para filtrar leitura.`,
    );
  }
  // `with check` só faz sentido onde a aplicação escreve.
  const escreve = grant && /\b(insert|update)\b/i.test(grant[1]);
  if (escreve && !/with\s+check\s*\(/i.test(policy[1])) {
    problemas.push(
      `${tabela}: a aplicação escreve nesta tabela, então a policy precisa de ` +
        '`with check (...)` — sem ele é possível gravar linha em nome de outro tenant.',
    );
  }
}

if (problemas.length > 0) {
  console.error(
    `Migração ${caminho} não passou no guarda de isolamento:\n` +
      problemas.map((item) => `  - ${item}`).join('\n') +
      '\n\nReferência: docs/architecture/tenancy.md e docs/adr/0007-auth-and-rls-enforcement.md',
  );
  process.exit(2);
}

process.exit(0);
