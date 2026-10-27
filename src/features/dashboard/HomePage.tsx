import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { diffDays, formatDateBR, formatDayMonthBR } from '../../domain/dates';
import { INVOICE_STATUS_LABEL } from '../../domain/invoices/invoices';
import { ratioPercent } from '../../domain/money/money';
import { PierreMascot } from '../../components/ui/PierreMascot';
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Grid,
  Hero,
  LinkButton,
  ListItem,
  Muted,
  PlainList,
  Pill,
  ProgressBar,
  Row,
  Spacer,
  Stack,
} from '../../components/ui/primitives';
import { media } from '../../styles/theme';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { usePierre } from '../pierre/usePierre';

const Headline = styled(Card)`
  display: flex;
  gap: 18px;
  align-items: flex-start;
  ${media.sm} {
    flex-direction: column;
  }
`;

export default function HomePage() {
  const { snapshot: s, data, nameOf, viewKey } = useReadyHousehold();
  const pierre = usePierre();
  const { headline, markShown, loaded } = pierre;

  useEffect(() => {
    if (loaded) markShown(headline);
  }, [loaded, headline, markShown]);

  if (data.accounts.length === 0 && data.cards.length === 0) {
    return (
      <Stack $gap={20}>
        <Headline $tone="accent">
          <PierreMascot size={64} />
          <Stack $gap={6}>
            <h1 style={{ fontSize: 26 }}>Olá! Vamos começar?</h1>
            <Muted>Cadastre a primeira conta ou cartão para eu acompanhar o dinheiro de vocês.</Muted>
            <Row $wrap>
              <LinkButton as={Link} to="/contas">
                Cadastrar conta
              </LinkButton>
              <LinkButton as={Link} to="/cartoes" $variant="ghost">
                Cadastrar cartão
              </LinkButton>
            </Row>
          </Stack>
        </Headline>
      </Stack>
    );
  }

  const fc = s.freeCash;
  const mood =
    headline?.severity === 'critical' || headline?.severity === 'warning'
      ? 'worried'
      : headline?.severity === 'positive'
        ? 'happy'
        : 'calm';
  const days = Math.max(0, diffDays(fc.horizon, s.today));
  const nextInvoices = s.invoiceViews.filter((v) => v.totals.outstandingCents > 0).slice(0, 3);
  const budgets = [...s.budgetViews]
    .sort((a, b) => b.usage.spentCents * a.usage.limitCents - a.usage.spentCents * b.usage.limitCents)
    .slice(0, 3);
  const scopeLabel = viewKey === 'joint' ? 'do casal' : 'da visão selecionada';

  return (
    <Stack $gap={20}>
      {headline && (
        <Headline $tone="accent" aria-live="polite">
          <PierreMascot size={60} mood={mood} />
          <Stack $gap={6}>
            <Eyebrow>Pierre</Eyebrow>
            <h2 style={{ fontSize: 22 }}>{headline.title}</h2>
            <p>{headline.body}</p>
            <Row $wrap $gap={8}>
              <Button small variant="ghost" onClick={() => void pierre.snooze(headline, 24)}>
                Lembrar amanhã
              </Button>
              <LinkButton as={Link} to="/pierre" $small $variant="soft">
                Ver tudo
              </LinkButton>
            </Row>
          </Stack>
        </Headline>
      )}

      <Card>
        <Stack $gap={14}>
          <Eyebrow>
            Dinheiro livre até {formatDayMonthBR(fc.horizon)}{' '}
            {s.horizon.reason === 'next_income' ? '(próxima renda)' : '(fim do mês)'}
          </Eyebrow>
          <Hero>
            <Amount cents={fc.guaranteedFreeCents} tone={fc.guaranteedFreeCents < 0 ? 'negative' : 'plain'} />
          </Hero>
          <Row $wrap $gap={8}>
            <Pill $tone={fc.isComplete ? 'positive' : 'warning'}>
              {fc.isComplete ? `${days} ${days === 1 ? 'dia' : 'dias'} de previsão` : 'Estimativa incompleta'}
            </Pill>
            {fc.estimatedIncomeCents > 0 && (
              <Pill $tone="info">
                com estimadas: <Amount cents={fc.estimatedFreeCents} />
              </Pill>
            )}
          </Row>
          <Muted $small>
            Saldo {scopeLabel} <Amount cents={s.consolidatedCents} /> − compromissos{' '}
            <Amount cents={fc.commitmentsCents} />
            {fc.confirmedIncomeCents > 0 && (
              <>
                {' '}
                + receitas confirmadas <Amount cents={fc.confirmedIncomeCents} />
              </>
            )}
            . <Link to="/planejamento">Ver premissas</Link>
          </Muted>
        </Stack>
      </Card>

      {s.nextCommitment && (
        <Card $pad={18}>
          <Row>
            <Stack $gap={2}>
              <Eyebrow>Próximo compromisso</Eyebrow>
              <strong>{s.nextCommitment.label}</strong>
              <Muted $small>{formatDateBR(s.nextCommitment.dueDate)}</Muted>
            </Stack>
            <Spacer />
            <strong style={{ fontSize: 20 }}>
              <Amount cents={s.nextCommitment.amountCents} />
            </strong>
          </Row>
        </Card>
      )}

      <Grid $min={320}>
        <Card>
          <Stack $gap={8}>
            <Row>
              <Eyebrow>Contas</Eyebrow>
              <Spacer />
              <Link to="/contas">Gerenciar</Link>
            </Row>
            {s.accountBalances.filter((b) => b.account.isActive).length === 0 ? (
              <Muted>Nenhuma conta ativa{viewKey !== 'joint' ? ' nesta visão' : ''}.</Muted>
            ) : (
              <PlainList>
                {s.accountBalances
                  .filter((b) => b.account.isActive)
                  .map((b) => (
                    <ListItem key={b.account.id}>
                      <Stack $gap={0}>
                        <strong>{b.account.name}</strong>
                        <Muted $small>{nameOf(b.account.ownerId)}</Muted>
                      </Stack>
                      <Spacer />
                      <Amount cents={b.balanceCents} tone={b.balanceCents < 0 ? 'negative' : 'plain'} />
                    </ListItem>
                  ))}
              </PlainList>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack $gap={8}>
            <Row>
              <Eyebrow>Faturas</Eyebrow>
              <Spacer />
              <Link to="/cartoes">Ver cartões</Link>
            </Row>
            {nextInvoices.length === 0 ? (
              <Muted>Nenhuma fatura com saldo a pagar.</Muted>
            ) : (
              <PlainList>
                {nextInvoices.map((v) => (
                  <ListItem key={v.invoice.id}>
                    <Stack $gap={2}>
                      <strong>{v.cardName}</strong>
                      <Muted $small>vence {formatDayMonthBR(v.invoice.dueDate)}</Muted>
                    </Stack>
                    <Spacer />
                    <Stack $gap={2} style={{ alignItems: 'flex-end' }}>
                      <Amount cents={v.totals.outstandingCents} />
                      <Pill
                        $tone={
                          v.status === 'overdue'
                            ? 'danger'
                            : v.status === 'partially_paid'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {INVOICE_STATUS_LABEL[v.status]}
                      </Pill>
                    </Stack>
                  </ListItem>
                ))}
              </PlainList>
            )}
          </Stack>
        </Card>
      </Grid>

      <Card>
        <Stack $gap={12}>
          <Row>
            <Eyebrow>Orçamentos do mês</Eyebrow>
            <Spacer />
            <Link to="/orcamentos">Ver todos</Link>
          </Row>
          {budgets.length === 0 ? (
            <EmptyState
              icon="target"
              title="Nenhum orçamento ainda"
              text="Defina limites mensais por categoria para ver quanto ainda dá para gastar."
              action={
                <LinkButton as={Link} to="/orcamentos" $variant="soft" $small>
                  Criar orçamento
                </LinkButton>
              }
            />
          ) : (
            budgets.map((b) => (
              <Stack key={b.budget.id} $gap={6}>
                <Row>
                  <strong>{b.categoryName}</strong>
                  <Spacer />
                  <Muted $small>
                    {b.usage.remainingCents >= 0 ? (
                      <>
                        restam <Amount cents={b.usage.remainingCents} />
                      </>
                    ) : (
                      <>
                        passou <Amount cents={b.usage.overCents} />
                      </>
                    )}
                  </Muted>
                </Row>
                <ProgressBar
                  label={`Uso do orçamento de ${b.categoryName}`}
                  pct={ratioPercent(b.usage.spentCents, b.usage.limitCents)}
                  tone={
                    b.usage.status === 'exceeded'
                      ? 'danger'
                      : b.usage.status === 'warning'
                        ? 'warning'
                        : 'accent'
                  }
                />
              </Stack>
            ))
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
