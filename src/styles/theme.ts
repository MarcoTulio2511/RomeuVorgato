/** Tokens visuais: carvão + cinza-escuro + verde-limão. */
export const theme = {
  colors: {
    bg: '#0b0c0a',
    surface: '#151613',
    surface2: '#1d1e1a',
    surface3: '#272822',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    text: '#f3f4ee',
    muted: '#a1a496',
    faint: '#6d7065',
    accent: '#c8f542',
    accentInk: '#10130a',
    accentSoft: 'rgba(200,245,66,0.12)',
    positive: '#8be0a4',
    warning: '#ffc857',
    danger: '#ff7a7a',
    info: '#8fb8ff',
    overlay: 'rgba(5,6,4,0.72)',
  },
  radius: { sm: '10px', md: '16px', lg: '24px', xl: '32px', pill: '999px' },
  font: {
    body: `ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
    display: `ui-rounded, "SF Pro Rounded", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  },
  shadow: {
    card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.8)',
    pop: '0 24px 60px -20px rgba(0,0,0,0.9)',
  },
  chart: ['#c8f542', '#8fb8ff', '#ffc857', '#c39bff', '#7be0c3', '#ff9f7a', '#9aa3ff', '#e0a97a'],
} as const;

export type AppTheme = typeof theme;

export const media = {
  md: '@media (min-width: 880px)',
  lg: '@media (min-width: 1180px)',
  sm: '@media (max-width: 560px)',
} as const;
