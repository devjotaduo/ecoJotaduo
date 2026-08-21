# Runbooks

O que fazer quando algo dá errado, escrito para ser lido às três da manhã por
quem não escreveu o código. Cada procedimento diz **como confirmar** o
diagnóstico antes de agir — metade dos incidentes prolongados vem de tratar o
sintoma errado com confiança.

Convenções: `$ADMIN` é a `DATABASE_ADMIN_URL` (dono das tabelas), `$APP` é a
`DATABASE_URL` (papel restrito `ecojotaduo_app`). Ver
[tenancy.md](../architecture/tenancy.md) para por que são dois.

---

## 1. Ninguém consegue entrar (login devolve 401 para todo mundo)

**Confirme primeiro.** Um 401 uniforme é _deliberado_ (senha errada, usuário
inexistente e empresa inexistente respondem igual — ver
[authentication.md](../api/authentication.md)). O motivo real está no log, com
o `correlationId` da requisição:

```bash
grep '"tipo":"requisicao"' log | grep '"route":"/api/v1/auth/login"' | tail -20
```

| O que o log mostra                   | Causa provável                        | Ação                                                                         |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| `status: 429`                        | Rate limit do login                   | Esperado sob ataque. Se for tráfego legítimo, subir `RATE_LIMIT_LOGIN_MAX`   |
| `status: 401` e zero linhas no banco | Consulta fora de escopo (RLS)         | Ver §2 — é o sintoma clássico                                                |
| `status: 500`                        | `JWT_SECRET` ou `SECRETS_KEY` ausente | O boot deveria ter falhado; verifique se o processo subiu com o `.env` certo |

## 2. "Consulta devolve zero linhas" (e deveria devolver dados)

**É quase sempre escopo, não dado sumido.** Toda leitura precisa passar por
`withTenant` ou `withUserOnly`; fora deles a RLS filtra tudo e a consulta
responde vazio **sem erro**.

Confirme comparando os dois papéis — o dono ignora RLS:

```bash
psql "$ADMIN" -c "select count(*) from crm_customers where tenant_id = '<uuid>'"
psql "$APP"   -c "select count(*) from crm_customers where tenant_id = '<uuid>'"
```

- Dono vê e app não vê → **é escopo**. Ache a consulta e dê escopo a ela.
- Nenhum dos dois vê → o dado não existe. Investigue a escrita.

**Nunca** afrouxe a policy para "resolver". Isso transforma um defeito de uma
rota num vazamento entre empresas.

## 3. Eventos não estão sendo entregues

O outbox **é** a fila (ADR-0012); não há broker para reiniciar.

```sql
-- Onde está travado
select status, count(*), min(available_at), max(attempts)
from platform_outbox group by status;
```

| Situação                                       | Significa                                  | Ação                                                                           |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `pending` crescendo, `available_at` no passado | O worker não está rodando                  | Suba `apps/worker`. Ele é o único que drena                                    |
| `pending` com `attempts` alto                  | Handler falhando; o backoff está segurando | Leia `last_error`. Corrija o handler — a entrega é retomada sozinha            |
| `dead`                                         | Desistiu depois de `maximoDeTentativas`    | Corrija a causa e reviva (abaixo)                                              |
| Tudo `delivered`, mas o efeito não aconteceu   | O handler falhou em silêncio               | O handler precisa lançar para o outbox reter; um `catch` vazio some com o fato |

Reviver da DLQ, depois de corrigida a causa:

```sql
update platform_outbox
   set status = 'pending', attempts = 0, available_at = now(), last_error = null
 where status = 'dead' and tenant_id = '<uuid>';
```

**A entrega é at-least-once.** Reviver pode reentregar o que já foi entregue —
handler não idempotente vai duplicar efeito. Confirme a idempotência antes.

## 4. Suspeita de vazamento de refresh token

A rotação já detecta sozinha: apresentar um token já usado derruba a família
inteira do usuário. Se a suspeita vier de fora (equipamento perdido, aviso de
terceiro), derrube manualmente:

```sql
-- Todas as sessões de um usuário
update identity_refresh_tokens set revoked_at = now()
 where user_id = '<uuid>' and revoked_at is null;

-- Todas as sessões de uma empresa
update identity_refresh_tokens set revoked_at = now()
 where tenant_id = '<uuid>' and revoked_at is null;
```

O access token **continua valendo até expirar** (`ACCESS_TOKEN_TTL_SECONDS`,
padrão 15 min): ele não é consultado no banco. Se for preciso cortar antes
disso, o caminho é derrubar o vínculo — o acesso é resolvido do banco a cada
requisição:

