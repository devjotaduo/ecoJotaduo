import {
  ApiError,
  criarClienteDaApi,
  ouFalhar,
  type ClienteDaApi,
} from '@ecojotaduo/api-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { armazenamentoDaAba } from './armazenamento';
import { podeNaInterface } from './permissoes';

export interface Acesso {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly actorId: string;
  readonly permissions: readonly string[];
  readonly entitlements: readonly string[];
}

export interface ContextoDeSessao {
  readonly api: ClienteDaApi;
  readonly acesso: Acesso | null;
  readonly carregando: boolean;
  readonly entrar: (entrada: {
    email: string;
    password: string;
    tenantSlug: string;
  }) => Promise<void>;
  readonly sair: () => Promise<void>;
  /**
   * O papel do usuário concede a permissão E a empresa contratou o módulo.
   *
   * Serve para ESCONDER o que não adianta mostrar — é conveniência de
   * interface, nunca barreira. Quem decide é o servidor, a cada chamada; um
   * botão escondido continua sendo uma rota protegida do outro lado.
   */
  readonly pode: (permissao: string) => boolean;
}

const Contexto = createContext<ContextoDeSessao | null>(null);

export function ProvedorDeSessao({ children }: { children: ReactNode }) {
  const api = useMemo(
    () =>
      criarClienteDaApi({
        // Mesma origem: o proxy do Vite cuida disso em desenvolvimento.
        baseUrl: window.location.origin,
        armazenamento: armazenamentoDaAba(),
      }),
    [],
  );

  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [carregando, setCarregando] = useState(true);

  /** Monta o acesso a partir do servidor — nunca de algo guardado no cliente. */
  const carregarAcesso = useCallback(async (): Promise<Acesso> => {
    const eu = await ouFalhar(api.rotas.GET('/api/v1/auth/me'));
    const empresas = await ouFalhar(api.rotas.GET('/api/v1/auth/my-tenants'));
    const minha = empresas.items.find(
      (empresa) => empresa.tenantId === eu.tenantId,
    );
    return {
      tenantId: eu.tenantId,
      tenantName: minha?.name ?? eu.tenantId,
      actorId: eu.actor.id,
      permissions: eu.permissions,
      entitlements: eu.entitlements,
    };
  }, [api]);

  /**
   * Ao abrir a aba, tenta restaurar a sessão.
   *
   * Não há como perguntar ao cliente se existe sessão: o refresh token está
   * num cookie `httpOnly`, invisível ao JavaScript. Então a tentativa É a
   * pergunta — o `GET` sai sem access token, toma 401, o SDK renova pelo
   * cookie e a chamada é repetida. Se não houver cookie, o 401 é definitivo e
   * a tela mostra o login.
   */
  useEffect(() => {
    let ativo = true;
    carregarAcesso()
      .then((restaurado) => {
        if (ativo) setAcesso(restaurado);
      })
      .catch(() => {
        if (ativo) setAcesso(null);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [api, carregarAcesso]);

  const valor = useMemo<ContextoDeSessao>(
    () => ({
      api,
      acesso,
      carregando,
      entrar: async (entrada) => {
        await api.entrar(entrada);
        setAcesso(await carregarAcesso());
      },
      sair: async () => {
        // O cookie é `httpOnly`: só o servidor consegue apagá-lo, e é ele quem
        // revoga a família de tokens. Sair aqui é uma chamada, não um delete
        // local.
        setAcesso(null);
        await api.sair();
      },
      pode: (permissao) => podeNaInterface(acesso, permissao),
    }),
    [api, acesso, carregando, carregarAcesso],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ContextoDeSessao {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useSessao precisa estar dentro de <ProvedorDeSessao>.');
  }
  return contexto;
}

/** Mensagem de erro para a tela, sem vazar detalhe interno. */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.moduloNaoContratado) {
      return 'Sua empresa não contratou este módulo.';
    }
    if (erro.semPermissao) {
      return 'Você não tem permissão para esta operação.';
    }
    return erro.problema.detail;
  }
  return 'Não foi possível concluir. Tente novamente.';
}
