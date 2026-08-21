import { useState, type FormEvent } from 'react';

import { mensagemDeErro, useSessao } from '../api/sessao';
import { Aviso, Botao, Campo } from '../ui/componentes';

/**
 * Entrada na plataforma.
 *
 * Pede a empresa junto com as credenciais porque o token É de uma empresa: o
 * `tenantId` viaja como claim, nunca como parâmetro de rota (ADR-0002). Uma
 * pessoa com vínculo em duas empresas entra em uma de cada vez.
 */
export function Login() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar({ email, password: senha, tenantSlug: empresa });
    } catch (falha) {
      // O servidor devolve a MESMA mensagem para senha errada, usuário
      // inexistente e empresa inexistente. A tela não tenta adivinhar qual foi.
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <form
        className="login__caixa"
        onSubmit={(evento) => void submeter(evento)}
      >
        <h1>ecoJotaduo</h1>
        <p className="login__subtitulo">Entre na sua empresa</p>

        <Campo
          rotulo="Empresa"
          name="tenantSlug"
          value={empresa}
          onChange={(evento) => setEmpresa(evento.target.value)}
          placeholder="demo"
          autoComplete="organization"
          required
        />
        <Campo
          rotulo="E-mail"
          name="email"
          type="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          autoComplete="username"
          required
        />
        <Campo
          rotulo="Senha"
          name="password"
          type="password"
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          autoComplete="current-password"
          required
        />

        {erro ? <Aviso>{erro}</Aviso> : null}

        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>
    </main>
  );
}
