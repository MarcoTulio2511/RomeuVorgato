import { describe, expect, it } from 'vitest';
import { budgetUsage, ordersThatFit } from '../../src/domain/budgets/budgets';
import { spendingEvents } from '../../src/domain/budgets/spending';
import { invoiceStatus, invoiceTotals } from '../../src/domain/invoices/invoices';
import { evaluatePierre, pickHeadline, visibleMessages } from '../../src/domain/pierre/engine';
import { PIERRE_QUESTIONS, answerQuestion } from '../../src/domain/pierre/questions';
import type { BudgetView, InvoiceView, PierreInput } from '../../src/domain/pierre/types';
import type { FreeCashResult } from '../../src/domain/projections/freeCash';
import { budget, category, invoice, planned, tx } from '../helpers/factories';

const TODAY = '2026-03-10';
const base = (over: Partial<PierreInput> = {}): PierreInput => ({
  today: TODAY,
  prefs: { enabled: true, minPeriods: 3, variancePct: 30 },
  budgets: [],
  invoices: [],
  freeCash: null,
  horizon: null,
  nextIncome: null,
  upcomingSubscriptions: [],
  trends: [],
  historyPeriods: 6,
  savings: null,
  hasAnyData: true,
  ...over,
});

function bv(
  name: string,
  limit: number,
  spent: number,
  opts: { perOrder?: number; today?: string; alertPct?: number } = {},
): BudgetView {
  const cat = category({ id: `cat-${name}`, name });
  const b = budget({
    categoryId: cat.id,
    limitCents: limit,
    perOrderLimitCents: opts.perOrder ?? null,
    alertPct: opts.alertPct ?? 80,
  });
  const events =
    spent > 0
      ? spendingEvents(
          [
            tx({
              type: 'expense',
              amountCents: spent,
              categoryId: cat.id,
              accountId: 'a',
              occurredOn: '2026-03-02',
            }),
          ],
          { invoices: [], plans: [], basis: 'competence', installmentPolicy: 'parcel' },
        )
      : [];
  const usage = budgetUsage(b, events, [cat], '2026-03', opts.today ?? TODAY);
  return {
    budget: b,
    categoryName: name,
    usage,
    orders: opts.perOrder ? ordersThatFit(usage.remainingCents, opts.perOrder) : null,
  };
}

function iv(
  name: string,
  opts: { total: number; paid?: number; dueDate: string; cycleEnd: string; today?: string },
): InvoiceView {
  const inv = invoice({ id: `inv-${name}`, dueDate: opts.dueDate, cycleEnd: opts.cycleEnd });
  const txs = [
    tx({ type: 'card_purchase', amountCents: opts.total, invoiceId: inv.id }),
    ...(opts.paid ? [tx({ type: 'invoice_payment', amountCents: opts.paid, invoiceId: inv.id })] : []),
  ];
  const totals = invoiceTotals(inv, txs);
  return { invoice: inv, cardName: name, totals, status: invoiceStatus(inv, totals, opts.today ?? TODAY) };
}

const fc = (over: Partial<FreeCashResult> = {}): FreeCashResult => ({
  today: TODAY,
  horizon: '2026-04-05',
  bankBalanceCents: 100_000,
  confirmedIncomeCents: 0,
  estimatedIncomeCents: 0,
  commitmentsCents: 0,
  commitments: [],
  guaranteedFreeCents: 100_000,
  estimatedFreeCents: 100_000,
  isComplete: true,
  assumptions: [],
  ...over,
});

const ids = (m: ReturnType<typeof evaluatePierre>) => m.map((x) => x.ruleId);

