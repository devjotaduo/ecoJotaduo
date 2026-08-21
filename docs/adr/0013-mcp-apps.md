# ADR-0013 — MCP Apps: a interface é sugestão, e o documento é montado pelo gateway

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

O MCP permite que uma tool devolva, além do resultado estruturado, uma
**interface interativa** que o host renderiza num iframe isolado (MCP Apps,
extensão `io.modelcontextprotocol/ui`). Isso é atraente e é uma armadilha: o
risco que o próprio roadmap registrou para esta fase é **depender de host
específico**.

Há ainda uma questão de segurança que não existe nas outras capacidades. Tool,
resource e prompt devolvem dados. Um app devolve **código que roda no navegador
de quem usa o host** — e o catálogo é multi-empresa.

## Decisão

### 1. A interface é sugestão; o resultado estruturado é o contrato

A tool devolve o que sempre devolveu em `content`, e passa a devolver o **mesmo
dado** em `structuredContent`. `_meta["ui/resourceUri"]` aponta para a interface.

Um host sem suporte a Apps lê `content` e não perde nada. Nenhuma regra de
negócio, nenhuma autorização e nenhum efeito depende de a interface ter sido
renderizada — ela é uma forma de olhar, não um passo do fluxo. O primeiro bloco
do E2E existe só para provar isso.

A interface também **não busca nada por conta própria**: desenha o resultado
que a tool já devolveu. Duas leituras seriam duas verdades, e a segunda poderia
divergir da primeira sem ninguém notar.

### 2. O módulo declara o corpo; o gateway monta o documento

O módulo entrega `markup`, `style` e `script`. Quem monta o HTML é o gateway,
porque duas coisas não podem depender de o autor do módulo lembrar delas:

- **A Content-Security-Policy.** `default-src 'none'` nega tudo; abrimos só o
  que o app precisa para existir. `connect-src` fica `'none'` a menos que o app
  declare `connectDomains` — sem isso, um app poderia mandar para fora o que
  enxerga da empresa. A CSP é a diferença entre uma tela e um canal de saída.
- **O runtime do protocolo**, embutido no próprio documento. Buscar de CDN seria
  uma requisição externa que a própria CSP (corretamente) barra.

Isso mantém a regra do ADR-0004: **nenhum símbolo do SDK MCP entra em
`modules/`**. O módulo declara `McpAppDefinition` do `mcp-kit`, que não conhece
transporte; o gateway conhece.

### 3. App é capacidade, e segue a mesma autorização

`appsDe(grant)` filtra a listagem e `acharApp(grant, uri)` **reautoriza** na
leitura — igual a `acharTool`. Descoberta e leitura passam pela mesma decisão:
um app que some da listagem também não é legível com a URI em mãos.

Verificado por falsificação: removida a reautorização, uma empresa sem o módulo
consegue ler a interface adivinhando a URI.

Duas travas somam a isso:

- App sem permissão declarada **falha na montagem** do catálogo, como qualquer
  capacidade — ele seria visível para todas as empresas.
- Tool que aponta para app inexistente **falha na montagem**. Descobrir isso na
  primeira chamada significaria uma tela em branco no host de quem usa.

### 4. O `_meta` só aparece quando o app está no recorte da empresa

Se a tool está visível mas o app não, a tool sai sem `_meta`. Sugerir uma tela
que o host não conseguiria ler daria erro na cara de quem usa, sem ganho.

## Consequências

- `@modelcontextprotocol/ext-apps` entra como dependência **do gateway apenas** —
  para as constantes do protocolo e para o bundle do runtime, que o pacote já
  publica pronto para o navegador. Nenhum empacotador novo no monorepo.
- O documento tem ~340 KB por causa do runtime embutido. É lido uma vez por
  `resources/read`, e o arquivo fica em cache no processo.
- O app do pátio de equipamentos é o exemplo, e monta o DOM sem `innerHTML`:
  código e nome de equipamento são digitados por quem cadastra, e o documento
  roda no host de quem consulta.

## O que ficou fora, e por quê

| Item                                   | Motivo                                                                                    | Quando                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| App que chama tools (`callServerTool`) | O painel se basta com o resultado que recebe; chamar de volta é outra superfície de risco | Quando um app precisar   |
| `updateModelContext` a partir do app   | Deixa o app influenciar o que o modelo lê — merece desenho próprio                        | Junto com o item acima   |
| App de plugin (third-party)            | O contrato já serve; falta o primeiro plugin que peça                                     | Quando um pedir          |
| Empacotamento com framework (React)    | O painel é uma lista; um framework aqui é peso morto no documento                         | Se um app ficar complexo |
| Tema/estilo herdado do host            | O protocolo expõe `hostStyles`; nada hoje justifica a complexidade                        | Quando houver 2º app     |
| Teste em navegador de verdade          | O E2E cobre montagem, CSP e autorização; falta execução real do iframe                    | Fase 10, com E2E de tela |
