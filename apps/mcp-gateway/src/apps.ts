import { readFileSync } from 'node:fs';

import type { McpAppDefinition } from '@ecojotaduo/mcp-kit';
import {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from '@modelcontextprotocol/ext-apps/server';

export { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY };

/**
 * Montagem dos MCP Apps.
 *
 * O módulo entrega markup, estilo e script; **o documento é montado aqui**,
 * porque só o gateway conhece o protocolo. Duas coisas ele acrescenta e o
 * módulo não pode esquecer:
 *
 * 1. A **Content-Security-Policy**. O app roda num iframe do host; a CSP é a
 *    diferença entre uma tela e um canal de saída. `default-src 'none'` fecha
 *    tudo, e só `connectDomains` do app pode abrir `connect-src`.
 * 2. O **runtime do protocolo**, embutido no próprio documento. Buscar de CDN
 *    seria uma requisição externa que a própria CSP (corretamente) barra.
 */

/**
 * O bundle do runtime já vem com as dependências resolvidas — é o artefato que
 * o pacote publica para rodar no navegador sem empacotador. Lido uma vez por
 * processo: são ~330 KB, e reler a cada `resources/read` seria I/O à toa.
 */
let runtimeEmCache: string | undefined;

function runtimeDoProtocolo(): string {
  runtimeEmCache ??= readFileSync(
    // O pacote é ESM; `require.resolve` funciona porque este app compila para
    // CommonJS, e resolve só o CAMINHO — o arquivo é lido como texto, nunca
    // importado neste processo.
    require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'),
    'utf8',
  );
  return runtimeEmCache;
}

/**
 * Content-Security-Policy do documento.
 *
 * `default-src 'none'` nega tudo por padrão; abrimos só o necessário para o
 * app existir: estilo e script inline (que somos nós que montamos) e imagens
 * embutidas. `connect-src` fica fechado a menos que o app declare domínios —
 * sem isso, um app poderia mandar para fora o que enxerga da empresa.
 */
export function cspDoApp(app: McpAppDefinition): string {
  const conexoes = app.connectDomains ?? [];
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    `connect-src ${conexoes.length > 0 ? conexoes.join(' ') : "'none'"}`,
    // Nem o próprio app pode se aninhar noutro frame, e nada além do host o
    // enquadra. `form-action 'none'` fecha o último canal de navegação.
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Escapa para interpolação segura dentro de um bloco `<script>`. */
function seguroEmScript(valor: string): string {
  return valor.replace(/<\/(script)/gi, '<\\/$1');
}

/** Idem para o corpo HTML — o markup vem do módulo, não do usuário final. */
function seguroEmHtml(valor: string): string {
  return valor.replace(/<\/(script)/gi, '&lt;/$1');
}

export const ID_DA_RAIZ = 'mcp-app-raiz';

/**
 * Documento completo do app, pronto para o host renderizar.
 *
 * O script do módulo roda **antes** do `connect()`: o host entrega o resultado
 * da tool logo depois do handshake, e um handler registrado tarde perderia a
 * primeira mensagem — que costuma ser a única que importa.
 */
export function montarDocumentoDoApp(app: McpAppDefinition): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${cspDoApp(app)}">
<title>${seguroEmHtml(app.title)}</title>
<style>${seguroEmHtml(app.body.style)}</style>
</head>
<body>
<div id="${ID_DA_RAIZ}">${seguroEmHtml(app.body.markup)}</div>
<script type="module">
${seguroEmScript(runtimeDoProtocolo())}

const app = new App();
const raiz = document.getElementById(${JSON.stringify(ID_DA_RAIZ)});

// Handlers do módulo primeiro, conexão depois.
(function montar(app, raiz) {
${seguroEmScript(app.body.script)}
})(app, raiz);

await app.connect();
</script>
</body>
</html>`;
}