describe('Pierre — orçamentos', () => {
  it('saudável: mensagem tranquila com o valor restante real', () => {
    const [m] = evaluatePierre(base({ budgets: [bv('Lazer', 30_000, 5_000)] }));
    expect(m).toMatchObject({ ruleId: 'budget_healthy', severity: 'positive' });
    expect(m!.body).toBe('Esse mês está tranquilo! Vocês ainda têm R$ 250,00 para lazer.');
  });

  it('próximo do limite: percentual e restante', () => {
    const [m] = evaluatePierre(base({ budgets: [bv('Lazer', 40_000, 33_000)] }));
    expect(m!.ruleId).toBe('budget_near_limit');
    expect(m!.body).toBe('Vocês já usaram 83% do orçamento de Lazer. Ainda restam R$ 70,00.');
  });

  it('excedido: crítico, com o quanto passou', () => {
    const [m] = evaluatePierre(base({ budgets: [bv('Lazer', 40_000, 41_000)] }));
    expect(m).toMatchObject({ ruleId: 'budget_exceeded', severity: 'critical' });
    expect(m!.body).toContain('passou do limite em R$ 10,00');
  });

  it('projeção: avisa que pode acabar antes do fim do mês e NÃO diz "tranquilo" ao mesmo tempo', () => {
    const out = evaluatePierre(base({ budgets: [bv('Compras', 40_000, 15_000)] }));
    expect(ids(out)).toEqual(['budget_projection']);
    expect(out[0]!.body).toContain('pode acabar antes do fim do mês');
  });

  it('sem dias suficientes no mês não há projeção (dados insuficientes) — cai em saudável', () => {
    const early = bv('Compras', 40_000, 15_000, { today: '2026-03-03' });
    expect(ids(evaluatePierre(base({ today: '2026-03-03', budgets: [early] })))).toEqual(['budget_healthy']);
  });

  it('oportunidade: conta pedidos garantidos e a sobra, respeitando o limite por pedido', () => {
    const [m] = evaluatePierre(base({ budgets: [bv('iFood', 40_000, 5_000, { perOrder: 4_000 })] }));
    expect(m!.ruleId).toBe('purchase_opportunity');
    expect(m!.body).toContain('8 pedidos de até R$ 40,00 e mais um menor, de até R$ 30,00');
    // restante (R$ 30,00) menor que o limite por pedido (R$ 40,00): nunca sugere um pedido maior que o saldo
    const few = bv('iFood', 40_000, 37_000, { perOrder: 4_000, alertPct: 100, today: '2026-03-04' });
    const [f] = evaluatePierre(base({ today: '2026-03-04', budgets: [few] }));
    expect(f!.ruleId).toBe('purchase_opportunity');
    expect(f!.body).toContain('dá para um pedido de até R$ 30,00');
  });

  it('uma única mensagem por orçamento (tópico)', () => {
    const out = evaluatePierre(base({ budgets: [bv('A', 10_000, 20_000), bv('B', 10_000, 1_000)] }));
    expect(out.filter((m) => m.topic.startsWith('budget:'))).toHaveLength(2);
    expect(new Set(out.map((m) => m.topic)).size).toBe(out.length);
  });
});

