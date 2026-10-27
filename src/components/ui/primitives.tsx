import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import styled, { css, keyframes } from 'styled-components';
import { formatMoneyInput, parseMoneyInput, type Cents } from '../../domain/money/money';
import { formatBRL } from '../../domain/money/money';
import { media } from '../../styles/theme';
import { Icon, type IconName } from './Icon';

/* ---------- Layout ---------- */
export const Stack = styled.div<{ $gap?: number }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap = 16 }) => $gap}px;
  min-width: 0;
`;
export const Row = styled.div<{ $gap?: number; $wrap?: boolean; $align?: string; $justify?: string }>`
  display: flex;
  gap: ${({ $gap = 12 }) => $gap}px;
  flex-wrap: ${({ $wrap }) => ($wrap ? 'wrap' : 'nowrap')};
  align-items: ${({ $align = 'center' }) => $align};
  justify-content: ${({ $justify = 'flex-start' }) => $justify};
  min-width: 0;
`;
export const Grid = styled.div<{ $min?: number }>`
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, ${({ $min = 280 }) => $min}px), 1fr));
`;
export const Spacer = styled.div`
  flex: 1;
`;

export const Card = styled.section<{ $pad?: number; $tone?: 'default' | 'accent' | 'warning' | 'danger' }>`
  background: ${({ theme, $tone }) => ($tone === 'accent' ? `linear-gradient(160deg, ${theme.colors.surface2}, ${theme.colors.surface})` : theme.colors.surface)};
  border: 1px solid
    ${({ theme, $tone }) =>
      $tone === 'accent'
        ? 'rgba(200,245,66,0.28)'
        : $tone === 'warning'
          ? 'rgba(255,200,87,0.35)'
          : $tone === 'danger'
            ? 'rgba(255,122,122,0.4)'
            : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ $pad = 22 }) => $pad}px;
  box-shadow: ${({ theme }) => theme.shadow.card};
  min-width: 0;
  ${media.sm} {
    padding: ${({ $pad = 22 }) => Math.min($pad, 18)}px;
    border-radius: 22px;
  }
`;

export const Eyebrow = styled.p`
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;
export const Muted = styled.p<{ $small?: boolean }>`
  color: ${({ theme }) => theme.colors.muted};
  font-size: ${({ $small }) => ($small ? '13px' : '15px')};
`;
export const Hero = styled.p<{ $size?: number }>`
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  letter-spacing: -0.03em;
  font-size: ${({ $size = 44 }) => $size}px;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  ${media.sm} {
    font-size: ${({ $size = 44 }) => Math.round($size * 0.82)}px;
  }
`;

/* ---------- Botões ---------- */
type Variant = 'primary' | 'ghost' | 'danger' | 'soft';
const buttonStyles = css<{ $variant?: Variant; $block?: boolean; $small?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: ${({ $small }) => ($small ? '38px' : '48px')};
  padding: 0 ${({ $small }) => ($small ? '14px' : '20px')};
  border-radius: ${({ theme }) => theme.radius.pill};
  font-weight: 650;
  font-size: ${({ $small }) => ($small ? '14px' : '15px')};
  border: 1px solid transparent;
  text-decoration: none;
  width: ${({ $block }) => ($block ? '100%' : 'auto')};
  transition:
    transform 0.12s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
  ${({ theme, $variant = 'primary' }) =>
    $variant === 'primary'
      ? css`
          background: ${theme.colors.accent};
          color: ${theme.colors.accentInk};
          &:hover:not(:disabled) {
            background: #d6ff5a;
          }
        `
      : $variant === 'danger'
        ? css`
            background: rgba(255, 122, 122, 0.14);
            color: ${theme.colors.danger};
            border-color: rgba(255, 122, 122, 0.35);
            &:hover:not(:disabled) {
              background: rgba(255, 122, 122, 0.22);
            }
          `
        : $variant === 'soft'
          ? css`
              background: ${theme.colors.accentSoft};
              color: ${theme.colors.accent};
              &:hover:not(:disabled) {
                background: rgba(200, 245, 66, 0.2);
              }
            `
          : css`
              background: transparent;
              color: ${theme.colors.text};
              border-color: ${theme.colors.borderStrong};
              &:hover:not(:disabled) {
                background: ${theme.colors.surface2};
              }
            `}
  &:active:not(:disabled) {
    transform: scale(0.98);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
export const ButtonBase = styled.button<{ $variant?: Variant; $block?: boolean; $small?: boolean }>`
  ${buttonStyles}
`;
export const LinkButton = styled.a<{ $variant?: Variant; $block?: boolean; $small?: boolean }>`
  ${buttonStyles}
`;

const spin = keyframes` to { transform: rotate(360deg); } `;
const Spinner = styled.span`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: ${spin} 0.7s linear infinite;
`;

export function Button({
  children,
  loading,
  icon,
  variant,
  block,
  small,
  disabled,
  ...rest
}: {
  children?: ReactNode;
  loading?: boolean;
  icon?: IconName;
  variant?: Variant;
  block?: boolean;
  small?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <ButtonBase
      $variant={variant}
      $block={block}
      $small={small}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </ButtonBase>
  );
}

export const IconButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  &:hover {
    background: ${({ theme }) => theme.colors.surface2};
  }
`;

/* ---------- Campos ---------- */
const FieldWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;
const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;
const Hint = styled.p<{ $error?: boolean }>`
  font-size: 13px;
  color: ${({ theme, $error }) => ($error ? theme.colors.danger : theme.colors.faint)};
`;

const controlCss = css`
  width: 100%;
  min-height: 48px;
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.surface2};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  transition: border-color 0.15s ease;
  &::placeholder {
    color: ${({ theme }) => theme.colors.faint};
  }
  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.colors.borderStrong};
  }
  &[aria-invalid='true'] {
    border-color: ${({ theme }) => theme.colors.danger};
  }
  &:disabled {
    opacity: 0.55;
  }
