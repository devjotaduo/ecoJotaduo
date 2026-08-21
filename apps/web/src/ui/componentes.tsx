import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/**
 * Componentes de interface do aplicativo.
 *
 * Um arquivo só, sem biblioteca de UI: são meia dúzia de peças e nenhuma
 * delas tem comportamento além de estilo. Vira design system quando houver um
 * segundo aplicativo para compartilhá-lo.
 */

export function Botao({
  variante = 'primario',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'perigo';
}) {
  return <button {...props} className={`botao botao--${variante}`} />;
}

export function Campo({
  rotulo,
  dica,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string;
  dica?: string;
}) {
  return (
    <label className="campo">
      <span className="campo__rotulo">{rotulo}</span>
      <input {...props} className="campo__entrada" />
      {dica ? <span className="campo__dica">{dica}</span> : null}
    </label>
  );
}

export function Selecao({
  rotulo,
  opcoes,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  rotulo: string;
  opcoes: readonly { valor: string; texto: string }[];
}) {
  return (
    <label className="campo">
      <span className="campo__rotulo">{rotulo}</span>
      <select {...props} className="campo__entrada">
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Aviso({
  tipo = 'erro',
  children,
}: {
  tipo?: 'erro' | 'informacao';
  children: ReactNode;
}) {
  return (
    <p
      className={`aviso aviso--${tipo}`}
      role={tipo === 'erro' ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return <span className="etiqueta">{children}</span>;
}

export function Cartao({
  titulo,
  acoes,
  children,
}: {
  titulo: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cartao">
      <header className="cartao__cabecalho">
        <h2>{titulo}</h2>
        {acoes ? <div className="cartao__acoes">{acoes}</div> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Estados de lista.
 *
 * Vazio e erro são telas de primeira classe, não `null`: uma lista que some
 * sem explicação faz a pessoa achar que perdeu dado.
 */
export function Estado({
  carregando,
  erro,
  vazio,
  children,
}: {
  carregando: boolean;
  erro: string | null;
  vazio: boolean;
  children: ReactNode;
}) {
  if (carregando) {
    return <p className="estado">Carregando…</p>;
  }
  if (erro) {
    return <Aviso>{erro}</Aviso>;
  }
  if (vazio) {
    return <p className="estado">Nada por aqui ainda.</p>;
  }
  return <>{children}</>;
}
