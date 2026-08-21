import type { McpAppDefinition } from '@ecojotaduo/mcp-kit';

/**
 * Painel do pátio: os equipamentos da empresa, com a situação de cada um.
 *
 * É a mesma leitura da tool `assets.asset.search` — a interface não busca nada
 * por conta própria, ela recebe o resultado que a tool já devolveu. Um host
 * sem suporte a MCP Apps continua lendo o JSON estruturado e não perde nada.
 *
 * O módulo entrega markup, estilo e script; quem monta o documento (com a
 * Content-Security-Policy e o runtime do protocolo) é o gateway. Um módulo que
 * montasse o HTML inteiro poderia esquecer a CSP.
 */
export const PATIO_APP_URI = 'ui://assets/patio.html';

export const patioApp: McpAppDefinition = {
  name: 'assets.asset.board',
  uri: PATIO_APP_URI,
  title: 'Pátio de equipamentos',
  description:
    'Quadro visual dos equipamentos com a situação de cada um e o motivo de quem está bloqueado.',
  requiredPermissions: ['assets.asset.read'],
  // Nenhum domínio externo: o app fala só com o host, por postMessage. Sem
  // isto, um app poderia exfiltrar o que vê para fora da plataforma.
  connectDomains: [],
  body: {
    markup: `
      <header class="topo">
        <h1>Pátio de equipamentos</h1>
        <p class="resumo" data-resumo>Carregando…</p>
      </header>
      <ul class="grade" data-grade></ul>
      <p class="vazio" data-vazio hidden>Nenhum equipamento nesta consulta.</p>
    `,
    style: `
      :root { color-scheme: light dark; }
      body {
        margin: 0; padding: 16px;
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .topo h1 { margin: 0 0 4px; font-size: 16px; }
      .resumo { margin: 0 0 16px; opacity: .7; }
      .grade {
        list-style: none; margin: 0; padding: 0;
        display: grid; gap: 8px;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      }
      .cartao {
        border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
        border-radius: 8px; padding: 10px 12px;
      }
      .codigo { font-weight: 600; }
      .nome { opacity: .8; }
      .etiqueta {
        display: inline-block; margin-top: 6px; padding: 1px 8px;
        border-radius: 999px; font-size: 12px;
        border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      }
      .etiqueta[data-situacao="available"] { color: #17803d; }
      .etiqueta[data-situacao="held"]      { color: #b45309; }
      .etiqueta[data-situacao="retired"]   { opacity: .6; }
      .motivo { margin: 4px 0 0; font-size: 12px; opacity: .7; }
      .vazio { opacity: .7; }
    `,
    script: `
      const SITUACAO = {
        available: 'Disponível',
        held: 'Bloqueado',
        retired: 'Baixado',
      };
      const MOTIVO = {
        maintenance: 'Manutenção',
        reserved: 'Reservado',
        damaged: 'Avariado',
        transit: 'Em deslocamento',
      };

      const grade = raiz.querySelector('[data-grade]');
      const resumo = raiz.querySelector('[data-resumo]');
      const vazio = raiz.querySelector('[data-vazio]');

      // Sem innerHTML em dado que veio de fora: nome e código são digitados
      // por quem cadastra o equipamento, e este documento roda no host.
      function texto(elemento, classe, valor) {
        const no = document.createElement(elemento);
        no.className = classe;
        no.textContent = String(valor ?? '');
        return no;
      }

      function desenhar(ativos) {
        grade.replaceChildren();
        const total = ativos.length;
        const livres = ativos.filter((a) => a.availability === 'available').length;
        resumo.textContent = total
          ? total + ' equipamento(s), ' + livres + ' disponível(is) agora'
          : '';
        vazio.hidden = total > 0;

        for (const ativo of ativos) {
          const cartao = document.createElement('li');
          cartao.className = 'cartao';
          cartao.append(texto('div', 'codigo', ativo.code));
          cartao.append(texto('div', 'nome', ativo.name));

          const etiqueta = texto(
            'span',
            'etiqueta',
            SITUACAO[ativo.availability] ?? ativo.availability,
          );
          etiqueta.dataset.situacao = ativo.availability;
          cartao.append(etiqueta);

          if (ativo.currentHold) {
            const motivo = MOTIVO[ativo.currentHold.reason] ?? ativo.currentHold.reason;
            const ate = new Date(ativo.currentHold.effectiveEndsAt);
            cartao.append(
              texto('p', 'motivo', motivo + ' até ' + ate.toLocaleDateString('pt-BR')),
            );
          }
          grade.append(cartao);
        }
      }

      // Registrado ANTES do connect: o host entrega o resultado logo depois do
      // handshake, e um handler tardio perderia a primeira mensagem.
      app.ontoolresult = (resultado) => {
        const dados = resultado?.structuredContent ?? {};
        desenhar(Array.isArray(dados.items) ? dados.items : []);
      };
    `,
  },
};
