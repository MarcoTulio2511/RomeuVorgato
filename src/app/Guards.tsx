import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ErrorState, PageSkeleton } from '../components/ui/primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useHousehold } from '../features/household/HouseholdProvider';
import { SetupRequired } from './SetupRequired';

/** Rotas privadas: sem sessão → login (guardando o destino). */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'unconfigured') return <SetupRequired />;
  if (status === 'loading')
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <PageSkeleton />
      </div>
    );
  if (status === 'signedOut')
    return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Exige pertencer a uma casa; caso contrário, onboarding. */
export function RequireHousehold() {
  const { phase, error, refresh } = useHousehold();
  if (phase === 'loading')
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <PageSkeleton />
      </div>
    );
  if (phase === 'no-household') return <Navigate to="/comecar" replace />;
  if (phase === 'error') {
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: '48px auto' }}>
        <ErrorState message={error ?? 'Erro desconhecido.'} onRetry={() => void refresh()} />
      </div>
    );
  }
  return <AppShell />;
}