describe('Pierre — faturas, renda e assinaturas', () => {
  it('fatura próxima (fechada): valor em aberto; aberta: valor "previsto"', () => {
    const closed = iv('Visa', { total: 46_000, dueDate: '2026-03-13', cycleEnd: '2026-03-05' });
    const [m] = evaluatePierre(base({ invoices: [closed] }));
    expect(m).toMatchObject({ ruleId: 'invoice_due_soon', severity: 'warning' });
    expect(m!.body).toBe('A fatura do Visa vence em 13/03. O valor em aberto é R$ 460,00.');
    const open = iv('Visa', { total: 46_000, dueDate: '2026-03-18', cycleEnd: '2026-03-14' });
    const [o] = evaluatePierre(base({ invoices: [open] }));
    expect(o!.body).toContain('O valor previsto é R$ 460,00');
  });

  it('vencida: crítica e menciona pagamento parcial sem dar a fatura como quitada', () => {
    const late = iv('Visa', { total: 46_000, paid: 10_000, dueDate: '2026-03-05', cycleEnd: '2026-02-24' });
    const out = evaluatePierre(base({ invoices: [late] }));
    expect(out[0]).toMatchObject({ ruleId: 'invoice_overdue', severity: 'critical', priority: 100 });
    expect(out[0]!.body).toContain('ainda há R$ 360,00 em aberto');
    expect(out[0]!.body).toContain('já foram pagos R$ 100,00');
    expect(ids(out)).not.toContain('invoice_due_soon');
  });

  it('fatura sem saldo (paga) não gera mensagem; fatura distante também não', () => {
    const paid = iv('Visa', { total: 46_000, paid: 46_000, dueDate: '2026-03-13', cycleEnd: '2026-03-05' });
    const far = iv('Master', { total: 5_000, dueDate: '2026-04-20', cycleEnd: '2026-04-10' });
    expect(ids(evaluatePierre(base({ invoices: [paid, far] })))).toEqual(['neutral']);
  });

  it('salário próximo (e estimado é identificado como estimativa)', () => {
    const certain = planned({
      type: 'income',
      description: 'Salário',
      amountCents: 500_000,
      dueDate: '2026-03-12',
      isCertain: true,
    });
    const [m] = evaluatePierre(base({ nextIncome: certain }));
    expect(m!.ruleId).toBe('salary_soon');
    expect(m!.body).toContain('previsto para 12/03 (em 2 dias)');
    expect(m!.body).not.toContain('estimado');
    const est = planned({
      type: 'income',
      description: 'Freela',
      amountCents: 100_000,
      dueDate: '2026-03-11',
      isCertain: false,
    });
    expect(evaluatePierre(base({ nextIncome: est }))[0]!.body).toContain('valor estimado');
    expect(
      ids(evaluatePierre(base({ nextIncome: planned({ type: 'income', dueDate: '2026-03-30' }) }))),
    ).toEqual(['neutral']);
  });

  it('assinatura próxima', () => {
    const sub = planned({
      description: 'Netflix',
      amountCents: 3_990,
      dueDate: '2026-03-12',
      isSubscription: true,
    });
    const [m] = evaluatePierre(base({ upcomingSubscriptions: [sub] }));
    expect(m!.body).toBe('A assinatura Netflix (R$ 39,90) está prevista para 12/03.');
  });
});

describe('Pierre — dinheiro livre, histórico e metas', () => {
  it('dinheiro livre insuficiente: crítico e suprime mensagens positivas de gasto', () => {
    const out = evaluatePierre(
      base({
        budgets: [bv('Lazer', 30_000, 1_000)],
        freeCash: fc({ guaranteedFreeCents: -25_000, commitmentsCents: 125_000 }),
      }),
    );
    expect(ids(out)).toEqual(['cash_shortfall']);
    expect(out[0]!.body).toContain('superam o dinheiro disponível em R$ 250,00');
  });

  it('com dinheiro livre suficiente nenhuma mensagem de falta é emitida', () => {
    expect(ids(evaluatePierre(base({ freeCash: fc() })))).not.toContain('cash_shortfall');
  });

  it('gasto acima do padrão só com histórico mínimo configurável', () => {
    const trend = (periods: number) => ({
      categoryId: 'm',
      name: 'Mercado',
      currentSpentCents: 30_000,
      averagePastCents: 50_000,
      periods,
    });
    const ok = evaluatePierre(base({ trends: [trend(3)], historyPeriods: 3 }));
    expect(ids(ok)).toContain('spending_above_pattern');
    expect(ok[0]!.body).toContain('média dos últimos 3 meses');
    const few = evaluatePierre(base({ trends: [trend(2)], historyPeriods: 2 }));
    expect(ids(few)).toEqual(['history_insufficient']);
    expect(few[0]!.body).toContain('pelo menos 3 meses');
    // limite configurável
    expect(
      ids(
        evaluatePierre(
          base({
            trends: [trend(2)],
            historyPeriods: 2,
            prefs: { enabled: true, minPeriods: 2, variancePct: 30 },
          }),
        ),
      ),
    ).toContain('spending_above_pattern');
  });

  it('não alerta dentro da tolerância, em início de mês, nem por valores pequenos', () => {
    const t = { categoryId: 'm', name: 'Mercado', averagePastCents: 50_000, periods: 4 };
    expect(
      ids(evaluatePierre(base({ trends: [{ ...t, currentSpentCents: 17_000 }], historyPeriods: 4 }))),
    ).not.toContain('spending_above_pattern');
    expect(
      ids(
        evaluatePierre(
          base({ today: '2026-03-03', trends: [{ ...t, currentSpentCents: 90_000 }], historyPeriods: 4 }),
        ),
      ),
    ).not.toContain('spending_above_pattern');
    expect(
      ids(
        evaluatePierre(
          base({ trends: [{ ...t, averagePastCents: 1_000, currentSpentCents: 4_000 }], historyPeriods: 4 }),
        ),
      ),
    ).not.toContain('spending_above_pattern');
  });

  it('meta de economia: atingida / em risco no fim do mês / silêncio no começo', () => {
    expect(ids(evaluatePierre(base({ savings: { goalCents: 100_000, savedCents: 120_000 } })))).toEqual([
      'savings_goal_reached',
    ]);
    const risk = evaluatePierre(
      base({ today: '2026-03-25', savings: { goalCents: 300_000, savedCents: 100_000 } }),
    );
    expect(risk[0]!.ruleId).toBe('savings_goal_at_risk');
    expect(risk[0]!.body).toContain('Faltam R$ 2.000,00 e restam 6 dias');
    expect(ids(evaluatePierre(base({ savings: { goalCents: 300_000, savedCents: 100_000 } })))).toEqual([
      'neutral',
    ]);
  });

  it('desligado = silêncio; sem dados = convite neutro, nunca alerta', () => {
    expect(
      evaluatePierre(
        base({ prefs: { enabled: false, minPeriods: 3, variancePct: 30 }, budgets: [bv('Lazer', 100, 500)] }),
      ),
    ).toEqual([]);
    const [m] = evaluatePierre(base({ hasAnyData: false }));
    expect(m).toMatchObject({ ruleId: 'neutral', severity: 'info', title: 'Vamos começar?' });
  });

  it('ordena por prioridade: vencida > falta de caixa > estourado > ...', () => {
    const out = evaluatePierre(
      base({
        invoices: [iv('Visa', { total: 10_000, dueDate: '2026-03-01', cycleEnd: '2026-02-20' })],
        freeCash: fc({ guaranteedFreeCents: -1 }),
        budgets: [bv('Lazer', 10_000, 20_000), bv('Mercado', 100_000, 10_000)],
      }),
    );
    expect(ids(out).slice(0, 3)).toEqual(['invoice_overdue', 'cash_shortfall', 'budget_exceeded']);
  });
});

