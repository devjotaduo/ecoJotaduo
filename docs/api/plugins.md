# Plugins: instalar, configurar e usar

Decisões em [ADR-0005](../adr/0005-plugin-isolation.md) e
[ADR-0010](../adr/0010-registry-de-plugins-e-segredos.md); desenho em
[plugin-model](../architecture/plugin-model.md).

## O ciclo, em quatro chamadas

Todas exigem `platform.plugin.manage` (a listagem, `platform.plugin.read`).

```bash
curl -X POST "$API/api/v1/plugins/notifications-example/install" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"grantedPermissions":["crm.customer.read"]}'
```

```bash
curl -X POST "$API/api/v1/plugins/notifications-example/configure" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"config":{"webhookUrl":"https://sua-empresa.com/hooks/ecojotaduo"},"secrets":{"signingSecret":"..."}}'
```

```bash
curl -X POST "$API/api/v1/plugins/notifications-example/enable" -H "authorization: Bearer $TOKEN"
```

```bash
curl "$API/api/v1/plugins" -H "authorization: Bearer $TOKEN"
```

Estados: `installed → configured → enabled ⇄ disabled`. Não existe habilitar antes de
configurar, nem habilitar sem os segredos exigidos — a recusa vem com a lista do que
falta, em vez de o plugin quebrar depois, dentro de um fluxo de negócio.

Reconfigurar um plugin **habilitado** não o derruba: trocar a URL de destino é rotina.

`DELETE /api/v1/plugins/{pluginId}` desinstala e **apaga os segredos** da empresa.

## O que a instalação decide

| Campo                | Efeito                                                          |
| -------------------- | --------------------------------------------------------------- |
| `grantedPermissions` | O que o plugin pode fazer na plataforma **em nome da empresa**  |
| `config`             | Ajustes não sensíveis (a URL de destino, por exemplo)           |
| `secrets`            | Credenciais; cifradas antes de tocar o banco e nunca devolvidas |

Três garantias que valem a leitura:

- **Só se concede o que o manifesto pede.** Pedir mais é 400. A revisão do manifesto é
  que vale como controle.
- **O plugin não herda os seus poderes.** Ele age com a interseção entre o que a
  instalação concedeu e os módulos que a empresa mantém contratados. Cancelar o CRM
  corta o acesso do plugin ao CRM na hora.
- **Nenhuma resposta devolve segredo.** A listagem mostra `configuredSecrets` — só as
  chaves. Para trocar um valor, envie de novo em `configure`.

## Habilitar é o que liga a capacidade

Um plugin habilitado contribui o entitlement `plugin.<id>`; as capacidades dele usam
permissões `plugin.<id>.<recurso>.<acao>`. Na prática:

- a rota do plugin passa a responder (antes disso, 403);
- a tool MCP aparece no catálogo do agente (antes disso, não existe);
- o papel do usuário ainda precisa conceder a permissão — `*` do proprietário cobre.

Desabilitar remove as duas de uma vez, na requisição seguinte. Habilitar numa empresa
não muda nada em nenhuma outra.

## O plugin de exemplo: `notifications-example`

Entrega mensagens no webhook da empresa, assinadas.

```bash
curl -X POST "$API/api/v1/plugins/notifications-example/messages" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"message":"Proposta aprovada.","customerId":"..."}'
```

Também disponível como tool MCP `plugin.notifications-example.message.send`. O agente
manda a mensagem; **quem decide o destino e assina é o servidor** — a URL e o segredo
nunca chegam ao modelo.

### Verificando a assinatura no seu servidor

A entrega chega assim:

| Cabeçalho                | Conteúdo                      |
| ------------------------ | ----------------------------- |
| `x-ecojotaduo-timestamp` | Segundos desde a época (Unix) |
| `x-ecojotaduo-signature` | `v1=<hmac-sha256 hex>`        |

O HMAC é calculado sobre `"{timestamp}.{corpo}"` com o `signingSecret` que você
configurou:

```js
const esperado = `v1=${createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex')}`;
const valido = timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
```

Duas coisas do seu lado, e ambas importam:

1. **Compare em tempo constante** (`timingSafeEqual`), nunca com `===`.
2. **Recuse timestamp fora de uma janela** (5 minutos é o usual). O timestamp está
   dentro da assinatura justamente para isso: sem a janela, quem capturar uma entrega
   pode repeti-la para sempre.

### Restrições do destino

A URL precisa ser `https` e resolver para endereço público. Endereços de rede interna
— loopback, faixas privadas, link-local (inclusive o metadata das nuvens) — são
recusados: sem isso, a plataforma viraria procuradora para alcançar a rede de dentro.

O diagnóstico aparece em `GET /api/v1/plugins`, no campo `installation.health`, para o
destino quebrado não ficar esperando a primeira reclamação de mensagem não entregue.

## Escrever um plugin first-party

1. Pacote em `plugins/first-party/<id>/`, com `PluginManifest` (validado no boot).
2. `configSchema` em Zod — a mesma verdade que valida a configuração da empresa.
3. Casos de uso recebendo `PluginRuntime` (config, segredos, grant) e chamando
   `exigirPermissaoDoPlugin` antes de tocar a plataforma.
4. Borda REST e/ou tool MCP com permissão `plugin.<id>.<recurso>.<acao>`.
5. Registrar no composition root (`packages/platform-core`).

Plugin não carrega código de terceiro em tempo de execução: o catálogo é montado no
boot, a partir do que está no processo (ADR-0005).
