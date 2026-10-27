import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ThemeProvider } from 'styled-components';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/components/feedback/Toast';
import { ConfirmDialog } from '../../src/components/ui/Modal';
import {
  EmptyState,
  ErrorState,
  MoneyField,
  PageSkeleton,
  ProgressBar,
} from '../../src/components/ui/primitives';
import type { Cents } from '../../src/domain/money/money';
import { useSubmit } from '../../src/hooks/useSubmit';
import { AppError, friendlyError, onSessionExpired, toAppError } from '../../src/services/supabase/errors';
import { theme } from '../../src/styles/theme';
import { renderUi } from '../helpers/render';

describe('estados de interface', () => {
  it('estado vazio com ação', async () => {
    const onClick = vi.fn();
    renderUi(
      <EmptyState
        title="Nenhum orçamento"
        text="Crie o primeiro."
        action={<button onClick={onClick}>Criar</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nenhum orçamento' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('estado de erro é anunciado e permite tentar de novo', async () => {
    const retry = vi.fn();
    renderUi(<ErrorState message="Sem conexão com o servidor." onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor.');
    await userEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('skeleton sinaliza carregamento; barra de progresso é acessível', () => {
    renderUi(
      <>
        <PageSkeleton />
        <ProgressBar label="Uso do orçamento" pct={130} tone="danger" />
      </>,
    );
    expect(screen.getByLabelText('Carregando')).toHaveAttribute('aria-busy', 'true');
    const bar = screen.getByRole('progressbar', { name: 'Uso do orçamento' });
    expect(bar).toHaveAttribute('aria-valuenow', '100'); // limitado a 100
  });

  it('confirmação destrutiva: cancela com Esc e só confirma ao clicar', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderUi(
      <ConfirmDialog
        title="Excluir?"
        message="Tem certeza?"
        onConfirm={onConfirm}
        onCancel={onCancel}
        confirmLabel="Excluir"
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Excluir?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('modal prende o foco com Tab e devolve ao fechar', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>abrir</button>
          {open && (
            <ConfirmDialog
              title="T"
              message="m"
              onConfirm={() => undefined}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    renderUi(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'abrir' })).toHaveFocus());
  });
});

describe('MoneyField', () => {
  function Host({ onValue }: { onValue: (c: Cents | null) => void }) {
    const [v, setV] = useState<Cents | null>(null);
    return (
      <MoneyField
        label="Valor"
        value={v}
        onChange={(c) => {
          setV(c);
          onValue(c);
        }}
      />
    );
  }
  it('converte formato brasileiro em centavos inteiros e formata ao sair do campo', async () => {
    const seen = vi.fn();
    renderUi(<Host onValue={seen} />);
    const input = screen.getByLabelText('Valor');
    await userEvent.type(input, '1.234,56');
    expect(seen).toHaveBeenLastCalledWith(123456);
    await userEvent.tab();
    expect(input).toHaveValue('1.234,56');
  });
  it('sinaliza valor inválido e devolve null', async () => {
    const seen = vi.fn();
    renderUi(<Host onValue={seen} />);
    await userEvent.type(screen.getByLabelText('Valor'), '12,345');
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('alert')).toHaveTextContent(/Valor inválido/);
  });
});

describe('useSubmit: duplo clique e idempotência', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider theme={theme}>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );

  it('ignora cliques enquanto há envio em andamento', async () => {
    let release: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<string>((r) => {
          release = () => r('ok');
        }),
    );
    const { result } = renderHook(() => useSubmit<string, string>(action), { wrapper });
    act(() => {
      void result.current.submit('a');
      void result.current.submit('a');
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(true);
    await act(async () => {
      release();
    });
    expect(result.current.submitting).toBe(false);
  });

  it('reenvio após falha mantém o MESMO request id; após sucesso ou mudança de valores, muda', async () => {
    const ids: string[] = [];
    const action = vi.fn(async (_v: string, id: string) => {
      ids.push(id);
      if (ids.length === 1) throw new AppError('Sem conexão', 'network');
      return 'ok';
    });
    const { result } = renderHook(() => useSubmit<string, string>(action), { wrapper });
    await act(async () => {
      await result.current.submit('v1');
    });
    expect(result.current.error).toBe('Sem conexão');
    await act(async () => {
      await result.current.submit('v1');
    });
    expect(ids[1]).toBe(ids[0]); // retry idempotente: o servidor devolve o resultado já gravado, se houver
    await act(async () => {
      await result.current.submit('v1');
    });
    expect(ids[2]).not.toBe(ids[0]); // depois do sucesso, nova operação = novo id
    await act(async () => {
      await result.current.submit('v2');
    });
    expect(ids[3]).not.toBe(ids[2]);
  });
});

describe('tradução de erros (sem vazar detalhes técnicos)', () => {
  it('mensagens das nossas RPCs (em português) são preservadas', () => {
    expect(friendlyError({ code: 'P0001', message: 'O valor excede o saldo em aberto da fatura.' })).toBe(
      'O valor excede o saldo em aberto da fatura.',
    );
  });
  it('RLS e permissões viram mensagem genérica', () => {
    const m = friendlyError({
      code: '42501',
      message: 'new row violates row-level security policy for table "accounts"',
    });
    expect(m).toBe('Você não tem permissão para esta ação.');
    expect(m).not.toMatch(/accounts|policy/);
  });
  it('erros desconhecidos de banco não aparecem na tela', () => {
    const m = friendlyError({
      code: 'XX000',
      message: 'relation "public.secret" does not exist at character 14',
    });
    expect(m).toBe('Algo deu errado. Tente novamente em instantes.');
  });
  it('conflito, chave estrangeira, rede', () => {
    expect(
      friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }),
    ).toMatch(/Já existe/);
    expect(friendlyError({ code: '23503', message: 'violates foreign key' })).toMatch(/em uso/);
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/Sem conexão/);
  });
  it('sessão expirada notifica quem estiver ouvindo (AuthProvider encerra a sessão)', () => {
    const cb = vi.fn();
    const off = onSessionExpired(cb);
    const e = toAppError({ code: 'PGRST301', message: 'JWT expired' });
    expect(e.kind).toBe('session');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    toAppError({ code: '28000', message: 'Sessão expirada. Entre novamente.' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('credenciais incorretas e e-mail repetido', () => {
    expect(friendlyError({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.');
    expect(friendlyError({ message: 'User already registered' })).toBe('Este e-mail já está cadastrado.');
  });
});

// garante que o render simples sem providers também funciona para componentes puros
it('renderiza primitivos sob o tema', () => {
  render(
    <ThemeProvider theme={theme}>
      <EmptyState title="ok" />
    </ThemeProvider>,
  );
  expect(screen.getByText('ok')).toBeInTheDocument();
});
