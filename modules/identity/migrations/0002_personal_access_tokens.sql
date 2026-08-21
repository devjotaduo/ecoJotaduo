-- Tokens pessoais de acesso.
--
-- Existem para o caso em que uma PESSOA precisa que um programa aja em nome
-- dela de forma continuada — o primeiro é um agente de IA num host MCP, que
-- manda um cabeçalho fixo e não tem como refazer login a cada quinze minutos.
--
-- A alternativa seria uma conta de serviço compartilhada, e ela custa caro: a
-- trilha de auditoria passaria a dizer "conta de serviço" para todo mundo, e
-- as permissões deixariam de ser por pessoa. Um token pessoal preserva as
-- duas coisas — quem agiu continua sendo quem agiu.
--
-- Tabela de PLATAFORMA, como as outras do identity: sem RLS, porque a
-- autenticação acontece ANTES de qualquer tenant ser resolvido. O vínculo com
-- a empresa está na coluna `tenant_id` e é ele que dá o escopo à sessão.

create table if not exists identity_personal_access_tokens (
  id           uuid        primary key,
  user_id      uuid        not null references identity_users (id) on delete cascade,
  -- A empresa em que o token age. Um token pertence a UMA empresa, mesmo que
  -- a pessoa tenha vínculo em várias: senão o portador escolheria o escopo.
  tenant_id    uuid        not null,
  -- Como a pessoa reconhece o token na lista ("agente do LibreChat").
  name         text        not null,
  -- Só o hash. Vazamento do banco não revela o token (ver packages/auth).
  token_hash   text        not null unique,
  -- Os quatro primeiros caracteres depois do prefixo, para a pessoa
  -- identificar QUAL token revogar sem que isso ajude a adivinhar o resto.
  hint         text        not null,
  -- Teto de permissão do token. A decisão final continua sendo a interseção
  -- com os papéis vivos da pessoa: reduzir aqui restringe, nunca amplia.
  scopes       text[]      not null default '{}',
  expires_at   timestamptz,
  revoked_at   timestamptz,
  -- Atualizado de forma grosseira (no máximo uma vez por hora): serve para
  -- responder "este token está esquecido há três meses?", não para métrica.
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists identity_personal_access_tokens_user_idx
  on identity_personal_access_tokens (user_id, tenant_id)
  where revoked_at is null;

grant select, insert, update on identity_personal_access_tokens to ecojotaduo_app;
