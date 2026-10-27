import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { media } from '../../styles/theme';
import { Icon } from './Icon';
import { Button, IconButton, Row, Stack, Muted } from './primitives';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 50;
  background: ${({ theme }) => theme.colors.overlay};
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  ${media.md} {
    align-items: center;
    padding: 24px;
  }
`;
const Dialog = styled.div`
  width: 100%;
  max-height: 92dvh;
  overflow: auto;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.borderStrong};
  border-radius: 28px 28px 0 0;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  box-shadow: ${({ theme }) => theme.shadow.pop};
  ${media.md} {
    max-width: 560px;
    border-radius: 28px;
    padding: 28px;
  }
`;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  label,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <Backdrop onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog ref={ref} role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1}>
        <Stack $gap={20}>
          <Row $justify="space-between">
            <h2 style={{ fontSize: 22 }}>{title}</h2>
            <IconButton type="button" onClick={onClose} aria-label="Fechar">
              <Icon name="close" />
            </IconButton>
          </Row>
          {children}
        </Stack>
      </Dialog>
    </Backdrop>,
    document.body,
  );
}

/** Confirmação para operações destrutivas. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={busy ? () => undefined : onCancel}>
      <Muted>{message}</Muted>
      {error && (
        <p role="alert" style={{ color: '#ff7a7a', fontSize: 14 }}>
          {error}
        </p>
      )}
      <Row $justify="flex-end" $wrap>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </Row>
    </Modal>
  );
}
