import { ouFalhar } from '@ecojotaduo/api-client';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useRecurso } from '../api/recurso';
import { mensagemDeErro, useSessao } from '../api/sessao';
import { data, dinheiro, situacao } from '../formato';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Estado,
  Etiqueta,
} from '../ui/componentes';

/** Contratos em vigor, em rascunho e encerrados. */
export function Contratos() {
  const { api, pode } = useSessao();
  const [parametros] = useSearchParams();
  const propostaSugerida = parametros.get('proposta') ?? '';
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const contratos = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/contracts', {
          params: { query: { limit: 50, offset: 0 } },
        }),
      ),
    [api],
  );

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      contratos.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pagina">
      <Cartao titulo="Contratos">
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Estado
          carregando={contratos.carregando}
          erro={contratos.erro}
          vazio={contratos.dados?.items.length === 0}
        >
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Título</th>
                <th>Valor</th>
                <th>Vigência</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contratos.dados?.items.map((contrato) => (
                <tr key={contrato.id}>
                  <td>{contrato.number}</td>
                  <td>{contrato.title}</td>
                  <td className="numero">
                    {dinheiro(contrato.valueCents, contrato.currency)}
                  </td>
                  <td>
                    {data(contrato.startsOn)} — {data(contrato.endsOn)}
                  </td>
                  <td>
                    <Etiqueta>{situacao(contrato.status)}</Etiqueta>
                    {contrato.inForce ? (
                      <span className="badge-vigor">em vigor</span>
                    ) : null}
                  </td>
                  <td className="linha">
                    {contrato.storedStatus === 'draft' &&
                    pode('contracts.contract.activate') ? (
                      <Botao
                        variante="secundario"
                        disabled={ocupado}
                        onClick={() =>
                          void agir(() =>
                            ouFalhar(
                              api.rotas.POST(
                                '/api/v1/contracts/{contractId}/activate',
                                {
                                  params: {
                                    path: { contractId: contrato.id },
                                  },
                                },
                              ),
                            ),
                          )
                        }
                      >
                        Ativar
                      </Botao>
                    ) : null}

                    {/*
                      Encerrar continua valendo com a vigência vencida: é assim
                      que a situação deixa de ser "vencida" e vira "encerrado".
                    */}
                    {contrato.storedStatus === 'active' &&
                    pode('contracts.contract.close') ? (
                      <Botao
                        variante="secundario"
                        disabled={ocupado}
                        onClick={() =>
                          void agir(() =>
                            ouFalhar(
                              api.rotas.POST(
                                '/api/v1/contracts/{contractId}/finish',
                                {
                                  params: {
                                    path: { contractId: contrato.id },
                                  },
                                  body: { reason: null },
                                },
                              ),
                            ),
                          )
                        }
                      >
                        Encerrar
                      </Botao>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      {pode('contracts.contract.create') ? (
        <NovoContrato
          propostaSugerida={propostaSugerida}
          aoFormalizar={contratos.recarregar}
        />
      ) : null}
    </div>
  );
}

function NovoContrato({
  propostaSugerida,
  aoFormalizar,
}: {
  propostaSugerida: string;
  aoFormalizar: () => void;
}) {
  const { api } = useSessao();
  const [proposalId, setProposalId] = useState(propostaSugerida);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/contracts', {
          body: {
            proposalId,
            startsOn: new Date(`${inicio}T00:00:00Z`).toISOString(),
            endsOn: new Date(`${fim}T23:59:59Z`).toISOString(),
            notes: null,
          },
        }),
      );
      setProposalId('');
      setInicio('');
      setFim('');
      aoFormalizar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Formalizar contrato">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Campo
          rotulo="Proposta aceita"
          value={proposalId}
          onChange={(evento) => setProposalId(evento.target.value)}
          required
          dica="Cliente, título e valor vêm da proposta — aqui só a vigência."
        />
        <Campo
          rotulo="Início"
          type="date"
          value={inicio}
          onChange={(evento) => setInicio(evento.target.value)}
          required
        />
        <Campo
          rotulo="Término"
          type="date"
          value={fim}
          onChange={(evento) => setFim(evento.target.value)}
          required
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Formalizando…' : 'Formalizar'}
        </Botao>
      </form>
    </Cartao>
  );
}
