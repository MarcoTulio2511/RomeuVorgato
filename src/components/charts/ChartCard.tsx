import type { ReactNode } from 'react';
import { formatBRL, formatBRLCompact } from '../../domain/money/money';
import { Card, EmptyState, Eyebrow, Muted, Stack } from '../ui/primitives';

export const axisProps = {
  stroke: '#6d7065',
  tick: { fill: '#a1a496', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;
export const gridProps = { stroke: 'rgba(255,255,255,0.06)', vertical: false } as const;
export const money = (v: unknown) => formatBRL(Number(v));
export const moneyCompact = (v: unknown) => formatBRLCompact(Number(v));
export const tooltipStyle = {
  contentStyle: {
    background: '#1d1e1a',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 14,
    color: '#f3f4ee',
  },
  labelStyle: { color: '#a1a496' },
  itemStyle: { color: '#f3f4ee' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
} as const;

/**
 * Cartão de gráfico acessível: título, descrição do critério usado, gráfico, estado vazio e uma tabela equivalente
 * (leitores de tela e navegação por teclado). Nunca renderiza dados inventados quando está vazio.
 */
export function ChartCard({
  title,
  criterion,
  empty,
  emptyText,
  children,
  table,
  summary,
}: {
  title: string;
  criterion?: string;
  empty: boolean;
  emptyText?: string;
  children: ReactNode;
  table?: { headers: string[]; rows: Array<Array<string | number>> };
  summary?: string;
}) {
  return (
    <Card>
      <Stack $gap={12}>
        <Stack $gap={2}>
          <Eyebrow>{title}</Eyebrow>
          {criterion && <Muted $small>{criterion}</Muted>}
        </Stack>
        {empty ? (
          <EmptyState
            icon="chart"
            title="Sem dados neste período"
            text={emptyText ?? 'Quando houver lançamentos, o gráfico aparece aqui.'}
          />
        ) : (
          <>
            <div role="img" aria-label={summary ?? title} style={{ width: '100%', height: 260 }}>
              {children}
            </div>
            {table && (
              <details>
                <summary style={{ cursor: 'pointer', color: '#a1a496', fontSize: 13 }}>
                  Ver dados em tabela
                </summary>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: 13, marginTop: 8 }}>
                    <thead>
                      <tr>
                        {table.headers.map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#a1a496' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td
                              key={j}
                              style={{ padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                            >
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
