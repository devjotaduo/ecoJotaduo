import { ouFalhar } from '@ecojotaduo/api-client';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRecurso } from '../api/recurso';
import { mensagemDeErro, useSessao } from '../api/sessao';
import { data, dinheiro, emCentavos, situacao } from '../formato';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Estado,
  Etiqueta,
  Selecao,
} from '../ui/componentes';

/** Funil comercial: propostas em elaboração, enviadas e decididas. */
export function Propostas() {
  const { api, pode } = useSessao();
  const [filtro, setFiltro] = useState('');

  const propostas = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/commercial/proposals', {
          params: {
            query: {
              status: (filtro || undefined) as never,
              limit: 50,
              offset: 0,
            },
          },
        }),
      ),
    [api, filtro],
  );

  return (
    <div className="pagina">
      <Cartao
        titulo="Propostas"
        acoes={
          <Selecao
            rotulo="Situação"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas' },
              { valor: 'draft', texto: 'Rascunho' },
              { valor: 'sent', texto: 'Enviadas' },
              { valor: 'accepted', texto: 'Aceitas' },
              { valor: 'rejected', texto: 'Recusadas' },
            ]}
          />
        }
      >
        <Estado
          carregando={propostas.carregando}
          erro={propostas.erro}
          vazio={propostas.dados?.items.length === 0}
        >
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Título</th>
                <th>Valor</th>
                <th>Validade</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {propostas.dados?.items.map((proposta) => (
                <tr key={proposta.id}>
                  <td>{proposta.number}</td>
                  <td>
                    <Link to={`/propostas/${proposta.id}`}>
                      {proposta.title}
                    </Link>
                  </td>
                  <td className="numero">
                    {dinheiro(proposta.totalCents, proposta.currency)}
                  </td>
                  <td>{data(proposta.validUntil)}</td>
                  <td>
                    <Etiqueta>{situacao(proposta.status)}</Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      {pode('commercial.proposal.create') ? <NovaProposta /> : null}
    </div>
  );
}

function NovaProposta() {
  const { api } = useSessao();
  const navegar = useNavigate();
  const [customerId, setCustomerId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [validade, setValidade] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [preco, setPreco] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const clientes = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/crm/customers', {
          params: { query: { limit: 100, offset: 0 } },
        }),
      ),
    [api],
  );

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);

    const centavos = emCentavos(preco);
    if (Number.isNaN(centavos)) {
      setErro('Informe o preço unitário, por exemplo 1.999,90.');
      return;
    }

    setEnviando(true);
    try {
      const criada = await ouFalhar(
        api.rotas.POST('/api/v1/commercial/proposals', {
          body: {
            customerId,
            title: titulo,
            currency: 'BRL',
            // O campo de data dá o dia; a validade vale até o fim dele.
            validUntil: new Date(`${validade}T23:59:59Z`).toISOString(),
            items: [
              {
                description: descricao,
                quantity: Number(quantidade),
                // Em CENTAVOS: o total quem calcula é o servidor.
                unitPriceCents: centavos,
              },
            ],
          },
        }),
      );
      void navegar(`/propostas/${criada.id}`);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Nova proposta">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Selecao
          rotulo="Cliente"
          value={customerId}
          onChange={(evento) => setCustomerId(evento.target.value)}
          required
          opcoes={[
            { valor: '', texto: 'Selecione…' },
            ...(clientes.dados?.items ?? []).map((cliente) => ({
              valor: cliente.id,
              texto: cliente.name,
            })),
          ]}
        />
        <Campo
          rotulo="Título"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          required
          minLength={2}
        />
        <Campo
          rotulo="Válida até"
          type="date"
          value={validade}
          onChange={(evento) => setValidade(evento.target.value)}
          required
        />
        <Campo
          rotulo="Item"
          value={descricao}
          onChange={(evento) => setDescricao(evento.target.value)}
          required
          minLength={2}
        />
        <Campo
          rotulo="Quantidade"
          type="number"
          min={1}
          value={quantidade}
          onChange={(evento) => setQuantidade(evento.target.value)}
          required
        />
        <Campo
          rotulo="Preço unitário"
          value={preco}
          onChange={(evento) => setPreco(evento.target.value)}
          placeholder="1.500,00"
          dica="Em reais. O total é calculado pelo servidor."
          required
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Criando…' : 'Criar rascunho'}
        </Botao>
      </form>
    </Cartao>
  );
}