`;
const StyledInput = styled.input`
  ${controlCss}
`;
const StyledSelect = styled.select`
  ${controlCss} appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, #a1a496 50%),
    linear-gradient(135deg, #a1a496 50%, transparent 50%);
  background-position:
    calc(100% - 20px) 21px,
    calc(100% - 15px) 21px;
  background-size: 5px 5px;
  background-repeat: no-repeat;
  padding-right: 36px;
`;
const StyledTextarea = styled.textarea`
  ${controlCss} min-height: 88px;
  resize: vertical;
`;

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ label, hint, error, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <FieldWrap>
        <Label htmlFor={fid}>{label}</Label>
        <StyledInput
          ref={ref}
          id={fid}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? `${fid}-d` : undefined}
          {...rest}
        />
        {(error || hint) && (
          <Hint id={`${fid}-d`} $error={!!error} role={error ? 'alert' : undefined}>
            {error ?? hint}
          </Hint>
        )}
      </FieldWrap>
    );
  },
);

export function SelectField({
  label,
  hint,
  error,
  id,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap>
      <Label htmlFor={fid}>{label}</Label>
      <StyledSelect
        id={fid}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${fid}-d` : undefined}
        {...rest}
      >
        {children}
      </StyledSelect>
      {(error || hint) && (
        <Hint id={`${fid}-d`} $error={!!error} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </Hint>
      )}
    </FieldWrap>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  id,
  ...rest
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap>
      <Label htmlFor={fid}>{label}</Label>
      <StyledTextarea id={fid} aria-invalid={!!error || undefined} {...rest} />
      {(error || hint) && (
        <Hint $error={!!error} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </Hint>
      )}
    </FieldWrap>
  );
}

/** Campo monetário em R$: digita-se "1.234,56"; devolve centavos inteiros (ou null se vazio/ inválido). */
export function MoneyField({
  label,
  value,
  onChange,
  error,
  hint,
  id,
  required,
  disabled,
}: FieldProps & {
  value: Cents | null;
  onChange: (cents: Cents | null) => void;
  id?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : formatMoneyInput(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <TextField
      label={label}
      id={id}
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      required={required}
      disabled={disabled}
      value={text}
      hint={hint}
      error={error ?? (invalid ? 'Valor inválido. Use o formato 1.234,56' : null)}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const c = parseMoneyInput(t);
        setInvalid(t.trim() !== '' && c === null);
        onChange(c);
      }}
      onBlur={() => {
        const c = parseMoneyInput(text);
        if (c !== null) setText(formatMoneyInput(c));
      }}
    />
  );
}

export const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  cursor: pointer;
  font-size: 15px;
  input {
    width: 20px;
    height: 20px;
    accent-color: ${({ theme }) => theme.colors.accent};
  }
`;

export const FormGrid = styled.div`
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
  ${media.md} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    .span-2 {
      grid-column: span 2;
    }
  }
`;

export const FormError = styled.div`
  padding: 12px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: rgba(255, 122, 122, 0.1);
  border: 1px solid rgba(255, 122, 122, 0.35);
  color: ${({ theme }) => theme.colors.danger};
  font-size: 14px;
`;

/* ---------- Indicadores ---------- */
export const Pill = styled.span<{
  $tone?: 'default' | 'positive' | 'warning' | 'danger' | 'info' | 'accent';
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  background: ${({ theme, $tone = 'default' }) => ({ default: theme.colors.surface3, positive: 'rgba(139,224,164,0.14)', warning: 'rgba(255,200,87,0.14)', danger: 'rgba(255,122,122,0.14)', info: 'rgba(143,184,255,0.14)', accent: theme.colors.accentSoft })[$tone]};
  color: ${({ theme, $tone = 'default' }) => ({ default: theme.colors.muted, positive: theme.colors.positive, warning: theme.colors.warning, danger: theme.colors.danger, info: theme.colors.info, accent: theme.colors.accent })[$tone]};
`;

