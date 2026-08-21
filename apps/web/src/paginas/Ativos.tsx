import { ouFalhar } from '@ecojotaduo/api-client';
import { useState, type FormEvent } from 'react';

import { useRecurso } from '../api/recurso';
import { mensagemDeErro, useSessao } from '../api/sessao';
import { data, motivoDeBloqueio, situacao } from '../formato';
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
 * Pátio de equipamentos.
 *
 * A coluna "Situação" NÃO existe no banco: ela é calculada a partir dos
 * bloqueios no instante da consulta. Por isso o filtro de data em cima da
 * lista responde "quem está livre no dia X" sem que nada precise rodar antes.
 */
export function Ativos() {
  const { api, pode } = useSessao();
  const [filtro, setFiltro] = useState('');
  const [emDia, setEmDia] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const instante = emDia
    ? new Date(`${emDia}T12:00:00Z`).toISOString()
    : undefined;

  const ativos = useRecurso(
    () =>
      ouFalhar(
        api.rotas.GET('/api/v1/assets', {
          params: {
            query: {
              availability: (filtro || undefined) as never,
              em: instante,
              limit: 50,
              offset: 0,
            },
          },
        }),
      ),
    [api, filtro, instante],
  );

  return (
    <div className="pagina">
      <Cartao
        titulo="Equipamentos"
        acoes={
          <>
            <Selecao
              rotulo="Situação"
              value={filtro}
              onChange={(evento) => setFiltro(evento.target.value)}
              opcoes={[
                { valor: '', texto: 'Todos' },
                { valor: 'available', texto: 'Disponíveis' },
                { valor: 'held', texto: 'Bloqueados' },
                { valor: 'retired', texto: 'Baixados' },
              ]}
            />
            <Campo
              rotulo="Na data"
              type="date"
              value={emDia}
              onChange={(evento) => setEmDia(evento.target.value)}
              dica="Deixe em branco para hoje."
            />
          </>
        }
      >
        <Estado
          carregando={ativos.carregando}
          erro={ativos.erro}
          vazio={ativos.dados?.items.length === 0}
        >
          <table className="tabela">
            <thead>
              <tr>
                <th>Código</th>
                <th>Equipamento</th>
                <th>Categoria</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ativos.dados?.items.map((ativo) => (
                <tr key={ativo.id}>
                  <td>{ativo.code}</td>
                  <td>{ativo.name}</td>
                  <td>{ativo.category}</td>
                  <td>
                    <Etiqueta>{situacao(ativo.availability)}</Etiqueta>
                    {ativo.currentHold ? (
                      <span className="badge-vigor">
                        {motivoDeBloqueio(ativo.currentHold.reason)} até{' '}
                        {data(ativo.currentHold.effectiveEndsAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="linha">
                    {ativo.currentHold && pode('assets.asset.hold') ? (
                      <LiberarBloqueio
                        holdId={ativo.currentHold.id}
                        aoLiberar={ativos.recarregar}
                      />
                    ) : null}
                    {ativo.availability !== 'retired' &&
                    pode('assets.asset.hold') ? (
                      <Botao
                        variante="secundario"
                        onClick={() =>
                          setSelecionado(
                            selecionado === ativo.id ? null : ativo.id,
                          )
                        }
                      >
                        Bloquear
                      </Botao>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Cartao>

      {selecionado ? (
        <NovoBloqueio
          assetId={selecionado}
          aoBloquear={() => {
            setSelecionado(null);
            ativos.recarregar();
          }}
        />
      ) : null}

      {pode('assets.asset.manage') ? (
        <NovoAtivo aoCadastrar={ativos.recarregar} />
      ) : null}
    </div>
  );
}

function LiberarBloqueio({
  holdId,
  aoLiberar,
}: {
  holdId: string;
  aoLiberar: () => void;
}) {
  const { api } = useSessao();
  const [ocupado, setOcupado] = useState(false);

  async function liberar() {
    setOcupado(true);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/asset-holds/{holdId}/release', {
          params: { path: { holdId } },
        }),
      );
      aoLiberar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Botao disabled={ocupado} onClick={() => void liberar()}>
      Liberar
    </Botao>
  );
}

function NovoBloqueio({
  assetId,
  aoBloquear,
}: {
  assetId: string;
  aoBloquear: () => void;
}) {
  const { api } = useSessao();
  const [motivo, setMotivo] = useState('maintenance');
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
        api.rotas.POST('/api/v1/asset-holds', {
          body: {
            assetId,
            reason: motivo as never,
            startsAt: new Date(`${inicio}T00:00:00Z`).toISOString(),
            // O dia do término conta inteiro: a borda superior é aberta.
            endsAt: new Date(`${fim}T23:59:59Z`).toISOString(),
            notes: null,
          },
        }),
      );
      aoBloquear();
    } catch (falha) {
      // O servidor recusa período já comprometido — a tela não adivinha.
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Bloquear equipamento">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Selecao
          rotulo="Motivo"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          opcoes={[
            { valor: 'maintenance', texto: 'Manutenção' },
            { valor: 'reserved', texto: 'Reservado' },
            { valor: 'damaged', texto: 'Avariado' },
            { valor: 'transit', texto: 'Em deslocamento' },
          ]}
        />
        <Campo
          rotulo="De"
          type="date"
          value={inicio}
          onChange={(evento) => setInicio(evento.target.value)}
          required
        />
        <Campo
          rotulo="Até"
          type="date"
          value={fim}
          onChange={(evento) => setFim(evento.target.value)}
          required
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Bloqueando…' : 'Bloquear'}
        </Botao>
      </form>
    </Cartao>
  );
}

function NovoAtivo({ aoCadastrar }: { aoCadastrar: () => void }) {
  const { api } = useSessao();
  const [code, setCode] = useState('');
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [serie, setSerie] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await ouFalhar(
        api.rotas.POST('/api/v1/assets', {
          body: {
            code,
            name: nome,
            category: categoria,
            serialNumber: serie || null,
            acquiredOn: null,
            notes: null,
          },
        }),
      );
      setCode('');
      setNome('');
      setCategoria('');
      setSerie('');
      aoCadastrar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Cadastrar equipamento">
      <form className="formulario" onSubmit={(evento) => void submeter(evento)}>
        <Campo
          rotulo="Código"
          value={code}
          onChange={(evento) => setCode(evento.target.value)}
          required
          dica="Patrimônio. Não se repete na empresa."
        />
        <Campo
          rotulo="Equipamento"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          required
          minLength={2}
        />
        <Campo
          rotulo="Categoria"
          value={categoria}
          onChange={(evento) => setCategoria(evento.target.value)}
          required
          minLength={2}
          placeholder="escavadeira"
        />
        <Campo
          rotulo="Número de série"
          value={serie}
          onChange={(evento) => setSerie(evento.target.value)}
        />
        {erro ? <Aviso>{erro}</Aviso> : null}
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Cadastrando…' : 'Cadastrar'}
        </Botao>
      </form>
    </Cartao>
  );
}
