import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
} from 'react-router-dom';

import { ProvedorDeSessao, useSessao } from './api/sessao';
import { Ativos } from './paginas/Ativos';
import { Cliente, Clientes } from './paginas/Clientes';
import { Contratos } from './paginas/Contratos';
import { Locacoes } from './paginas/Locacoes';
import { Login } from './paginas/Login';
import { Proposta, Propostas } from './paginas/Propostas';
import { Botao } from './ui/componentes';

/**
 * O aplicativo só existe autenticado.
 *
 * Enquanto o acesso está sendo restaurado (o SDK renovando a sessão a partir
 * do refresh token da aba), a tela espera — pular direto para o login
 * derrubaria quem só apertou F5.
 */
function Aplicacao() {
  const { acesso, carregando } = useSessao();

  if (carregando) {
    return <main className="carregando">Carregando…</main>;
  }
  if (!acesso) {
    return <Login />;
  }
  return <Interno />;
}

function Interno() {
  const { acesso, sair, pode } = useSessao();

  return (
    <div className="aplicacao">
      <header className="cabecalho">
        <strong className="marca">ecoJotaduo</strong>
        <nav className="navegacao">
          {/*
            Cada item some quando a empresa não contratou o módulo. É
            conveniência: a rota do servidor continua protegida de qualquer
            forma (ver docs/architecture/security-model.md).
          */}
          {pode('crm.customer.read') ? (
            <NavLink to="/clientes">Clientes</NavLink>
          ) : null}
          {pode('commercial.proposal.read') ? (
            <NavLink to="/propostas">Propostas</NavLink>
          ) : null}
          {pode('contracts.contract.read') ? (
            <NavLink to="/contratos">Contratos</NavLink>
          ) : null}
          {pode('assets.asset.read') ? (
            <NavLink to="/ativos">Ativos</NavLink>
          ) : null}
          {pode('operations.rental.read') ? (
            <NavLink to="/locacoes">Locações</NavLink>
          ) : null}
        </nav>
        <div className="cabecalho__conta">
          <span className="cabecalho__empresa">{acesso?.tenantName}</span>
          <Botao variante="secundario" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </header>

      <Routes>
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/clientes/:customerId" element={<RotaDoCliente />} />
        <Route path="/propostas" element={<Propostas />} />
        <Route path="/propostas/:proposalId" element={<RotaDaProposta />} />
        <Route path="/contratos" element={<Contratos />} />
        <Route path="/ativos" element={<Ativos />} />
        <Route path="/locacoes" element={<Locacoes />} />
        <Route path="*" element={<Navigate to="/clientes" replace />} />
      </Routes>
    </div>
  );
}

function RotaDoCliente() {
  const { customerId } = useParams();
  return customerId ? (
    <Cliente customerId={customerId} />
  ) : (
    <Navigate to="/clientes" replace />
  );
}

function RotaDaProposta() {
  const { proposalId } = useParams();
  return proposalId ? (
    <Proposta proposalId={proposalId} />
  ) : (
    <Navigate to="/propostas" replace />
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProvedorDeSessao>
        <Aplicacao />
      </ProvedorDeSessao>
    </BrowserRouter>
  );
}
