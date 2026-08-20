#!/bin/sh
# Executado UMA VEZ, na primeira inicialização do container (volume vazio).
#
# Cria o papel de aplicação e o banco de testes. O papel é separado do dono
# das tabelas de propósito: o PostgreSQL NÃO aplica Row Level Security ao dono
# nem a superusuários, então a aplicação precisa conectar com um papel comum
# para que o isolamento entre empresas realmente valha.
#
# Os valores chegam por variável de ambiente e entram no SQL como parâmetros
# do psql (:'var' vira literal citado, :"var" vira identificador citado) —
# nunca por interpolação de shell.
set -e

: "${APP_DB_USER:?defina APP_DB_USER em docker/.env}"
: "${APP_DB_PASSWORD:?defina APP_DB_PASSWORD em docker/.env}"
: "${TEST_DB_NAME:=movimentar_test}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<-'EOSQL'
	create role :"app_user" with login password :'app_password';
	grant connect on database :"db_name" to :"app_user";
	grant usage on schema public to :"app_user";
EOSQL

createdb --username "$POSTGRES_USER" "$TEST_DB_NAME"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$TEST_DB_NAME" \
  -v app_user="$APP_DB_USER" \
  -v db_name="$TEST_DB_NAME" <<-'EOSQL'
	grant connect on database :"db_name" to :"app_user";
	grant usage on schema public to :"app_user";
EOSQL

echo "Papel de aplicação e banco de testes criados."
