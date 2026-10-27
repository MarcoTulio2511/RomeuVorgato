import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../src/services/supabase/api';
import { DEFAULT_PREFERENCES, buildSnapshot, type HouseholdData } from '../../src/domain/snapshot';
import { AppError } from '../../src/services/supabase/errors';
import { ANA, account, budget, category, tx } from '../helpers/factories';
import { renderUi } from '../helpers/render';

const TODAY = '2026-03-10';
const state = vi.hoisted(() => ({ data: null as unknown, list: vi.fn(), pierreHistory: vi.fn() }));

vi.mock('../../src/features/household/HouseholdProvider', async () => {
  const { buildSnapshot: build } = await import('../../src/domain/snapshot');
  const make = () => {
    const data = state.data as HouseholdData;
    return {
      phase: 'ready',
      error: null,
      data,
      today: '2026-03-10',
      viewKey: 'joint',
      setViewKey: vi.fn(),
      view: { kind: 'joint' },
      household: { id: 'h1', name: 'Casa', currency: 'BRL', maxMembers: 2, monthlySavingsGoalCents: null },
      me: { id: 'm1', userId: 'user-ana', role: 'admin', displayName: 'Ana', isActive: true },
      members: [{ id: 'm1', userId: 'user-ana', role: 'admin', displayName: 'Ana', isActive: true }],
      partner: null,
      snapshot: build(data, '2026-03-10', { kind: 'joint' }),
      refresh: vi.fn(),
      reloadMembership: vi.fn(),
      nameOf: () => 'Ana',
    };
  };
  return {
    useHousehold: make,
    useReadyHousehold: make,
    HouseholdProvider: ({ children }: { children: unknown }) => children,
  };
});
vi.mock('../../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-ana', email: 'a@b.c' } }),
}));
vi.mock('../../src/services/supabase/api', async (orig) => ({
  ...(await orig<typeof ApiModule>()),
  listTransactions: state.list,
  loadPierreHistory: state.pierreHistory,
  recordPierreMessage: vi.fn().mockResolvedValue(undefined),
}));

import HomePage from '../../src/features/dashboard/HomePage';
import BudgetsPage from '../../src/features/budgets/BudgetsPage';
import TransactionsPage from '../../src/features/transactions/TransactionsPage';
import PierrePage from '../../src/features/pierre/PierrePage';
import AccountsPage from '../../src/features/accounts/AccountsPage';

const empty = (over: Partial<HouseholdData> = {}): HouseholdData => ({
  currentUserId: ANA,
  accounts: [],
  cards: [],
  categories: [],
  transactions: [],
  invoices: [],
  plans: [],
  budgets: [],
  recurring: [],
  planned: [],
  prefs: DEFAULT_PREFERENCES,
  savingsGoalCents: null,
  ...over,
});

beforeEach(() => {
  state.list.mockReset();
  state.pierreHistory.mockReset().mockResolvedValue([]);
  state.data = empty();
});