/** Detalhe da proposta e as decisões possíveis sobre ela. */
export function Proposta({ proposalId }: { proposalId: string }) {
  const { api, pode } = useSessao();
  const navegar = useNavigate();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const proposta = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/commercial/proposals/{proposalId}', {
          params: { path: { proposalId } },
        }),
      ),
    [api, proposalId],
  );

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      proposta.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  const atual = proposta.dados;
  // A situação vem do servidor já com o vencimento aplicado (`expired`).
  const enviada = atual?.status === 'sent';
  const aceita = atual?.status === 'accepted';

  return (
    <div className="pagina">
      <Cartao
        titulo={atual ? `Proposta nº ${atual.number}` : 'Proposta'}
        acoes={atual ? <Etiqueta>{situacao(atual.status)}</Etiqueta> : null}
      >
        <Estado
          carregando={proposta.carregando}
          erro={proposta.erro}
          vazio={false}
        >
          <dl className="ficha">
            <dt>Cliente</dt>
            <dd>{atual?.customerName ?? '—'}</dd>
            <dt>Título</dt>
            <dd>{atual?.title}</dd>
            <dt>Validade</dt>
            <dd>{atual ? data(atual.validUntil) : '—'}</dd>
            <dt>Total</dt>
            <dd className="numero">
              {atual ? dinheiro(atual.totalCents, atual.currency) : '—'}
            </dd>
          </dl>

          <table className="tabela">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd.</th>
                <th>Unitário</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {atual?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td className="numero">{item.quantity}</td>
                  <td className="numero">
                    {dinheiro(item.unitPriceCents, atual.currency)}
                  </td>
                  <td className="numero">
                    {dinheiro(item.totalCents, atual.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {erro ? <Aviso>{erro}</Aviso> : null}

          <div className="linha">
            {atual?.status === 'draft' && pode('commercial.proposal.send') ? (
              <Botao
                disabled={ocupado}
                onClick={() =>
                  void agir(() =>
                    ouFalhar(
                      api.rotas.POST(
                        '/api/v1/commercial/proposals/{proposalId}/send',
                        { params: { path: { proposalId } } },
                      ),
                    ),
                  )
                }
              >
                Enviar ao cliente
              </Botao>
            ) : null}

            {enviada && pode('commercial.proposal.approve') ? (
              <>
                <Botao
                  disabled={ocupado}
                  onClick={() =>
                    void agir(() =>
                      ouFalhar(
                        api.rotas.POST(
                          '/api/v1/commercial/proposals/{proposalId}/accept',
                          { params: { path: { proposalId } } },
                        ),
                      ),
                    )
                  }
                >
                  Registrar aceite
                </Botao>
                <Botao
                  variante="perigo"
                  disabled={ocupado}
                  onClick={() =>
                    void agir(() =>
                      ouFalhar(
                        api.rotas.POST(
                          '/api/v1/commercial/proposals/{proposalId}/reject',
                          { params: { path: { proposalId } } },
                        ),
                      ),
                    )
                  }
                >
                  Registrar recusa
                </Botao>
              </>
            ) : null}

            {aceita && pode('contracts.contract.create') ? (
              <Botao
                variante="secundario"
                onClick={() =>
                  void navegar(`/contratos?proposta=${proposalId}`)
                }
              >
                Formalizar contrato
              </Botao>
            ) : null}
          </div>
        </Estado>
      </Cartao>
    </div>
  );
}