const Track = styled.div`
  height: 10px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.surface3};
  overflow: hidden;
`;
const Fill = styled.div<{ $pct: number; $tone: string }>`
  height: 100%;
  width: ${({ $pct }) => Math.min(100, Math.max(0, $pct))}%;
  border-radius: inherit;
  background: ${({ $tone }) => $tone};
  transition: width 0.4s ease;
`;
export function ProgressBar({
  pct,
  tone,
  label,
}: {
  pct: number;
  tone?: 'accent' | 'warning' | 'danger';
  label: string;
}) {
  const color = tone === 'danger' ? '#ff7a7a' : tone === 'warning' ? '#ffc857' : '#c8f542';
  return (
    <Track
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, pct))}
    >
      <Fill $pct={pct} $tone={color} />
    </Track>
  );
}

export const Money = styled.span<{ $tone?: 'auto' | 'positive' | 'negative' | 'plain'; $cents?: number }>`
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ theme, $tone = 'plain' }) => ($tone === 'positive' ? theme.colors.positive : $tone === 'negative' ? theme.colors.danger : 'inherit')};
`;
export function Amount({
  cents,
  signed,
  tone,
}: {
  cents: Cents;
  signed?: boolean;
  tone?: 'positive' | 'negative' | 'plain';
}) {
  const t = tone ?? 'plain';
  return (
    <Money $tone={t}>
      {signed && cents > 0 ? '+' : ''}
      {formatBRL(cents)}
    </Money>
  );
}

const shimmer = keyframes` 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } `;
export const Skeleton = styled.div<{ $h?: number; $w?: string }>`
  height: ${({ $h = 20 }) => $h}px;
  width: ${({ $w = '100%' }) => $w};
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    ${({ theme }) => theme.colors.surface2},
    ${({ theme }) => theme.colors.surface3},
    ${({ theme }) => theme.colors.surface2}
  );
  background-size: 400px 100%;
  animation: ${shimmer} 1.4s ease-in-out infinite;
`;

export function PageSkeleton() {
  return (
    <Stack $gap={16} aria-busy="true" aria-label="Carregando">
      <Skeleton $h={34} $w="40%" />
      <Skeleton $h={150} />
      <Grid>
        <Skeleton $h={120} />
        <Skeleton $h={120} />
      </Grid>
    </Stack>
  );
}

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 36px 20px;
  border: 1px dashed ${({ theme }) => theme.colors.borderStrong};
  border-radius: ${({ theme }) => theme.radius.lg};
  color: ${({ theme }) => theme.colors.muted};
  h3 {
    color: ${({ theme }) => theme.colors.text};
    font-size: 18px;
  }
  p {
    max-width: 42ch;
  }
`;
export function EmptyState({
  title,
  text,
  action,
  icon = 'spark',
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <Empty>
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </Empty>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Empty role="alert" style={{ borderColor: 'rgba(255,122,122,0.4)' }}>
      <Icon name="alert" size={28} />
      <h3>Não foi possível carregar</h3>
      <p>{message}</p>
      {onRetry && (
        <Button variant="ghost" icon="refresh" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </Empty>
  );
}

/* ---------- Cabeçalho de página ---------- */
const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 4px;
  h1 {
    font-size: 30px;
    ${media.md} {
      font-size: 36px;
    }
  }
`;
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Head>
      <Stack $gap={4}>
        <h1>{title}</h1>
        {subtitle && <Muted>{subtitle}</Muted>}
      </Stack>
      {actions && <Row $wrap>{actions}</Row>}
    </Head>
  );
}

/* ---------- Segmented ---------- */
const SegWrap = styled.div`
  display: inline-flex;
  padding: 4px;
  gap: 2px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  max-width: 100%;
  overflow-x: auto;
`;
const SegBtn = styled.button<{ $on: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 8px 16px;
  min-height: 38px;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  background: ${({ theme, $on }) => ($on ? theme.colors.accent : 'transparent')};
  color: ${({ theme, $on }) => ($on ? theme.colors.accentInk : theme.colors.muted)};
  transition:
    background 0.15s ease,
    color 0.15s ease;
`;
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <SegWrap role="group" aria-label={label}>
      {options.map((o) => (
        <SegBtn
          key={o.value}
          type="button"
          $on={o.value === value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </SegBtn>
      ))}
    </SegWrap>
  );
}

/* ---------- Lista ---------- */
export const ListItem = styled.li`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  min-width: 0;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.border};
  }
`;
export const PlainList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;
