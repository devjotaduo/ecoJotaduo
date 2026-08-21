# ADR-0010 — Registry de plugins: plugin habilitado é entitlement, segredo é cifra

- **Status**: aceito
- **Data**: 2026-08-20
- **Refina**: [ADR-0005](0005-plugin-isolation.md) (que decidiu as três categorias de
  isolamento, mas não como a ativação por empresa viraria autorização)

## Problema

O ADR-0005 fixou que plugins first-party rodam no processo e são "ativáveis por
tenant". Implementar isso trouxe três perguntas que ele não responde:

1. **Ativar por empresa vira autorização como?** Sem resposta, cada borda (REST, MCP)
   acabaria com um `if (pluginHabilitado)` próprio — e um deles ficaria para trás.
2. **Onde ficam as credenciais de terceiros?** O briefing exige que elas nunca
   transitem pelo modelo, nunca voltem ao cliente e nunca apareçam em log.
3. **O que impede um plugin de acessar mais do que foi concedido?**

## Decisão

### 1. Plugin habilitado É um entitlement

Uma instalação com status `enabled` contribui o entitlement `plugin.<id>` para o
`AccessGrant` da empresa, na mesma resolução por requisição que já existe. A
capacidade do plugin usa permissões `plugin.<id>.<recurso>.<acao>`, e `moduleOf`
passa a devolver `plugin.<id>` (não `plugin`) para essas chaves.

A consequência é a que interessa: **nenhuma borda precisou de código novo**. A rota
REST usa `@RequirePermissions` como qualquer outra; o catálogo MCP filtra pelo mesmo
`AccessGrant` de sempre. Desabilitar o plugin remove o entitlement e a capacidade some
das duas bordas na requisição seguinte.

O recorte em `moduleOf` não é detalhe de estilo: se o "módulo" fosse só `plugin`,
habilitar **um** plugin numa empresa liberaria **todos** os outros — o entitlement
viraria chave-mestra. Há teste dedicado a isso.

### 2. Segredos: cifra autenticada, com o dono no cabeçalho

`plugin_secrets` guarda AES-256-GCM (`packages/auth/src/secret-box.ts`), chave de 32
bytes em `SECRETS_KEY`, obrigatória no boot.

Duas escolhas dentro disso:

- **GCM, não CBC**: adulterar a linha no banco produz erro, não um segredo diferente
  e silencioso.
- **`aad` = empresa + plugin + chave**: mover a linha de uma empresa para outra dentro
  do banco não decifra. A RLS já barra; esta é a segunda tranca, para o caso de a
  primeira falhar.

`SECRETS_KEY` é obrigatória e não tem valor padrão. Uma plataforma que aceita subir sem
chave acaba guardando token de terceiro em claro sem ninguém notar.

**Nenhum caminho de leitura devolve valor de segredo** — nem a listagem do catálogo,
nem a resposta de configuração, nem a auditoria (que registra só as chaves). O valor
sai do banco uma única vez, para a memória do plugin, durante a chamada dele.

### 3. O plugin age com identidade própria, mais restrita que a de quem chamou

O acesso efetivo do plugin é a **interseção** entre o que foi concedido na instalação e
os módulos que a empresa mantém contratados:

```
grant do plugin = permissões concedidas na instalação ∩ entitlements atuais da empresa
```

Não são as permissões do usuário que chamou. Um administrador com `*` que dispara uma
capacidade de plugin não empresta os próprios poderes a ele.

Cancelar o módulo CRM corta o acesso do plugin ao CRM na hora, sem reinstalar nem
revisar concessão — e há teste para os dois lados (permissão ausente e módulo
cancelado).

Só se concede o que o manifesto pede: conceder além do declarado é recusado, senão a
revisão do manifesto deixaria de valer como controle.

### 4. Webhook de saída passa por guarda anti-SSRF

O plugin de exemplo entrega em uma URL que a empresa configura. Sem controle, isso é a
ferramenta `call_any_url` proibida com outro nome: quem administra uma empresa usaria o
servidor da plataforma como procurador para alcançar a rede interna.

A política padrão exige HTTPS, **resolve o nome** e recusa se qualquer endereço cair em
loopback, faixa privada, link-local (inclui o metadata das nuvens), CGNAT ou IPv4
mapeado em IPv6. É injetável para que o teste E2E fale com um servidor local — e um
caso do próprio E2E monta o núcleo com a política de produção para provar que ela está
ligada no caminho real.

Risco residual declarado: entre a resolução e a conexão o DNS pode mudar (rebinding).
Fechar isso exige conectar no IP já validado mantendo o `Host` — entra quando houver
uma camada de saída controlada.

### 5. Um plugin de exemplo, não um SDK genérico

O risco nomeado no roadmap para esta fase é "generalização precoce do SDK". Por isso o
`plugin-sdk` tem só o que o `notifications-example` exercita: manifesto validado,
runtime da chamada, verificação de permissão e health check. Não há registro genérico
de capacidades: o plugin contribui rota e tool do mesmo jeito que um módulo contribui,
pelo composition root.

## Consequências

- Mais uma consulta por requisição autenticada (plugins habilitados). A dívida de "a
  resolução de acesso abre N transações" cresce e está no roadmap. O caminho contrário
  — carregar o resultado no token — faria desabilitar um plugin demorar a valer, que é
  exatamente o que esta cadeia existe para evitar.
- `SECRETS_KEY` passa a ser obrigatória: ambientes existentes precisam gerá-la.
- Um plugin externo (out-of-process) ainda não é instalável: falta o Plugin Gateway. O
  manifesto já distingue `first-party` de `remote` para que isso não vire migração.

## O que ficou fora, e por quê

| Item                                   | Motivo                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Plugin Gateway (plugins externos)      | Nenhum plugin externo existe; o contrato já prevê o tipo `remote`             |
| `manifest.schema.json` versionado      | O schema Zod já valida; o JSON só serve a autor externo, que não há           |
| Feature flags genéricas                | Habilitar/desabilitar plugin cobre o caso de hoje sem inventar sistema        |
| Migrações próprias de plugin           | O plugin de exemplo não tem tabelas                                           |
| Assinatura de eventos (`subscribesTo`) | Não há barramento até a Fase 8 — mas o manifesto já recusa evento inexistente |
| UI de plugin                           | Depende de `apps/web`, que ainda não existe                                   |
