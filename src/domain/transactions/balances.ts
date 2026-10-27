import { compareISO, type ISODate } from '../dates';
import { assertCents, type Cents } from '../money/money';
import type { Account, Scope, Transaction, TxType } from '../types';

/** Efeito de cada tipo no saldo da CONTA bancária. Cartão (compra/estorno/encargo) nunca mexe na conta. */
const ACCOUNT_SIGN: Record<TxType, 1 | -1 | 0> = {
  income: 1,
  refund: 1,
  transfer_in: 1,
  adjustment_in: 1,
  expense: -1,
  transfer_out: -1,
  adjustment_out: -1,
  invoice_payment: -1,
  card_purchase: 0,
  card_refund: 0,
  card_fee: 0,
};

export function accountSign(type: TxType): 1 | -1 | 0 {
  return ACCOUNT_SIGN[type];
}

export function isTransferType(type: TxType): boolean {
  return type === 'transfer_in' || type === 'transfer_out';
}

/**
 * Saldo da conta em `asOf` (inclusive):
 *   saldo inicial (válido no início de `balanceDate`)
 *   + receitas + estornos + transferências recebidas + ajustes positivos
 *   − despesas − transferências enviadas − pagamentos de fatura − ajustes negativos.
 * Só lançamentos efetivados (`posted`), da própria conta, de `balanceDate` em diante.
 */
export function accountBalance(account: Account, txs: readonly Transaction[], asOf: ISODate): Cents {
  let balance = assertCents(account.initialBalanceCents);
  for (const t of txs) {
    if (t.accountId !== account.id || t.status !== 'posted') continue;
    if (compareISO(t.occurredOn, account.balanceDate) < 0) continue; // não altera retroativamente o saldo-base
    if (compareISO(t.occurredOn, asOf) > 0) continue;
    balance += accountSign(t.type) * assertCents(t.amountCents);
  }
  return assertCents(balance, 'saldo');
}

export interface AccountBalance {
  account: Account;
  balanceCents: Cents;
}

export function accountBalances(
  accounts: readonly Account[],
  txs: readonly Transaction[],
  asOf: ISODate,
): AccountBalance[] {
  return accounts.map((account) => ({ account, balanceCents: accountBalance(account, txs, asOf) }));
}

/** Soma só contas ativas marcadas para a visão conjunta. Limites de cartão jamais entram aqui. */
export function consolidatedBalance(
  accounts: readonly Account[],
  txs: readonly Transaction[],
  asOf: ISODate,
): Cents {
  let total = 0;
  for (const a of accounts) {
    if (!a.isActive || !a.includeInConsolidated) continue;
    total += accountBalance(a, txs, asOf);
  }
  return assertCents(total, 'saldo consolidado');
}

export type ViewMode = { kind: 'joint' } | { kind: 'person'; userId: string };

export function filterByView(txs: readonly Transaction[], view: ViewMode): Transaction[] {
  if (view.kind === 'joint') return [...txs];
  return txs.filter((t) => t.ownerId === view.userId);
}

export interface PeriodTotals {
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
}

/**
 * Receita × despesa de consumo no período. Transferências internas e pagamento de fatura NÃO entram
 * (a despesa já foi contada na compra do cartão). Estornos reduzem a despesa. Ajustes ficam de fora.
 * Despesa compartilhada é UMA linha — a visão conjunta nunca a duplica.
 */
export function periodTotals(
  txs: readonly Transaction[],
  from: ISODate,
  to: ISODate,
  scope?: Scope,
): PeriodTotals {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.status !== 'posted') continue;
    if (compareISO(t.occurredOn, from) < 0 || compareISO(t.occurredOn, to) > 0) continue;
    if (scope && t.scope !== scope) continue;
    switch (t.type) {
      case 'income':
        income += t.amountCents;
        break;
      case 'expense':
      case 'card_purchase':
      case 'card_fee':
        expense += t.amountCents;
        break;
      case 'refund':
      case 'card_refund':
        expense -= t.amountCents;
        break;
      default:
        break;
    }
  }
  return { incomeCents: assertCents(income), expenseCents: assertCents(expense), netCents: income - expense };
}

/** Dinheiro que de fato entrou/saiu das contas (base caixa). Compra no cartão só sai no pagamento da fatura. */
export function cashFlowTotals(txs: readonly Transaction[], from: ISODate, to: ISODate) {
  let inflow = 0;
  let outflow = 0;
  for (const t of txs) {
    if (t.status !== 'posted') continue;
    if (compareISO(t.occurredOn, from) < 0 || compareISO(t.occurredOn, to) > 0) continue;
    if (isTransferType(t.type)) continue; // movimento interno
    if (t.type === 'income' || t.type === 'refund') inflow += t.amountCents;
    else if (t.type === 'expense' || t.type === 'invoice_payment') outflow += t.amountCents;
  }
  return { inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow };
}