describe('Pierre — frequência e deduplicação', () => {
  const nowMs = Date.parse('2026-03-10T12:00:00Z');
  const msgs = evaluatePierre(
    base({ budgets: [bv('Lazer', 40_000, 33_000), bv('Mercado', 100_000, 10_000)] }),
  );

  it('chaves incluem o período e são únicas', () => {
    expect(msgs[0]!.dedupeKey).toMatch(/:2026-03$/);
    expect(new Set(msgs.map((m) => m.dedupeKey)).size).toBe(msgs.length);
  });

  it('dispensada ou adiada não aparece; adiamento expira', () => {
    const key = msgs[0]!.dedupeKey;
    expect(
      visibleMessages(msgs, { [key]: { dismissedAt: '2026-03-10T00:00:00Z' } }, nowMs).map(
        (m) => m.dedupeKey,
      ),
    ).not.toContain(key);
    expect(visibleMessages(msgs, { [key]: { snoozedUntil: '2026-03-11T00:00:00Z' } }, nowMs)).toHaveLength(
      msgs.length - 1,
    );
    expect(visibleMessages(msgs, { [key]: { snoozedUntil: '2026-03-09T00:00:00Z' } }, nowMs)).toHaveLength(
      msgs.length,
    );
  });

  it('destaque respeita o período de espera, mas nunca fica mudo', () => {
    expect(pickHeadline(msgs, {}, nowMs)).toBe(msgs[0]);
    const recent = { [msgs[0]!.dedupeKey]: { lastShownAt: '2026-03-10T10:00:00Z' } }; // aviso: espera de 12h
    expect(pickHeadline(msgs, recent, nowMs)).toBe(msgs[1]);
    const all = Object.fromEntries(msgs.map((m) => [m.dedupeKey, { lastShownAt: '2026-03-10T11:59:00Z' }]));
    expect(pickHeadline(msgs, all, nowMs)).toBe(msgs[0]);
    const dismissedAll = Object.fromEntries(
      msgs.map((m) => [m.dedupeKey, { dismissedAt: '2026-03-10T00:00:00Z' }]),
    );
    expect(pickHeadline(msgs, dismissedAll, nowMs)).toBeNull();
  });

  it('críticas ignoram o período de espera', () => {
    const crit = evaluatePierre(base({ budgets: [bv('Lazer', 10_000, 20_000)] }));
    const recent = { [crit[0]!.dedupeKey]: { lastShownAt: '2026-03-10T11:59:00Z' } };
    expect(pickHeadline(crit, recent, nowMs)).toBe(crit[0]);
  });
});

