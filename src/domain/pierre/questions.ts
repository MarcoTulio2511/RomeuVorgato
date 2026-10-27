import { diffDays, formatDayMonthBR } from '../dates';
import { formatBRL } from '../money/money';
import type { PierreAnswer, PierreInput } from './types';

export type PierreQuestionId = 'can_order' | 'how_much' | 'commitments' | 'budgets';

export const PIERRE_QUESTIONS: Array<{ id: PierreQuestionId; label: string }> = [
  { id: 'can_order', label: 'Posso pedir iFood hoje?' },
  { id: 'how_much', label: 'Quanto ainda posso gastar?' },
  { id: 'commitments', label: 'Quais são os próximos compromissos?' },
  { id: 'budgets', label: 'Como estão os orçamentos?' },
];

const noData = (question: string, headline: string, notes: string[] = []): PierreAnswer => ({
  question,
  verdict: 'info',
  headline,
  rule: 'Sem dados suficientes para calcular.',
  values: [],
  considered: [],
  notes,
});

/**
 * Perguntas pré-definidas = consultas determinísticas ao snapshot. Cada resposta mostra a regra aplicada,
 * os valores calculados e os compromissos considerados. Não há modelo de linguagem.
 */
export function answerQuestion(id: PierreQuestionId, input: PierreInput): PierreAnswer {
  switch (id) {
    case 'can_order':
      return canOrder(input);
    case 'how_much':
      return howMuch(input);
    case 'commitments':
      return commitments(input);
    case 'budgets':
      return budgets(input);
  }
}

function canOrder(i: PierreInput): PierreAnswer {
  const q = 'Posso pedir iFood hoje?';
  const view = i.budgets.find((b) => /ifood|delivery/i.test(b.categoryName)) ?? null;
  if (!view) {
    return noData(q, 'Vocês ainda não têm um orçamento de iFood/delivery.', [
      'Crie um orçamento para essa categoria em Orçamentos e eu respondo com base nele.',
    ]);
  }
  const { usage, budget } = view;
  const perOrder = budget.perOrderLimitCents;
  const nextMax = view.orders?.nextOrderMaxCents ?? Math.max(0, usage.remainingCents);
  const values = [
    { label: 'Limite do mês', cents: usage.limitCents },
    { label: 'Já usado', cents: usage.spentCents },
    { label: 'Restante no orçamento', cents: usage.remainingCents },
    ...(perOrder ? [{ label: 'Limite por pedido', cents: perOrder }] : []),
  ];
  const considered = i.freeCash
    ? i.freeCash.commitments
        .slice(0, 5)
        .map((c) => ({ label: c.label, dueDate: c.dueDate, cents: c.amountCents }))
    : [];
  const rule =
    'Pode pedir se (1) o orçamento tem saldo, (2) o dinheiro livre garantido até o próximo salário cobre o pedido e (3) o ritmo do mês não estoura o limite.';
  const notes: string[] = [];

  if (usage.remainingCents <= 0) {
    return {
      question: q,
      verdict: 'no',
      headline: 'Melhor não: o orçamento de delivery do mês já acabou.',
      rule,
      values,
      considered,
      notes,
    };
  }
  if (i.freeCash && i.freeCash.guaranteedFreeCents < nextMax) {
    values.push({
      label: `Dinheiro livre até ${formatDayMonthBR(i.freeCash.horizon)}`,
      cents: i.freeCash.guaranteedFreeCents,
    });
    return {
      question: q,
      verdict: 'no',
      headline: 'Melhor esperar: os compromissos até o próximo salário não deixam folga para isso.',
      rule,
      values,
      considered,
      notes,
    };
  }
  if (i.freeCash)
    values.push({
      label: `Dinheiro livre até ${formatDayMonthBR(i.freeCash.horizon)}`,
      cents: i.freeCash.guaranteedFreeCents,
    });
  if (!i.freeCash) notes.push('Sem previsão de caixa: considerei apenas o orçamento.');
  if (usage.willExceed) {
    notes.push('Pelo ritmo atual, o orçamento pode acabar antes do fim do mês.');
    return {
      question: q,
      verdict: 'caution',
      headline: `Pode, com cuidado: até ${formatBRL(nextMax)} neste pedido.`,
      rule,
      values,
      considered,
      notes,
    };
  }
  return {
    question: q,
    verdict: 'yes',
    headline: `Pode! Até ${formatBRL(nextMax)} neste pedido.`,
    rule,
    values,
    considered,
    notes,
  };
}

