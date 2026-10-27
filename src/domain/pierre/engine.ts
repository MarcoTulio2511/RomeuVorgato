import { diffDays, formatDayMonthBR, formatMonthLabel, monthKey } from '../dates';
import { formatBRL } from '../money/money';
import type { MessageHistory, PierreInput, PierreMessage, Severity } from './types';

const COOLDOWN_HOURS: Record<Severity, number> = { critical: 0, warning: 12, info: 48, positive: 72 };

function msg(
  m: Omit<PierreMessage, 'cooldownHours' | 'data'> & { data?: Record<string, unknown> },
): PierreMessage {
  return { data: {}, ...m, cooldownHours: COOLDOWN_HOURS[m.severity] };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Motor determinístico do Pierre: recebe métricas JÁ CALCULADAS e devolve mensagens. Sem IA, sem rede,
 * sem relógio interno (o "hoje" vem no input). Regras:
 *  - cada regra só dispara com evidência nos dados (nunca inventa valor nem diz que algo está pago);
 *  - regras do mesmo `topic` competem: sobrevive a de maior prioridade (evita mensagens contraditórias);
 *  - quando os compromissos superam o dinheiro livre, mensagens "positivas" de gasto são suprimidas;
 *  - análises históricas exigem `prefs.minPeriods` meses comparáveis.
 */
export function evaluatePierre(input: PierreInput): PierreMessage[] {
  if (!input.prefs.enabled) return [];
  const all: PierreMessage[] = [
    ...budgetRules(input),
    ...invoiceRules(input),
    ...cashRules(input),
    ...incomeRules(input),
    ...subscriptionRules(input),
    ...trendRules(input),
    ...savingsRules(input),
  ];

  const cashBlocked = all.some((m) => m.ruleId === 'cash_shortfall');
  const kept = new Map<string, PierreMessage>();
  for (const m of all) {
    if (
      cashBlocked &&
      m.severity === 'positive' &&
      (m.ruleId === 'budget_healthy' || m.ruleId === 'purchase_opportunity')
    )
      continue;
    const current = kept.get(m.topic);
    if (!current || m.priority > current.priority) kept.set(m.topic, m);
  }

  const out = [...kept.values()].sort(
    (a, b) => b.priority - a.priority || a.dedupeKey.localeCompare(b.dedupeKey),
  );
  if (out.length === 0) {
    return [
      msg({
        ruleId: 'neutral',
        topic: 'neutral',
        dedupeKey: `neutral:${monthKey(input.today)}`,
        severity: 'info',
        priority: 1,
        title: input.hasAnyData ? 'Tudo em ordem por enquanto' : 'Vamos começar?',
        body: input.hasAnyData
          ? 'Não encontrei nada que precise da sua atenção agora. Crie orçamentos e compromissos futuros para eu acompanhar melhor.'
          : 'Cadastre uma conta e alguns lançamentos para eu começar a acompanhar a vida financeira de vocês.',
      }),
    ];
  }
  return out;
}

function budgetRules(i: PierreInput): PierreMessage[] {
  const out: PierreMessage[] = [];
  const month = monthKey(i.today);
  for (const v of i.budgets) {
    const { usage, budget, categoryName: name } = v;
    const base = { topic: `budget:${budget.id}`, dedupeKey: '' };
    const usedPct = pct(usage.spentCents, usage.limitCents);
    const data = {
      budgetId: budget.id,
      spentCents: usage.spentCents,
      limitCents: usage.limitCents,
      remainingCents: usage.remainingCents,
    };

    if (usage.status === 'exceeded') {
      out.push(
        msg({
          ...base,
          ruleId: 'budget_exceeded',
          dedupeKey: `budget_exceeded:${budget.id}:${month}`,
          severity: 'critical',
          priority: 90,
          title: `Orçamento de ${name} estourou`,
          body: `O orçamento de ${name} passou do limite em ${formatBRL(usage.overCents)} (${formatBRL(usage.spentCents)} de ${formatBRL(usage.limitCents)}).`,
          data,
        }),
      );
    } else if (usage.status === 'warning') {
      out.push(
        msg({
          ...base,
          ruleId: 'budget_near_limit',
          dedupeKey: `budget_near_limit:${budget.id}:${month}`,
          severity: 'warning',
          priority: 70,
          title: `${name} perto do limite`,
          body: `Vocês já usaram ${usedPct}% do orçamento de ${name}. Ainda restam ${formatBRL(usage.remainingCents)}.`,
          data,
        }),
      );
    } else if (usage.willExceed && usage.projectedCents !== null && usage.spentCents > 0) {
      out.push(
        msg({
          ...base,
          ruleId: 'budget_projection',
          dedupeKey: `budget_projection:${budget.id}:${month}`,
          severity: 'warning',
          priority: 65,
          title: `Ritmo alto em ${name}`,
          body: `Se mantiverem esse ritmo, o orçamento de ${name} pode acabar antes do fim do mês (projeção: ${formatBRL(usage.projectedCents)} para um limite de ${formatBRL(usage.limitCents)}).`,
          data: { ...data, projectedCents: usage.projectedCents },
        }),
      );
    } else if (usage.remainingCents > 0) {
      // Oportunidade de compra: orçamento com limite por pedido e folga real.
      if (v.orders && budget.perOrderLimitCents && v.orders.nextOrderMaxCents > 0) {
        const n = v.orders.guaranteedOrders;
        const body =
          n >= 1
            ? `Dá para ${name.toLowerCase().includes('ifood') || name.toLowerCase().includes('delivery') ? 'pedir' : 'comprar'} hoje: restam ${formatBRL(usage.remainingCents)} em ${name}, o suficiente para ${n} ${plural(n, 'pedido', 'pedidos')} de até ${formatBRL(budget.perOrderLimitCents)}${v.orders.leftoverCents > 0 ? ` e mais um menor, de até ${formatBRL(v.orders.leftoverCents)}` : ''}.`
            : `Restam ${formatBRL(usage.remainingCents)} em ${name}: dá para um pedido de até ${formatBRL(v.orders.nextOrderMaxCents)}, que é menos que o limite por pedido (${formatBRL(budget.perOrderLimitCents)}).`;
        out.push(
          msg({
            ...base,
            ruleId: 'purchase_opportunity',
            dedupeKey: `purchase_opportunity:${budget.id}:${month}`,
            severity: 'positive',
            priority: 30,
            title: `Cabe um pedido em ${name}`,
            body,
            data: { ...data, ...v.orders },
          }),
        );
      } else {
        out.push(
          msg({
            ...base,
            ruleId: 'budget_healthy',
            dedupeKey: `budget_healthy:${budget.id}:${month}`,
            severity: 'positive',
            priority: 20,
            title: `${name} sob controle`,
            body: `Esse mês está tranquilo! Vocês ainda têm ${formatBRL(usage.remainingCents)} para ${name.toLowerCase()}.`,
            data,
          }),
        );
      }
    }
  }
  return out;
}

function invoiceRules(i: PierreInput): PierreMessage[] {
  const out: PierreMessage[] = [];
  for (const v of i.invoices) {
    if (v.totals.outstandingCents <= 0) continue; // quitada/sem saldo: nada a avisar
    const topic = `invoice:${v.invoice.id}`;
    const due = formatDayMonthBR(v.invoice.dueDate);
    const data = {
      invoiceId: v.invoice.id,
      outstandingCents: v.totals.outstandingCents,
      dueDate: v.invoice.dueDate,
    };
    if (v.status === 'overdue') {
      out.push(
        msg({
          ruleId: 'invoice_overdue',
          topic,
          dedupeKey: `invoice_overdue:${v.invoice.id}`,
          severity: 'critical',
          priority: 100,
          title: `Fatura ${v.cardName} vencida`,
          body: `A fatura do ${v.cardName} venceu em ${due} e ainda há ${formatBRL(v.totals.outstandingCents)} em aberto${v.totals.paidCents > 0 ? ` (já foram pagos ${formatBRL(v.totals.paidCents)})` : ''}.`,
          data,
        }),
      );
      continue;
    }
    const days = diffDays(v.invoice.dueDate, i.today);
    if (days >= 0 && days <= 10) {
      const closed = v.status !== 'open';
      out.push(
        msg({
          ruleId: 'invoice_due_soon',
          topic,
          dedupeKey: `invoice_due_soon:${v.invoice.id}`,
          severity: days <= 3 ? 'warning' : 'info',
          priority: days <= 3 ? 85 : 60,
          title: `Fatura ${v.cardName} vence em ${due}`,
          body: closed
            ? `A fatura do ${v.cardName} vence em ${due}. O valor em aberto é ${formatBRL(v.totals.outstandingCents)}.`
            : `A fatura do ${v.cardName} vence em ${due}. O valor previsto é ${formatBRL(v.totals.outstandingCents)} (ela ainda está aberta e pode mudar).`,
          data,
        }),
      );
    }
  }
  return out;
}

function cashRules(i: PierreInput): PierreMessage[] {
  const fc = i.freeCash;
  if (!fc) return [];
  const until = formatDayMonthBR(fc.horizon);
  const month = monthKey(i.today);
  if (fc.guaranteedFreeCents < 0) {
    const gap = -fc.guaranteedFreeCents;
    const coveredByEstimate = fc.estimatedFreeCents >= 0 && fc.estimatedIncomeCents > 0;
    return [
      msg({
        ruleId: 'cash_shortfall',
        topic: 'cash',
        dedupeKey: `cash_shortfall:${fc.horizon}:${month}`,
        severity: 'critical',
        priority: 95,
        title: 'Compromissos acima do dinheiro disponível',
        body: `Até ${until}, os compromissos somam ${formatBRL(fc.commitmentsCents)} e superam o dinheiro disponível em ${formatBRL(gap)}.${coveredByEstimate ? ' Só fecha contando receitas estimadas, que não são garantidas.' : ''}`,
        data: { horizon: fc.horizon, gapCents: gap, commitmentsCents: fc.commitmentsCents },
      }),
    ];
  }
  return [];
}

function incomeRules(i: PierreInput): PierreMessage[] {
  const p = i.nextIncome;
  if (!p) return [];
  const days = diffDays(p.dueDate, i.today);
  if (days < 0 || days > 5) return [];
  const when =
    days === 0
      ? 'previsto para hoje'
      : days === 1
        ? 'previsto para amanhã'
        : `previsto para ${formatDayMonthBR(p.dueDate)} (em ${days} dias)`;
  return [
    msg({
      ruleId: 'salary_soon',
      topic: 'income',
      dedupeKey: `salary_soon:${p.id}`,
      severity: 'info',
      priority: 40,
      title: 'Renda a caminho',
      body: `${p.description} de ${formatBRL(p.amountCents)} está ${when}${p.isCertain ? '' : ' (valor estimado)'}. Só conta como recebido depois que for lançado.`,
      data: { plannedId: p.id, amountCents: p.amountCents, dueDate: p.dueDate },
    }),
  ];
}

function subscriptionRules(i: PierreInput): PierreMessage[] {
  const out: PierreMessage[] = [];
  for (const p of i.upcomingSubscriptions) {
    const days = diffDays(p.dueDate, i.today);
    if (days < 0 || days > 3) continue;
    out.push(
      msg({
        ruleId: 'subscription_soon',
        topic: `subscription:${p.id}`,
        dedupeKey: `subscription_soon:${p.id}`,
        severity: 'info',
        priority: 35,
        title: `${p.description} em breve`,
        body: `A assinatura ${p.description} (${formatBRL(p.amountCents)}) está prevista para ${formatDayMonthBR(p.dueDate)}.`,
        data: { plannedId: p.id, amountCents: p.amountCents },
      }),
    );
  }
  return out;
}

function trendRules(i: PierreInput): PierreMessage[] {
  const out: PierreMessage[] = [];
  const month = monthKey(i.today);
  const day = Number(i.today.slice(8, 10));
  const dim = new Date(Date.UTC(Number(i.today.slice(0, 4)), Number(i.today.slice(5, 7)), 0)).getUTCDate();
  const eligible = i.trends.filter((t) => t.periods >= i.prefs.minPeriods);
  for (const t of eligible) {
    if (day < 5 || t.averagePastCents <= 0) continue;
    const expectedSoFar = Math.floor((t.averagePastCents * day) / dim);
    const excess = t.currentSpentCents - expectedSoFar;
    const tolerance = Math.floor((expectedSoFar * i.prefs.variancePct) / 100);
    if (excess > tolerance && excess >= 5000) {
      out.push(
        msg({
          ruleId: 'spending_above_pattern',
          topic: `trend:${t.categoryId}`,
          dedupeKey: `spending_above_pattern:${t.categoryId}:${month}`,
          severity: 'warning',
          priority: 55,
          title: `${t.name} acima do padrão`,
          body: `Até agora, ${t.name} soma ${formatBRL(t.currentSpentCents)} neste mês; pela média dos últimos ${t.periods} meses (${formatBRL(t.averagePastCents)}/mês), o esperado até hoje seria ${formatBRL(expectedSoFar)}.`,
          data: { categoryId: t.categoryId, excessCents: excess, periods: t.periods },
        }),
      );
    }
  }
  if (out.length === 0 && eligible.length === 0 && i.hasAnyData && i.historyPeriods < i.prefs.minPeriods) {
    out.push(
      msg({
        ruleId: 'history_insufficient',
        topic: 'trend:none',
        dedupeKey: `history_insufficient:${month}`,
        severity: 'info',
        priority: 5,
        title: 'Ainda aprendendo o ritmo de vocês',
        body: `Preciso de pelo menos ${i.prefs.minPeriods} meses completos de histórico para comparar seus gastos com o padrão. Hoje há ${i.historyPeriods} ${plural(i.historyPeriods, 'mês', 'meses')}.`,
        data: { historyPeriods: i.historyPeriods },
      }),
    );
  }
  return out;
}

function savingsRules(i: PierreInput): PierreMessage[] {
  const s = i.savings;
  if (!s || s.goalCents <= 0) return [];
  const month = monthKey(i.today);
  const day = Number(i.today.slice(8, 10));
  const dim = new Date(Date.UTC(Number(i.today.slice(0, 4)), Number(i.today.slice(5, 7)), 0)).getUTCDate();
  const left = dim - day;
  if (s.savedCents >= s.goalCents) {
    return [
      msg({
        ruleId: 'savings_goal_reached',
        topic: 'savings',
        dedupeKey: `savings_goal_reached:${month}`,
        severity: 'positive',
        priority: 25,
        title: 'Meta de economia atingida',
        body: `Vocês já guardaram ${formatBRL(s.savedCents)} em ${formatMonthLabel(month)}, acima da meta de ${formatBRL(s.goalCents)}.`,
        data: { savedCents: s.savedCents, goalCents: s.goalCents },
      }),
    ];
  }
  if (left <= 10 || (s.savedCents < 0 && day >= 5)) {
    const missing = s.goalCents - s.savedCents;
    return [
      msg({
        ruleId: 'savings_goal_at_risk',
        topic: 'savings',
        dedupeKey: `savings_goal_at_risk:${month}`,
        severity: 'warning',
        priority: 50,
        title: 'Meta de economia em risco',
        body: `A meta do mês é ${formatBRL(s.goalCents)} e, até agora, a diferença entre receitas e despesas é ${formatBRL(s.savedCents)}. Faltam ${formatBRL(missing)} e restam ${left} ${plural(left, 'dia', 'dias')}.`,
        data: { savedCents: s.savedCents, goalCents: s.goalCents, missingCents: missing },
      }),
    ];
  }
  return [];
}

// ---- Controle de frequência e deduplicação ------------------------------------------------------------

export function isDismissed(m: PierreMessage, history: MessageHistory, nowMs: number): boolean {
  const h = history[m.dedupeKey];
  if (!h) return false;
  if (h.dismissedAt) return true;
  return !!h.snoozedUntil && Date.parse(h.snoozedUntil) > nowMs;
}

/** Mensagens que ainda não foram dispensadas/adiadas pelo usuário. */
export function visibleMessages(
  all: PierreMessage[],
  history: MessageHistory,
  nowMs: number,
): PierreMessage[] {
  return all.filter((m) => !isDismissed(m, history, nowMs));
}

/**
 * Mensagem principal (Início): a de maior prioridade que não foi dispensada e cujo período de espera passou.
 * Críticas (cooldown 0) sempre voltam. Se todas estiverem em espera, mostra a de maior prioridade mesmo assim —
 * o Pierre nunca fica mudo diante de uma situação ativa.
 */
export function pickHeadline(
  all: PierreMessage[],
  history: MessageHistory,
  nowMs: number,
): PierreMessage | null {
  const visible = visibleMessages(all, history, nowMs);
  if (visible.length === 0) return null;
  const ready = visible.find((m) => {
    const last = history[m.dedupeKey]?.lastShownAt;
    return !last || m.cooldownHours === 0 || nowMs - Date.parse(last) >= m.cooldownHours * 3_600_000;
  });
  return ready ?? visible[0] ?? null;
}
