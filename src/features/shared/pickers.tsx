import type { ReactNode } from 'react';
import type { Account, Category, CreditCard } from '../../domain/types';
import { SelectField } from '../../components/ui/primitives';
import { useHousehold } from '../household/HouseholdProvider';

/** Categorias com subcategorias indentadas, só as ativas do tipo pedido (mais a atualmente selecionada). */
export function categoryOptions(
  cats: readonly Category[],
  kind: Category['kind'] | 'any',
  keepId?: string | null,
): ReactNode {
  const ok = (c: Category) => (kind === 'any' || c.kind === kind) && (c.isActive || c.id === keepId);
  const roots = cats.filter((c) => c.parentId === null && ok(c));
  return roots.flatMap((r) => [
    <option key={r.id} value={r.id}>
      {r.name}
    </option>,
    ...cats
      .filter((c) => c.parentId === r.id && ok(c))
      .map((c) => <option key={c.id} value={c.id}>{`— ${c.name}`}</option>),
  ]);
}

export function CategorySelect({
  label = 'Categoria',
  value,
  onChange,
  kind,
  allowEmpty = true,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  kind: Category['kind'] | 'any';
  allowEmpty?: boolean;
  error?: string | null;
}) {
  const { data } = useHousehold();
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
      {allowEmpty && <option value="">Sem categoria</option>}
      {!allowEmpty && (
        <option value="" disabled>
          Escolha…
        </option>
      )}
      {categoryOptions(data?.categories ?? [], kind, value)}
    </SelectField>
  );
}

export function accountLabel(a: Account, nameOf: (id: string) => string) {
  return `${a.name} · ${nameOf(a.ownerId)}`;
}
export function cardLabel(c: CreditCard, nameOf: (id: string) => string) {
  return `${c.name}${c.lastFour ? ` ••${c.lastFour}` : ''} · ${nameOf(c.ownerId)}`;
}

/** Contas ativas; `mineOnly` restringe às do usuário atual (é o que o servidor aceita para lançar). */
export function AccountSelect({
  label = 'Conta',
  value,
  onChange,
  mineOnly,
  allowEmpty,
  error,
  exclude,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  mineOnly?: boolean;
  allowEmpty?: boolean;
  error?: string | null;
  exclude?: string;
}) {
  const { data, me, nameOf } = useHousehold();
  const list = (data?.accounts ?? []).filter(
    (a) => (a.isActive || a.id === value) && a.id !== exclude && (!mineOnly || a.ownerId === me?.userId),
  );
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
      {allowEmpty ? (
        <option value="">Todas</option>
      ) : (
        <option value="" disabled>
          Escolha…
        </option>
      )}
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a, nameOf)}
        </option>
      ))}
    </SelectField>
  );
}

export function CardSelect({
  label = 'Cartão',
  value,
  onChange,
  mineOnly,
  allowEmpty,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  mineOnly?: boolean;
  allowEmpty?: boolean;
  error?: string | null;
}) {
  const { data, me, nameOf } = useHousehold();
  const list = (data?.cards ?? []).filter(
    (c) => (c.isActive || c.id === value) && (!mineOnly || c.ownerId === me?.userId),
  );
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
      {allowEmpty ? (
        <option value="">Todos</option>
      ) : (
        <option value="" disabled>
          Escolha…
        </option>
      )}
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {cardLabel(c, nameOf)}
        </option>
      ))}
    </SelectField>
  );
}