function howMuch(i: PierreInput): PierreAnswer {
  const q = 'Quanto ainda posso gastar?';
  const fc = i.freeCash;
  if (!fc) return noData(q, 'Ainda não consigo calcular: cadastre uma conta para começar.');
  const days = Math.max(1, diffDays(fc.horizon, fc.today));
  const until = formatDayMonthBR(fc.horizon);
  const values = [
    { label: 'Saldo das contas (visão conjunta)', cents: fc.bankBalanceCents },
    { label: 'Receitas confirmadas até lá', cents: fc.confirmedIncomeCents },
    { label: 'Compromissos até lá', cents: -fc.commitmentsCents },
    { label: 'Dinheiro livre garantido', cents: fc.guaranteedFreeCents },
  ];
  if (fc.estimatedIncomeCents > 0)
    values.push({ label: 'Com receitas estimadas', cents: fc.estimatedFreeCents });
  const considered = fc.commitments.map((c) => ({
    label: c.label,
    dueDate: c.dueDate,
    cents: c.amountCents,
  }));
  const notes = [...fc.assumptions];
  const rule = `Dinheiro livre = saldo das contas + receitas confirmadas até ${until} − faturas e despesas previstas até ${until}.`;
  if (fc.guaranteedFreeCents <= 0) {
    return {
      question: q,
      verdict: 'no',
      headline: `Até ${until} não há folga garantida${fc.guaranteedFreeCents < 0 ? `: faltam ${formatBRL(-fc.guaranteedFreeCents)}` : ''}.`,
      rule,
      values,
      considered,
      notes,
    };
  }
  const perDay = Math.floor(fc.guaranteedFreeCents / days);
  notes.push(
    `Média de ${formatBRL(perDay)} por dia em ${days} ${days === 1 ? 'dia' : 'dias'} (divisão simples, sem considerar variações).`,
  );
  return {
    question: q,
    verdict: fc.isComplete ? 'yes' : 'caution',
    headline: `${fc.isComplete ? 'Até' : 'Estimativa incompleta: até'} ${formatBRL(fc.guaranteedFreeCents)} até ${until}.`,
    rule,
    values,
    considered,
    notes,
  };
}

function commitments(i: PierreInput): PierreAnswer {
  const q = 'Quais são os próximos compromissos?';
  const fc = i.freeCash;
  if (!fc || fc.commitments.length === 0) {
    return noData(q, 'Não há compromissos cadastrados até o próximo salário.', [
      'Cadastre contas recorrentes em Planejamento para eu acompanhar.',
    ]);
  }
  const considered = fc.commitments.map((c) => ({
    label: c.label,
    dueDate: c.dueDate,
    cents: c.amountCents,
  }));
  return {
    question: q,
    verdict: 'info',
    headline: `${considered.length} ${considered.length === 1 ? 'compromisso' : 'compromissos'} até ${formatDayMonthBR(fc.horizon)}, somando ${formatBRL(fc.commitmentsCents)}.`,
    rule: 'Faturas em aberto e despesas previstas ainda não efetivadas, até o próximo salário (ou fim do mês).',
    values: [{ label: 'Total', cents: fc.commitmentsCents }],
    considered,
    notes: [],
  };
}

function budgets(i: PierreInput): PierreAnswer {
  const q = 'Como estão os orçamentos?';
  if (i.budgets.length === 0)
    return noData(q, 'Vocês ainda não definiram orçamentos.', [
      'Crie orçamentos em Orçamentos para acompanhar o mês.',
    ]);
  // mais apertado = maior spent/limit (comparação por produto cruzado, sem divisão)
  const worst = [...i.budgets].sort(
    (a, b) => b.usage.spentCents * a.usage.limitCents - a.usage.spentCents * b.usage.limitCents,
  )[0]!;
  return {
    question: q,
    verdict: i.budgets.some((b) => b.usage.status === 'exceeded')
      ? 'no'
      : i.budgets.some((b) => b.usage.status === 'warning' || b.usage.willExceed)
        ? 'caution'
        : 'yes',
    headline: `O mais apertado é ${worst.categoryName}: restam ${formatBRL(Math.max(0, worst.usage.remainingCents))} de ${formatBRL(worst.usage.limitCents)}.`,
    rule: 'Restante = limite do mês − gasto líquido da categoria (estornos descontados), pela base de cada orçamento.',
    values: i.budgets.map((b) => ({ label: `${b.categoryName} — restante`, cents: b.usage.remainingCents })),
    considered: [],
    notes: [],
  };
}
