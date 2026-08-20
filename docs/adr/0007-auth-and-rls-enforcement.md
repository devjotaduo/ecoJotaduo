# ADR-0007 — Autenticação do MVP e aplicação efetiva da RLS

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

A Fase 2 precisa de autenticação de usuários e de aplicações, além de tornar o
isolamento entre tenants uma garantia real (e não apenas uma convenção de código).
Três decisões concretas exigiram registro: como guardar senhas, como assinar tokens e
como fazer a Row Level Security valer de fato.

## Decisão 1 — Senhas com `scrypt` da biblioteca padrão do Node

Parâmetros OWASP: `N=2^16, r=8, p=2`, sal de 16 bytes, chave de 32 bytes; formato
`scrypt$N$r$p$sal$chave` (parâmetros embutidos, para endurecer no futuro sem
invalidar senhas existentes). Comparação em tempo constante.

- **Alternativa preterida**: `argon2id` (via `@node-rs/argon2` ou `argon2`). É
  preferível em teoria, mas exige dependência nativa/binária. `scrypt` é aceito pelo
  OWASP, vem no `node:crypto` e evita build nativo no Windows e nas imagens Alpine.
- **Caminho de upgrade**: como o hash carrega o algoritmo, adicionar argon2id depois é
  transparente — basta reidratar no próximo login bem-sucedido.

Segredos de máquina (refresh tokens, client secrets) usam **SHA-256**, não KDF lento:
são gerados por nós com 256 bits de entropia, então não há o que adivinhar por força
bruta, e o caminho máquina-a-máquina precisa ser rápido.

## Decisão 2 — JWT HS256 implementado sobre `node:crypto`

- **Alternativa preterida**: biblioteca `jose` (v6). É excelente, porém é ESM-only
  (`"type": "module"`, sem condição `require`), enquanto NestJS compila para
  CommonJS. Conviveriam dois sistemas de módulos por causa de ~40 linhas de código.
- **Decisão**: emitir e verificar HS256 diretamente com `createHmac`, com estas regras:
  1. **O algoritmo é fixo no código.** O cabeçalho do token é conferido, nunca
     obedecido — isso elimina por construção a família de falhas de _alg confusion_
     (`alg: none`, troca de HS256 por RS256), que é justamente o que quase todas as
     CVEs de bibliotecas JWT exploram.
  2. Assinatura verificada **antes** de qualquer leitura do conteúdo, com
     `timingSafeEqual`.
  3. `iss`, `aud`, `exp` e `iat` validados, com tolerância de relógio de 30s.
  4. Testes de ataque explícitos no repositório (`packages/auth`): `alg: none`,
     payload adulterado para trocar de tenant, cabeçalho inconsistente, token de
     outro emissor, formatos malformados.
- **Quando revisar**: se a Fase 5 (MCP/OAuth) exigir chaves assimétricas, JWKS ou
  rotação de chaves públicas, adotar `jose` — nesse cenário o custo da criptografia
  própria deixa de compensar.

## Decisão 3 — A aplicação conecta com um papel PostgreSQL restrito

Descoberta que mudou o desenho: **o PostgreSQL não aplica RLS ao dono da tabela nem a
superusuários**. Como o usuário padrão do container é superusuário, as policies do
ADR-0002 seriam decorativas.

Portanto:

| Conexão              | Papel            | Uso                          | Privilégios                                                  |
| -------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`       | `movimentar_app` | Aplicação (API, MCP, worker) | Apenas os `GRANT` de cada migração; sem DDL, sem `BYPASSRLS` |
| `DATABASE_ADMIN_URL` | dono das tabelas | Migrações e seed             | DDL completo                                                 |

O runner de migrações **recusa iniciar** se o papel de aplicação não existir
(`MissingAppRoleError`), transformando um erro silencioso de configuração — que
desligaria o isolamento inteiro — em falha explícita de boot.

Consequência de desenho: **nenhuma consulta roda sem escopo**. Toda leitura passa por
`withTenant` (tenant fixado) ou `withUserOnly` (login e "minhas empresas"). Sem
escopo, as policies não devolvem linha alguma — o que o teste de integração exercita.

## Benefícios

- Zero dependência nova para criptografia; superfície auditável e testada.
- Isolamento defendido em três camadas independentes: repositório tipado por
  `TenantId`, políticas de RLS no banco e testes de integração que tentam furar.
- Erro de configuração de papel vira falha de boot, não vazamento silencioso.

## Riscos

- Criptografia própria exige revisão a cada mudança — mitigado pelo escopo mínimo
  (HS256 simétrico) e pelos testes de ataque versionados.
- `scrypt` com 64 MiB por verificação pode pesar sob rajada de logins — mitigar com
  rate limiting na Fase 10.
- Duas URLs de banco aumentam a superfície de configuração — mitigado por validação
  no boot e por documentação em `.env.example`.

## Impacto da migração

Trocar o hash de senha ou o emissor de token afeta apenas `packages/auth`; os casos de
uso dependem das portas `PasswordHasher`, `SecretHasher` e `AccessTokenIssuer`.