describe('páginas — estados vazios', () => {
  it('Início sem contas convida a cadastrar (sem números inventados)', () => {
    renderUi(<HomePage />);
    expect(screen.getByText('Olá! Vamos começar?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cadastrar conta' })).toHaveAttribute('href', '/contas');
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it('Contas vazio', () => {
    renderUi(<AccountsPage />);
    expect(screen.getByText('Nenhuma conta ainda')).toBeInTheDocument();
  });

  it('Orçamentos vazio não impõe valores', () => {
    renderUi(<BudgetsPage />);
    expect(screen.getByText('Nenhum orçamento este mês')).toBeInTheDocument();
    expect(screen.getByText(/não sugerimos nenhum/)).toBeInTheDocument();
  });

  it('Movimentações vazio', async () => {
    state.list.mockResolvedValue({ rows: [], count: 0 });
    renderUi(<TransactionsPage />);
    expect(await screen.findByText('Nenhuma movimentação encontrada')).toBeInTheDocument();
  });

  it('Pierre sem dados mostra convite neutro, nunca alerta', async () => {
    renderUi(<PierrePage />);
    expect(await screen.findByText('Vamos começar?')).toBeInTheDocument();
    expect(
      screen.queryByText(/estourou|vencida|acima do padrão|compromissos acima/i),
    ).not.toBeInTheDocument();
  });
});

describe('páginas — erro e carregamento', () => {
  it('Movimentações: falha de rede mostra erro com "tentar de novo"', async () => {
    state.list.mockRejectedValue(
      new AppError('Sem conexão com o servidor. Verifique a internet e tente novamente.', 'network'),
    );
    renderUi(<TransactionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor');
    expect(screen.getByRole('button', { name: /Tentar de novo/ })).toBeInTheDocument();
  });

  it('Movimentações: mostra skeleton enquanto carrega', () => {
    state.list.mockReturnValue(new Promise(() => undefined));
    renderUi(<TransactionsPage />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('Movimentações: lista com valores formatados em pt-BR e paginação quando há muitos', async () => {
    const rows = [
      tx({
        id: 't1',
        type: 'expense',
        amountCents: 123456,
        description: 'Mercado do mês',
        occurredOn: '2026-03-02',
        accountId: 'a1',
        scope: 'shared',
      }),
      tx({
        id: 't2',
        type: 'income',
        amountCents: 500000,
        description: 'Salário',
        occurredOn: '2026-03-05',
        accountId: 'a1',
      }),
    ];
    state.data = empty({ accounts: [account({ id: 'a1', name: 'Corrente' })] });
    state.list.mockResolvedValue({ rows, count: 60 });
    renderUi(<TransactionsPage />);
    expect(await screen.findByText('Mercado do mês')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.234,56')).toBeInTheDocument();
    expect(screen.getByText('Compartilhada')).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 3/)).toBeInTheDocument();
  });
});

describe('páginas — com dados reais do domínio', () => {
  it('Orçamentos explica o valor usado e mostra o restante calculado', () => {
    const cat = category({ id: 'ifood', name: 'iFood' });
    state.data = empty({
      categories: [cat],
      accounts: [account({ id: 'a1' })],
      budgets: [budget({ id: 'b1', categoryId: 'ifood', limitCents: 40000, perOrderLimitCents: 4000 })],
      transactions: [
        tx({
          type: 'expense',
          amountCents: 15000,
          categoryId: 'ifood',
          accountId: 'a1',
          occurredOn: '2026-03-04',
        }),
      ],
    });
    renderUi(<BudgetsPage />);
    expect(screen.getByText('iFood')).toBeInTheDocument();
    expect(screen.getByText('R$ 250,00')).toBeInTheDocument(); // 400 − 150
    expect(screen.getByText(/cabem/)).toHaveTextContent('6'); // 25.000 / 4.000 = 6 pedidos cheios
    expect(
      buildSnapshot(state.data as HouseholdData, TODAY, { kind: 'joint' }).budgetViews[0]!.usage
        .remainingCents,
    ).toBe(25000);
  });

  it('Início mostra dinheiro livre e a mensagem do Pierre vinda das regras', async () => {
    const cat = category({ id: 'lazer', name: 'Lazer' });
    state.data = empty({
      categories: [cat],
      accounts: [account({ id: 'a1', initialBalanceCents: 100000 })],
      budgets: [budget({ id: 'b1', categoryId: 'lazer', limitCents: 10000 })],
      transactions: [
        tx({
          type: 'expense',
          amountCents: 12000,
          categoryId: 'lazer',
          accountId: 'a1',
          occurredOn: '2026-03-04',
        }),
      ],
    });
    renderUi(<HomePage />);
    expect(await screen.findByText('Orçamento de Lazer estourou')).toBeInTheDocument();
    expect(screen.getByText(/passou do limite em R\$ 20,00/)).toBeInTheDocument();
    expect(screen.getByText('Estimativa incompleta')).toBeInTheDocument(); // sem despesas previstas cadastradas
  });
});
