import type { AccountType, Transaction, TxType } from '../../domain/types';
import { accountSign } from '../../domain/transactions/balances';

export const TX_LABEL: Record<TxType, string> = {
  income: 'Receita',
  expense: 'Despesa',
  refund: 'Estorno',
  transfer_out: 'Transferência enviada',
  transfer_in: 'Transferência recebida',
  card_purchase: 'Compra no cartão',
  card_refund: 'Estorno no cartão',
  card_fee: 'Encargos do cartão',
  invoice_payment: 'Pagamento de fatura',
  adjustment_in: 'Ajuste (+)',
  adjustment_out: 'Ajuste (−)',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro em espécie',
  digital_wallet: 'Carteira digital',
};

/** Sentido visual do valor na lista: entra (+), sai (−) ou neutro (cartão: obrigação, não mexe na conta). */
export function displaySign(t: Transaction): 1 | -1 | 0 {
  const s = accountSign(t.type);
  if (s !== 0) return t.type.startsWith('transfer') ? 0 : s;
  return t.type === 'card_refund' ? 1 : -1;
}

export const FREQ_LABEL = {
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  yearly: 'Anual',
} as const;
export const WEEKEND_LABEL = {
  none: 'Manter a data',
  previous_business_day: 'Antecipar para dia útil anterior',
  next_business_day: 'Adiar para próximo dia útil',
} as const;
