import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/services/supabase/errors';
import { renderUi } from '../helpers/render';

const auth = vi.hoisted(() => ({
  value: {
    status: 'signedOut' as 'signedOut' | 'loading' | 'unconfigured' | 'signedIn',
    user: null as null | { id: string; email: string },
    sessionExpired: false,
    recovering: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    clearExpired: vi.fn(),
  },
}));
vi.mock('../../src/features/auth/AuthProvider', () => ({
  useAuth: () => auth.value,
  AuthProvider: ({ children }: { children: unknown }) => children,
}));

import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../../src/app/Guards';
import { ForgotPasswordPage, LoginPage, SignupPage } from '../../src/features/auth/AuthPages';

beforeEach(() => {
  auth.value.status = 'signedOut';
  auth.value.user = null;
  auth.value.sessionExpired = false;
  for (const k of ['signIn', 'signUp', 'signOut', 'requestPasswordReset', 'updatePassword'] as const)
    auth.value[k].mockReset();
});

describe('login', () => {
  it('valida os campos antes de chamar o servidor', async () => {
    renderUi(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha.')).toBeInTheDocument();
    expect(auth.value.signIn).not.toHaveBeenCalled();
  });

  it('mostra o erro amigável quando as credenciais falham', async () => {
    auth.value.signIn.mockRejectedValue(new AppError('E-mail ou senha incorretos.', 'validation'));
    renderUi(<LoginPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
  });

  it('impede envio duplicado enquanto a requisição está em andamento', async () => {
    let release: () => void = () => undefined;
    auth.value.signIn.mockImplementation(() => new Promise<void>((r) => (release = r)));
    renderUi(<LoginPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-correta');
    const btn = screen.getByRole('button', { name: 'Entrar' });
    await userEvent.dblClick(btn);
    expect(auth.value.signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
  });

  it('avisa que a sessão expirou', () => {
    auth.value.sessionExpired = true;
    renderUi(<LoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/sessão expirou/i);
  });
});

describe('cadastro e recuperação de senha', () => {
  it('exige senha forte o bastante e confirmação igual', async () => {
    renderUi(<SignupPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'curta');
    await userEvent.type(screen.getByLabelText('Repita a senha'), 'outra');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('A senha deve ter pelo menos 8 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('As senhas não conferem.')).toBeInTheDocument();
    expect(auth.value.signUp).not.toHaveBeenCalled();
  });

  it('pede confirmação de e-mail quando o projeto exige', async () => {
    auth.value.signUp.mockResolvedValue('confirm');
    renderUi(<SignupPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senhaboa123');
    await userEvent.type(screen.getByLabelText('Repita a senha'), 'senhaboa123');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText(/Enviamos um link de confirmação/)).toBeInTheDocument();
  });

  it('recuperação usa mensagem neutra (não revela se o e-mail existe)', async () => {
    auth.value.requestPasswordReset.mockResolvedValue(undefined);
    renderUi(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'qualquer@exemplo.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByText(/Se houver uma conta com esse e-mail/)).toBeInTheDocument();
  });
});

describe('proteção de rotas', () => {
  const tree = (
    <Routes>
      <Route path="/entrar" element={<p>tela de login</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/privada" element={<p>conteúdo privado</p>} />
      </Route>
    </Routes>
  );

  it('sem sessão, redireciona para o login e não mostra o conteúdo', () => {
    renderUi(tree, '/privada');
    expect(screen.getByText('tela de login')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo privado')).not.toBeInTheDocument();
  });

  it('com sessão, libera a rota', () => {
    auth.value.status = 'signedIn';
    auth.value.user = { id: 'u1', email: 'a@b.c' };
    renderUi(tree, '/privada');
    expect(screen.getByText('conteúdo privado')).toBeInTheDocument();
  });

  it('sem Supabase configurado, explica a configuração (não finge conexão)', () => {
    auth.value.status = 'unconfigured';
    renderUi(tree, '/privada');
    expect(screen.getByText('Falta conectar o Supabase')).toBeInTheDocument();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeInTheDocument();
  });
});
