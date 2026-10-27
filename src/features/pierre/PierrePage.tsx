import { useState } from 'react';
import { formatDateBR } from '../../domain/dates';
import { PIERRE_QUESTIONS, answerQuestion, type PierreQuestionId } from '../../domain/pierre/questions';
import type { PierreAnswer, Severity } from '../../domain/pierre/types';
import { PierreMascot } from '../../components/ui/PierreMascot';
import {
  Amount,
  Button,
  Card,
  Eyebrow,
  ErrorState,
  Grid,
  ListItem,
  Muted,
  PageHeader,
  PlainList,
  Pill,
  Row,
  Stack,
} from '../../components/ui/primitives';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { usePierre } from './usePierre';

const TONE: Record<Severity, 'positive' | 'info' | 'warning' | 'danger'> = {
  positive: 'positive',
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};
const VERDICT = { yes: 'positive', caution: 'warning', no: 'danger', info: 'info' } as const;

export default function PierrePage() {
  const { snapshot, data } = useReadyHousehold();
  const { visible, all, dismiss, snooze, loaded, error } = usePierre();
  const [answer, setAnswer] = useState<PierreAnswer | null>(null);
  const hidden = all.length - visible.length;

  const ask = (id: PierreQuestionId) => setAnswer(answerQuestion(id, snapshot.pierreInput));

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Pierre"
        subtitle="Orientações calculadas com as regras do sistema — sem IA, sem achismo."
      />

      <Card>
        <Stack $gap={14}>
          <Row>
            <PierreMascot size={44} />
            <Stack $gap={0}>
              <strong>Pergunte ao Pierre</strong>
              <Muted $small>Cada resposta mostra a regra e os números usados.</Muted>
            </Stack>
          </Row>
          <Row $wrap $gap={8}>
            {PIERRE_QUESTIONS.map((q) => (
              <Button key={q.id} small variant="ghost" onClick={() => ask(q.id)}>
                {q.label}
              </Button>
            ))}
          </Row>
          {answer && (
            <Card $pad={18} $tone="accent" aria-live="polite">
              <Stack $gap={10}>
                <Row $wrap>
                  <Eyebrow>{answer.question}</Eyebrow>
                  <Pill $tone={VERDICT[answer.verdict]}>
                    {{ yes: 'Sim', caution: 'Com cuidado', no: 'Não', info: 'Informação' }[answer.verdict]}
                  </Pill>
                </Row>
                <h2 style={{ fontSize: 20 }}>{answer.headline}</h2>
                {answer.values.length > 0 && (
                  <PlainList>
                    {answer.values.map((v) => (
                      <ListItem key={v.label}>
                        <span>{v.label}</span>
                        <span style={{ marginLeft: 'auto' }}>
                          <Amount cents={v.cents} />
                        </span>
                      </ListItem>
                    ))}
                  </PlainList>
                )}
                {answer.considered.length > 0 && (
                  <Stack $gap={4}>
                    <Eyebrow>Compromissos considerados</Eyebrow>
                    {answer.considered.map((c) => (
                      <Row key={`${c.label}${c.dueDate}`}>
                        <span>{c.label}</span>
                        <Muted $small>{formatDateBR(c.dueDate)}</Muted>
                        <span style={{ marginLeft: 'auto' }}>
                          <Amount cents={c.cents} />
                        </span>
                      </Row>
                    ))}
                  </Stack>
                )}
                <Muted $small>
                  <strong>Regra:</strong> {answer.rule}
                </Muted>
                {answer.notes.map((n) => (
                  <Muted key={n} $small>
                    • {n}
                  </Muted>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>
      </Card>

      {error && <ErrorState message={error} />}

      <Stack $gap={12}>
        <Row>
          <Eyebrow>Mensagens de agora</Eyebrow>
          {hidden > 0 && (
            <Muted $small>
              ({hidden} dispensada{hidden > 1 ? 's' : ''} ou adiada{hidden > 1 ? 's' : ''})
            </Muted>
          )}
        </Row>
        {!loaded ? (
          <Muted>Carregando…</Muted>
        ) : visible.length === 0 ? (
          <Card>
            <Muted>
              Nada novo por aqui.{' '}
              {data.accounts.length === 0
                ? 'Cadastre uma conta para começar.'
                : 'Você dispensou todas as mensagens atuais.'}
            </Muted>
          </Card>
        ) : (
          <Grid $min={320}>
            {visible.map((m) => (
              <Card
                key={m.dedupeKey}
                $pad={18}
                $tone={
                  m.severity === 'critical' ? 'danger' : m.severity === 'warning' ? 'warning' : 'default'
                }
              >
                <Stack $gap={8}>
                  <Row>
                    <Pill $tone={TONE[m.severity]}>
                      {
                        {
                          positive: 'Bom sinal',
                          info: 'Informação',
                          warning: 'Atenção',
                          critical: 'Urgente',
                        }[m.severity]
                      }
                    </Pill>
                  </Row>
                  <h3 style={{ fontSize: 18 }}>{m.title}</h3>
                  <p>{m.body}</p>
                  <Row $gap={8}>
                    <Button small variant="ghost" onClick={() => void snooze(m, 24)}>
                      Adiar 24h
                    </Button>
                    <Button small variant="ghost" onClick={() => void dismiss(m)}>
                      Dispensar
                    </Button>
                  </Row>
                </Stack>
              </Card>
            ))}
          </Grid>
        )}
        <Muted $small>
          Hoje: {formatDateBR(snapshot.today)}. As mensagens são recalculadas a cada alteração nos dados.
        </Muted>
      </Stack>
    </Stack>
  );
}
