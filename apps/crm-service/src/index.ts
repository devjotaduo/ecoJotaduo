/**
 * Superfície do serviço extraído.
 *
 * Exporta o composition root porque um teste da plataforma precisa subir o
 * serviço no mesmo processo para provar que o Comercial funciona com o CRM
 * fora dele. Em produção quem sobe é o `main.ts`.
 */
export { criarServicoDeCrm, ROTA_CLIENTE, type ServicoDeCrm } from './service';
