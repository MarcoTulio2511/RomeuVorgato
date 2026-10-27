import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { ToastProvider } from '../components/feedback/Toast';
import { PageSkeleton } from '../components/ui/primitives';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '../features/auth/AuthPages';
import { HouseholdProvider } from '../features/household/HouseholdProvider';
import { OnboardingPage } from '../features/household/OnboardingPage';
import { GlobalStyle } from '../styles/GlobalStyle';
import { theme } from '../styles/theme';
import { RequireAuth, RequireHousehold } from './Guards';

const HomePage = lazy(() => import('../features/dashboard/HomePage'));
const TransactionsPage = lazy(() => import('../features/transactions/TransactionsPage'));
const AccountsPage = lazy(() => import('../features/accounts/AccountsPage'));
const CardsPage = lazy(() => import('../features/cards/CardsPage'));
const BudgetsPage = lazy(() => import('../features/budgets/BudgetsPage'));
const PlanningPage = lazy(() => import('../features/planning/PlanningPage'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));
const ImportPage = lazy(() => import('../features/imports/ImportPage'));
const PierrePage = lazy(() => import('../features/pierre/PierrePage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

export function AppRoutes() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/convite" element={<OnboardingPage />} />
          <Route path="/comecar" element={<OnboardingPage />} />
          <Route element={<RequireHousehold />}>
            <Route index element={<HomePage />} />
            <Route path="movimentacoes" element={<TransactionsPage />} />
            <Route path="contas" element={<AccountsPage />} />
            <Route path="cartoes" element={<CardsPage />} />
            <Route path="orcamentos" element={<BudgetsPage />} />
            <Route path="planejamento" element={<PlanningPage />} />
            <Route path="relatorios" element={<ReportsPage />} />
            <Route path="importar" element={<ImportPage />} />
            <Route path="pierre" element={<PierrePage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <ToastProvider>
        <AuthProvider>
          <HouseholdProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </HouseholdProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
