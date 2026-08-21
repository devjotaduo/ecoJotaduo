import { ouFalhar } from '@ecojotaduo/api-client';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useRecurso } from '../api/recurso';
import { mensagemDeErro, useSessao } from '../api/sessao';
import { dataHora, situacao } from '../formato';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Estado,
  Etiqueta,
} from '../ui/componentes';

/** Carteira de clientes: pesquisa e cadastro. */
export function Clientes() {
  const { api, pode } = useSessao();
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');

  const clientes = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/crm/customers', {
          params: {
            query: { termo: busca || undefined, limit: 50, offset: 0 },
          },
        }),
      ),
    [api, busca],
  );

  return (
    <div className="pagina">
      <Cartao
        titulo="Clientes"
        acoes={
          <form
            className="linha"
            onSubmit={(evento) => {
              evento.preventDefault();
              setBusca(termo);
            }}
          >
            <Campo
              rotulo="Pesquisar"
              value={termo}
              onChange={(evento) => setTermo(evento.target.value)}
              placeholder="nome, e-mail ou documento"
            />
            <Botao type="submit" variante="secundario">
              Pesquisar
            </Botao>
          </form>
        }
      >
        <Estado
          carregando={clientes.carregando}
          erro={clientes.erro}
          vazio={clientes.dados?.items.length === 0}
        >
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Documento</th>
                <th>Contato</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {clientes.dados?.items.map((cliente) => (
                <tr key={cliente.id}>
                  <td>
                    <Link to={`/clientes/${cliente.id}`}>{cliente.name}</Link>
                  </td>
                  <td>{cliente.documentFormatted ?? '—'}</td>
                  <td>{cliente.email ?? cliente.phone ?? '—'}</td>
                  <td>
                    <Etiqueta>{situacao(cliente.status)}</Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      {/* Escondido quando não adianta: o servidor recusaria de qualquer forma. */}
      {pode('crm.customer.create') ? (
        <NovoCliente aoCriar={clientes.recarregar} />
      ) : null}
    </div>
  );
}

function NovoCliente({ aoCriar }: { aoCriar: () => void }) {
  const { api } = useSessao();
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/crm/customers', {
          body: {
            name: nome,
            document: documento || null,
            email: email || null,
          },
        }),
      );
      setNome('');
      setDocumento('');
      setEmail('');
      aoCriar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Novo cliente">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Campo
          rotulo="Nome"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          required
          minLength={2}
        />
        <Campo
          rotulo="CPF ou CNPJ"
          value={documento}
          onChange={(evento) => setDocumento(evento.target.value)}
          dica="Opcional. A pontuação não importa; o servidor valida os dígitos."
        />
        <Campo
          rotulo="E-mail"
          type="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Cadastrar'}
        </Botao>
      </form>
    </Cartao>
  );
}

/** Ficha do cliente com a linha do tempo (notas e compromissos). */
export function Cliente({ customerId }: { customerId: string }) {
  const { api, pode } = useSessao();
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const cliente = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/crm/customers/{customerId}', {
          params: { path: { customerId } },
        }),
      ),
    [api, customerId],
  );

  async function registrarNota(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/crm/customers/{customerId}/notes', {
          params: { path: { customerId } },
          body: { body: nota },
        }),
      );
      setNota('');
      cliente.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <div className="pagina">
      <Cartao titulo={cliente.dados?.name ?? 'Cliente'}>
        <Estado
          carregando={cliente.carregando}
          erro={cliente.erro}
          vazio={false}
        >
          <dl className="ficha">
            <dt>Documento</dt>
            <dd>{cliente.dados?.documentFormatted ?? '—'}</dd>
            <dt>E-mail</dt>
            <dd>{cliente.dados?.email ?? '—'}</dd>
            <dt>Telefone</dt>
            <dd>{cliente.dados?.phone ?? '—'}</dd>
            <dt>Situação</dt>
            <dd>{situacao(cliente.dados?.status ?? '')}</dd>
          </dl>
        </Estado>
      </Cartao>

      <Cartao titulo="Linha do tempo">
        <Estado
          carregando={cliente.carregando}
          erro={null}
          vazio={cliente.dados?.timeline.length === 0}
        >
          <ul className="linha-do-tempo">
            {cliente.dados?.timeline.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <time>{dataHora(item.occurredAt)}</time>
                <strong>{item.summary}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
              </li>
            ))}
          </ul>
        </Estado>
      </Cartao>

      {pode('crm.note.create') ? (
        <Cartao titulo="Registrar nota">
          <form
            className="formulario"
            onSubmit={(evento) => void registrarNota(evento)}
          >
            <Campo
              rotulo="Nota"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              required
              dica="Notas não podem ser editadas depois."
            />
            {erro ? <Aviso>{erro}</Aviso> : null}
            <Botao type="submit">Registrar</Botao>
          </form>
        </Cartao>
      ) : null}
    </div>
  );
}
