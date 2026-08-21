/**
 * Cliente remoto do CRM.
 *
 * Subcaminho próprio (`@ecojotaduo/crm/remote`) pelo mesmo motivo do `/http`:
 * quem monta o CRM em processo não precisa carregar o cliente HTTP, e quem só
 * consome à distância não precisa carregar o módulo inteiro.
 *
 * O módulo publica as DUAS formas de satisfazer o próprio contrato — em
 * processo (`CrmService`) e por HTTP (`CrmHttpClient`) —, e quem escolhe é o
 * composition root. É essa simetria que faz a extração ser mudança de
 * infraestrutura, e não reescrita (ADR-0001).
 */
export {
  CrmHttpClient,
  ServicoDeCrmIndisponivelError,
  type EmissorDeTokenInterno,
  type OpcoesDoClienteDeCrm,
} from './adapters/remote/crm.client';