describe('Pierre — perguntas determinísticas', () => {
  it('lista as perguntas predefinidas', () => {
    expect(PIERRE_QUESTIONS.map((q) => q.label)).toContain('Posso pedir iFood hoje?');
    expect(PIERRE_QUESTIONS.map((q) => q.label)).toContain('Quanto ainda posso gastar?');
  });

  it('"Posso pedir iFood hoje?" → sim com valor máximo, regra e dinheiro livre usados', () => {
    const a = answerQuestion(
      'can_order',
      base({ budgets: [bv('iFood', 40_000, 10_000, { perOrder: 4_000 })], freeCash: fc() }),
    );
    expect(a.verdict).toBe('yes');
    expect(a.headline).toBe('Pode! Até R$ 40,00 neste pedido.');
    expect(a.rule).toMatch(/Pode pedir se/);
    expect(a.values.map((v) => v.label)).toEqual(
      expect.arrayContaining(['Restante no orçamento', 'Limite por pedido']),
    );
  });

  it('→ não quando o orçamento acabou ou o dinheiro livre não cobre; cuidado quando o ritmo estoura', () => {
    expect(
      answerQuestion('can_order', base({ budgets: [bv('iFood', 40_000, 40_000, { perOrder: 4_000 })] }))
        .verdict,
    ).toBe('no');
    expect(
      answerQuestion(
        'can_order',
        base({
          budgets: [bv('iFood', 40_000, 10_000, { perOrder: 4_000 })],
          freeCash: fc({ guaranteedFreeCents: 1_000 }),
        }),
      ).verdict,
    ).toBe('no');
    expect(
      answerQuestion(
        'can_order',
        base({ budgets: [bv('iFood', 40_000, 15_000, { perOrder: 4_000 })], freeCash: fc() }),
      ).verdict,
    ).toBe('caution');
  });

  it('sem orçamento de delivery não inventa resposta', () => {
    const a = answerQuestion('can_order', base({ budgets: [bv('Lazer', 100, 1)] }));
    expect(a.verdict).toBe('info');
    expect(a.headline).toMatch(/ainda não têm um orçamento/);
  });

  it('"Quanto ainda posso gastar?" mostra o cálculo, compromissos e média diária', () => {
    const commitments = [
      {
        kind: 'invoice' as const,
        label: 'Fatura Visa',
        dueDate: '2026-04-05',
        amountCents: 50_000,
        refId: 'i',
      },
    ];
    const a = answerQuestion(
      'how_much',
      base({ freeCash: fc({ guaranteedFreeCents: 260_000, commitments, commitmentsCents: 50_000 }) }),
    );
    expect(a.headline).toBe('Até R$ 2.600,00 até 05/04.');
    expect(a.considered).toEqual([{ label: 'Fatura Visa', dueDate: '2026-04-05', cents: 50_000 }]);
    expect(a.notes.join(' ')).toContain('R$ 100,00 por dia em 26 dias');
    const bad = answerQuestion('how_much', base({ freeCash: fc({ guaranteedFreeCents: -5_000 }) }));
    expect(bad.verdict).toBe('no');
    expect(bad.headline).toContain('faltam R$ 50,00');
    const incomplete = answerQuestion('how_much', base({ freeCash: fc({ isComplete: false }) }));
    expect(incomplete.headline).toMatch(/Estimativa incompleta/);
    expect(answerQuestion('how_much', base()).verdict).toBe('info');
  });
});