```sql
update tenancy_memberships set status = 'suspended' where id = '<uuid>';
```

## 5. `SECRETS_KEY` comprometida

A chave cifra os segredos de integração de todas as empresas (AES-256-GCM).
**Não há rotação implementada** — dívida registrada no roadmap. Hoje o
procedimento é manual e destrutivo:

1. Gere a nova chave: `openssl rand -base64 32`.
2. Com a chave ANTIGA ainda no ambiente, exporte os segredos que precisam
   sobreviver (pelo caso de uso de leitura do plugin — eles não saem por
   nenhuma rota).
3. Troque `SECRETS_KEY` e reinicie.
4. Reconfigure os plugins de cada empresa.

Sem o passo 2 os segredos ficam ilegíveis e cada empresa precisa reconfigurar
do zero. Avise antes.

## 6. Uma empresa reclama de "Requisições demais" (429)

O balde é **por credencial**, não por endereço (ver `rate-limit.ts`). Um 429
para uma pessoa não afeta as outras da mesma empresa.

```bash
grep '"status":429' log | tail -50
```

- Muitas credenciais diferentes da mesma empresa → o uso real cresceu; suba
  `RATE_LIMIT_MAX`.
- Uma credencial só, em laço → quase sempre integração com defeito. O teto
  está fazendo o trabalho dele; procure quem está chamando.
- No gateway MCP, quase sempre é agente sem condição de parada. Mesma coisa.

Lembre: o contador vive na memória do processo. Reiniciar zera todos os baldes
— use isso como alívio imediato, não como correção.

## 7. Migração falhou no boot

```
MigrationDriftError: checksum divergente em <arquivo>
```

Alguém **editou uma migração já aplicada**. Migrações são imutáveis. Não
"conserte" o ledger: reverta a edição no arquivo e crie uma migração nova com
a mudança pretendida.

```
role "ecojotaduo_app" does not exist
```

O runner recusa iniciar sem o papel restrito — de propósito, porque conectar
como dono faria a RLS deixar de valer para tudo. Recrie o papel:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d
```

`down -v` **apaga o volume**. Em produção, crie o papel à mão em vez disso
(ver `docker/init/01-app-role.sh`).

```
permission denied to create extension "btree_gist"
```

O módulo Ativos usa a extensão para a restrição que impede bloqueios
sobrepostos. É _trusted_ desde o PostgreSQL 13, então o dono do banco a cria
sem ser superusuário — mas um provedor gerenciado pode bloquear extensões.
Peça a habilitação; não há alternativa em SQL puro com a mesma garantia.

---

## Backup e restauração

**Um backup que nunca foi restaurado não é backup, é esperança.** Teste a
restauração num ambiente descartável antes de precisar dela.

### Cópia

```bash
pg_dump "$ADMIN" --format=custom --file=ecojotaduo-$(date +%F).dump
```

Use a conexão do **dono**: o papel da aplicação não enxerga as linhas das
outras empresas (é esse o ponto da RLS), e um dump feito com ele sairia
parcial e silenciosamente incompleto.

### Restauração

```bash
createdb -T template0 ecojotaduo_restaurado
pg_restore --dbname=ecojotaduo_restaurado --no-owner ecojotaduo-2026-08-21.dump
```

Depois de restaurar, **recrie o papel da aplicação e os grants**: `pg_restore`
traz tabelas e policies, não papéis do cluster. Sem isso a aplicação sobe
conectando como dono — e a RLS deixa de valer para tudo, em silêncio.

```bash
psql "$ADMIN" -d ecojotaduo_restaurado -f docker/init/01-app-role.sh   # adapte o SQL
psql "$ADMIN" -d ecojotaduo_restaurado -c "select rolname from pg_roles where rolname = 'ecojotaduo_app'"
```

### Verificação obrigatória

Depois de qualquer restauração, confirme que o isolamento sobreviveu:

```sql
-- Deve devolver ZERO linhas: sem tenant fixado, a policy filtra tudo.
select set_config('app.tenant_id', '', true);
select count(*) from crm_customers;
```

Se devolver dados, a aplicação está conectando como dono ou as policies não
vieram. **Não libere o ambiente** até isso responder zero.

### O que o backup não cobre

- `JWT_SECRET` e `SECRETS_KEY` vivem no ambiente, não no banco. Sem elas, o
  dump é dado cifrado que ninguém abre. Guarde-as separadamente.
- Os baldes de rate limit são em memória e não precisam de cópia.
