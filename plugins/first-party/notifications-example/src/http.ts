/**
 * Borda REST do módulo.
 *
 * Fica num subcaminho (`@ecojotaduo/plugin-notifications-example/http`) e NÃO no `index`: os
 * controllers trazem NestJS junto, e quem só precisa dos casos de uso — o
 * gateway MCP, o worker — carregaria um framework HTTP inteiro em tempo de
 * require por nada. Foi assim que o worker quebrou no primeiro deploy.
 *
 * Quem monta a borda é o app (`apps/api`), como diz o desenho: o módulo
 * declara, o composition root liga.
 */

export { NotificationsController } from './adapters/http/notifications.controller';
