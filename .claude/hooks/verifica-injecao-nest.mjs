#!/usr/bin/env node
// PostToolUse (Write|Edit): exige @Inject explícito em apps/api.
//
// Injeção por tipo funciona em produção (tsc emite emitDecoratorMetadata) e
// QUEBRA nos testes E2E, porque o Vitest transpila com esbuild, que não emite
// `design:paramtypes`. O sintoma aparece longe da edição, como falha de DI
// difícil de ler. Este hook avisa no momento em que o construtor é escrito.
//
// Ver CLAUDE.md — "Injeção de dependência".

import { readFileSync } from 'node:fs';

function entradaDoHook() {
  try {
    const bruto = readFileSync(0, 'utf8');
    return bruto.trim() ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

/** Extrai o conteúdo de cada `constructor(...)`, respeitando parênteses aninhados. */
function parametrosDeConstrutores(codigo) {
  const blocos = [];
  const marcador = /\bconstructor\s*\(/g;
  let achado;

  while ((achado = marcador.exec(codigo)) !== null) {
    let profundidade = 1;
    let i = marcador.lastIndex;
    while (i < codigo.length && profundidade > 0) {
      if (codigo[i] === '(') profundidade += 1;
      else if (codigo[i] === ')') profundidade -= 1;
      i += 1;
    }
    blocos.push(codigo.slice(marcador.lastIndex, i - 1));
  }
  return blocos;
}

/** Separa parâmetros por vírgulas de primeiro nível. */
function separarParametros(bloco) {
  const partes = [];
  let profundidade = 0;
  let atual = '';

  for (const caractere of bloco) {
    if ('([{<'.includes(caractere)) profundidade += 1;
    if (')]}>'.includes(caractere)) profundidade -= 1;
    if (caractere === ',' && profundidade === 0) {
      partes.push(atual);
      atual = '';
      continue;
    }
    atual += caractere;
  }
  partes.push(atual);

  return partes.map((parte) => parte.trim()).filter(Boolean);
}

const entrada = entradaDoHook();
const caminho = entrada?.tool_input?.file_path;
const ehAlvo =
  caminho &&
  /apps[\\/]api[\\/]src[\\/].+\.ts$/.test(caminho) &&
  !/\.spec\.ts$/.test(caminho);

if (!ehAlvo) process.exit(0);

let codigo;
try {
  codigo = readFileSync(caminho, 'utf8');
} catch {
  process.exit(0);
}

// Só interessa em classes que o Nest instancia.
if (!/@(Controller|Injectable|Catch)\s*\(/.test(codigo)) process.exit(0);

const semInject = [];
for (const bloco of parametrosDeConstrutores(codigo)) {
  for (const parametro of separarParametros(bloco)) {
    if (!parametro.includes('@Inject(')) {
      semInject.push(parametro.replace(/\s+/g, ' ').slice(0, 80));
    }
  }
}

if (semInject.length > 0) {
  console.error(
    `Em ${caminho}, há parâmetro de construtor sem @Inject explícito:\n` +
      semInject.map((item) => `  - ${item}`).join('\n') +
      '\n\nO Vitest (esbuild) não emite metadados de decorator: injeção por tipo ' +
      'passa em produção e quebra os testes E2E. Use @Inject(TOKEN) — inclusive ' +
      'para classes do próprio Nest, como @Inject(Reflector). Tokens em ' +
      'apps/api/src/bootstrap/tokens.ts.',
  );
  process.exit(2);
}

process.exit(0);
