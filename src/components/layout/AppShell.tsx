import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../../features/auth/AuthProvider';
import { useHousehold, type ViewKey } from '../../features/household/HouseholdProvider';
import { media } from '../../styles/theme';
import { useToast } from '../feedback/Toast';
import { Icon, type IconName } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { PierreMascot } from '../ui/PierreMascot';
import { Row, Segmented, Stack } from '../ui/primitives';
import { friendlyError } from '../../services/supabase/errors';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}
export const NAV: NavItem[] = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/movimentacoes', label: 'Movimentações', icon: 'list' },
  { to: '/contas', label: 'Contas', icon: 'wallet' },
  { to: '/cartoes', label: 'Cartões', icon: 'card' },
  { to: '/orcamentos', label: 'Orçamentos', icon: 'target' },
  { to: '/planejamento', label: 'Planejamento', icon: 'calendar' },
  { to: '/relatorios', label: 'Relatórios', icon: 'chart' },
  { to: '/pierre', label: 'Pierre', icon: 'spark' },
  { to: '/configuracoes', label: 'Configurações', icon: 'gear' },
];
const MOBILE_MAIN = ['/', '/movimentacoes', '/cartoes', '/pierre'];

const Frame = styled.div`
  min-height: 100dvh;
  display: block;
  ${media.md} {
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
  }
`;
const Side = styled.aside`
  display: none;
  ${media.md} {
    display: flex;
    flex-direction: column;
    gap: 24px;
    position: sticky;
    top: 0;
    height: 100dvh;
    padding: 28px 18px;
    border-right: 1px solid ${({ theme }) => theme.colors.border};
  }
`;
const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.02em;
`;
const SideNav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const link = `
  display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 0 14px; border-radius: 14px; text-decoration: none; font-weight: 600; font-size: 15px;
`;
const SideLink = styled(NavLink)`
  ${link} color: ${({ theme }) => theme.colors.muted};
  &:hover {
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.text};
  }
  &.active {
    background: ${({ theme }) => theme.colors.accentSoft};
    color: ${({ theme }) => theme.colors.accent};
  }
`;
const Main = styled.main`
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: calc(20px + env(safe-area-inset-top)) 16px calc(112px + env(safe-area-inset-bottom));
  ${media.md} {
    padding: 36px 40px 64px;
  }
`;
const Top = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
`;
const MobileBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  ${media.md} {
    display: none;
  }
`;
const Bottom = styled.nav`
  position: fixed;
  z-index: 30;
  left: 12px;
  right: 12px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: space-around;
  padding: 6px;
  border-radius: 26px;
  background: rgba(21, 22, 19, 0.88);
  backdrop-filter: blur(16px);
  border: 1px solid ${({ theme }) => theme.colors.borderStrong};
  box-shadow: ${({ theme }) => theme.shadow.pop};
  ${media.md} {
    display: none;
  }
`;
const tab = `
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 56px; border-radius: 20px;
  font-size: 11px; font-weight: 650; text-decoration: none; background: none; border: 0;
`;
const BottomLink = styled(NavLink)`
  ${tab} color: ${({ theme }) => theme.colors.muted};
  &.active {
    color: ${({ theme }) => theme.colors.accent};
    background: ${({ theme }) => theme.colors.accentSoft};
  }
`;
const BottomBtn = styled.button`
  ${tab} color: ${({ theme }) => theme.colors.muted};
`;
const SideFoot = styled.div`
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;
const FootBtn = styled.button`
  ${link} background: none;
  border: 0;
  color: ${({ theme }) => theme.colors.muted};
  width: 100%;
  &:hover {
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.text};
  }
`;
const MoreLink = styled(NavLink)`
  ${link} color: ${({ theme }) => theme.colors.text};
  background: ${({ theme }) => theme.colors.surface2};
  &.active {
    color: ${({ theme }) => theme.colors.accent};
  }
`;

export function AppShell() {
  const { signOut, user } = useAuth();
  const { viewKey, setViewKey, partner, me, household } = useHousehold();
  const toast = useToast();
  const [more, setMore] = useState(false);

  const logout = async () => {
    try {
      await signOut();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const viewOptions: Array<{ value: ViewKey; label: string }> = [
    { value: 'joint', label: 'Casal' },
    { value: 'me', label: me?.displayName ?? 'Eu' },
    ...(partner ? [{ value: 'partner' as ViewKey, label: partner.displayName }] : []),
  ];

  return (
    <Frame>
      <Side aria-label="Navegação principal">
        <Brand>
          <PierreMascot size={36} animate={false} />
          Pierre Casa
        </Brand>
        <SideNav>
          {NAV.map((n) => (
            <SideLink key={n.to} to={n.to} end={n.end}>
              <Icon name={n.icon} />
              {n.label}
            </SideLink>
          ))}
        </SideNav>
        <SideFoot>
          <span style={{ padding: '0 14px' }}>
            {household?.name}
            <br />
            <small>{user?.email}</small>
          </span>
          <FootBtn type="button" onClick={logout}>
            <Icon name="logout" />
            Sair
          </FootBtn>
        </SideFoot>
      </Side>

      <Main>
        <Top>
          <MobileBrand>
            <PierreMascot size={30} animate={false} />
            Pierre Casa
          </MobileBrand>
          <Segmented label="Visão" value={viewKey} onChange={setViewKey} options={viewOptions} />
        </Top>
        <Outlet />
      </Main>

      <Bottom aria-label="Navegação">
        {MOBILE_MAIN.map((to) => {
          const n = NAV.find((x) => x.to === to)!;
          return (
            <BottomLink key={to} to={to} end={n.end}>
              <Icon name={n.icon} />
              {n.label === 'Movimentações' ? 'Movim.' : n.label}
            </BottomLink>
          );
        })}
        <BottomBtn type="button" onClick={() => setMore(true)} aria-haspopup="dialog">
          <Icon name="more" />
          Mais
        </BottomBtn>
      </Bottom>

      {more && (
        <Modal title="Mais opções" onClose={() => setMore(false)}>
          <Stack $gap={8}>
            {NAV.filter((n) => !MOBILE_MAIN.includes(n.to)).map((n) => (
              <MoreLink key={n.to} to={n.to} onClick={() => setMore(false)}>
                <Icon name={n.icon} />
                {n.label}
              </MoreLink>
            ))}
            <MoreLink to="/importar" onClick={() => setMore(false)}>
              <Icon name="upload" />
              Importar extrato
            </MoreLink>
            <Row>
              <FootBtn type="button" onClick={logout}>
                <Icon name="logout" />
                Sair
              </FootBtn>
            </Row>
          </Stack>
        </Modal>
      )}
    </Frame>
  );
}
