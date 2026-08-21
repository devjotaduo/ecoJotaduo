import { ouFalhar } from '@ecojotaduo/api-client';
import { useState, type FormEvent } from 'react';

import { useRecurso } from '../api/recurso';
import { mensagemDeErro, useSessao } from '../api/sessao';
import { data, situacao } from '../formato';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Estado,
  Etiqueta,
  Selecao,
} from '../ui/componentes';

/**
 * Locações: o equipamento na mão do cliente.
 *
 * A coluna "Situação" mostra `overdue` sem que nada tenha rodado: uma locação
 * em andamento cujo prazo passou está atrasada no instante em que passa.
 */
export function Locacoes() {
  const { api, pode } = useSessao();
  const [filtro, setFiltro] = useState('');
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const locacoes = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/operations/rentals', {
          params: {
            query: {
              status: (filtro || undefined) as never,
              atrasadas: soAtrasadas || undefined,
              limit: 50,
              offset: 0,
            },
          },
        }),
      ),
    [api, filtro, soAtrasadas],
  );

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      locacoes.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pagina">
      <Cartao
        titulo="Locações"
        acoes={
          <>
            <Selecao
              rotulo="Situação"
              value={filtro}
              onChange={(evento) => setFiltro(evento.target.value)}
              opcoes={[
                { valor: '', texto: 'Todas' },
                { valor: 'scheduled', texto: 'Programadas' },
                { valor: 'active', texto: 'Em andamento' },
                { valor: 'finished', texto: 'Encerradas' },
                { valor: 'canceled', texto: 'Canceladas' },
              ]}
            />
            <Selecao
              rotulo="Atraso"
              value={soAtrasadas ? 'sim' : ''}
              onChange={(evento) =>
                setSoAtrasadas(evento.target.value === 'sim')
              }
              opcoes={[
                { valor: '', texto: 'Todas' },
                { valor: 'sim', texto: 'Só as atrasadas' },
              ]}
            />
          </>
        }
      >
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Estado
          carregando={locacoes.carregando}
          erro={locacoes.erro}
          vazio={locacoes.dados?.items.length === 0}
        >
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Equipamento</th>
                <th>Período</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {locacoes.dados?.items.map((locacao) => (
                <tr key={locacao.id}>
                  <td>{locacao.number}</td>
                  <td>{locacao.assetCode}</td>
                  <td>
                    {data(locacao.startsAt)} — {data(locacao.endsAt)}
                  </td>
                  <td>
                    <Etiqueta>{situacao(locacao.status)}</Etiqueta>
                    {locacao.overdueDays > 0 ? (
                      <span className="badge-vigor">
                        {locacao.overdueDays}{' '}
                        {locacao.overdueDays === 1 ? 'dia' : 'dias'} de atraso
                      </span>
                    ) : null}
                  </td>
                  <td className="linha">
                    {locacao.storedStatus === 'scheduled' &&
                    pode('operations.rental.manage') ? (
                      <>
                        <Botao
                          disabled={ocupado}
                          onClick={() =>
                            void agir(() =>
                              ouFalhar(
                                api.rotas.POST(
                                  '/api/v1/operations/rentals/{rentalId}/start',
                                  {
                                    params: { path: { rentalId: locacao.id } },
                                  },
                                ),
                              ),
                            )
                          }
                        >
                          Registrar retirada
                        </Botao>
                        <Botao
                          variante="perigo"
                          disabled={ocupado}
                          onClick={() =>
                            void agir(() =>
                              ouFalhar(
                                api.rotas.POST(
                                  '/api/v1/operations/rentals/{rentalId}/cancel',
                                  {
                                    params: {
                                      path: { rentalId: locacao.id },
                                    },
                                    body: { reason: null },
                                  },
                                ),
                              ),
                            )
                          }
                        >
                          Cancelar
                        </Botao>
                      </>
                    ) : null}

                    {/*
                      Devolver vale mesmo atrasada: é assim que a situação para
                      de ser "atrasada" e o equipamento volta ao pátio.
                    */}
                    {locacao.storedStatus === 'active' &&
                    pode('operations.rental.manage') ? (
                      <Botao
                        disabled={ocupado}
                        onClick={() =>
                          void agir(() =>
                            ouFalhar(
                              api.rotas.POST(
                                '/api/v1/operations/rentals/{rentalId}/finish',
                                {
                                  params: { path: { rentalId: locacao.id } },
                                  body: { reason: null },
                                },
                              ),
                            ),
                          )
                        }
                      >
                        Registrar devolução
                      </Botao>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      {pode('operations.rental.create') ? (
        <NovaLocacao aoProgramar={locacoes.recarregar} />
      ) : null}
    </div>
  );
}

function NovaLocacao({ aoProgramar }: { aoProgramar: () => void }) {
  const { api } = useSessao();
  const [contractId, setContractId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Só contratos em vigor e equipamentos disponíveis entram nas listas. É
  // conveniência: o servidor recusa de qualquer forma o que não serve.
  const contratos = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/contracts', {
          params: { query: { status: 'active', limit: 100, offset: 0 } },
        }),
      ),
    [api],
  );
  const equipamentos = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/assets', {
          params: {
            query: { availability: 'available', limit: 100, offset: 0 },
          },
        }),
      ),
    [api],
  );

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/operations/rentals', {
          body: {
            contractId,
            assetId,
            startsAt: new Date(`${inicio}T00:00:00Z`).toISOString(),
            endsAt: new Date(`${fim}T23:59:59Z`).toISOString(),
            notes: null,
          },
        }),
      );
      setInicio('');
      setFim('');
      aoProgramar();
    } catch (falha) {
      // O servidor recusa contrato fora de vigor, período fora da vigência e
      // equipamento já comprometido — a tela não adivinha nenhum dos três.
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Programar locação">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Selecao
          rotulo="Contrato em vigor"
          value={contractId}
          onChange={(evento) => setContractId(evento.target.value)}
          required
          opcoes={[
            { valor: '', texto: 'Selecione…' },
            ...(contratos.dados?.items ?? []).map((contrato) => ({
              valor: contrato.id,
              texto: `nº ${contrato.number} — ${contrato.title}`,
            })),
          ]}
        />
        <Selecao
          rotulo="Equipamento"
          value={assetId}
          onChange={(evento) => setAssetId(evento.target.value)}
          required
          opcoes={[
            { valor: '', texto: 'Selecione…' },
            ...(equipamentos.dados?.items ?? []).map((ativo) => ({
              valor: ativo.id,
              texto: `${ativo.code} — ${ativo.name}`,
            })),
          ]}
        />
        <Campo
          rotulo="Retirada"
          type="date"
          value={inicio}
          onChange={(evento) => setInicio(evento.target.value)}
          required
        />
        <Campo
          rotulo="Devolução prevista"
          type="date"
          value={fim}
          onChange={(evento) => setFim(evento.target.value)}
          required
          dica="Precisa caber dentro da vigência do contrato."
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Programando…' : 'Programar'}
        </Botao>
      </form>
    </Cartao>
  );
}
