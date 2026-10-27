import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';
import { media } from '../../styles/theme';
import { Icon } from '../ui/Icon';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}

const rise = keyframes` from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } `;
const Region = styled.div`
  position: fixed;
  z-index: 80;
  left: 16px;
  right: 16px;
  bottom: calc(92px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  ${media.md} {
    left: auto;
    right: 24px;
    bottom: 24px;
    width: 380px;
  }
`;
const Item = styled.div<{ $kind: Kind }>`
  pointer-events: auto;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 18px;
  animation: ${rise} 0.2s ease;
  background: ${({ theme }) => theme.colors.surface3};
  border: 1px solid
    ${({ theme, $kind }) => ($kind === 'error' ? 'rgba(255,122,122,0.5)' : $kind === 'success' ? 'rgba(200,245,66,0.4)' : theme.colors.borderStrong)};
  box-shadow: ${({ theme }) => theme.shadow.pop};
  font-size: 15px;
  svg {
    flex: none;
    color: ${({ theme, $kind }) => ($kind === 'error' ? theme.colors.danger : theme.colors.accent)};
  }
`;

interface ToastApi {
  success: (t: string) => void;
  error: (t: string) => void;
  info: (t: string) => void;
}
const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setItems((s) => [...s.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3800);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      success: (t) => push('success', t),
      error: (t) => push('error', t),
      info: (t) => push('info', t),
    }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <Region aria-live="polite" aria-atomic="false">
        {items.map((i) => (
          <Item key={i.id} $kind={i.kind} role={i.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={i.kind === 'error' ? 'alert' : 'check'} size={18} />
            <span>{i.text}</span>
          </Item>
        ))}
      </Region>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast fora do ToastProvider');
  return v;
}
