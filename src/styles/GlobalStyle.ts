import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; color-scheme: dark; }
  body {
    margin: 0;
    background: ${({ theme }) => theme.colors.bg};
    background-image:
      radial-gradient(900px 500px at 85% -10%, rgba(200,245,66,0.07), transparent 60%),
      radial-gradient(700px 400px at -10% 110%, rgba(143,184,255,0.05), transparent 60%);
    background-attachment: fixed;
    color: ${({ theme }) => theme.colors.text};
    font-family: ${({ theme }) => theme.font.body};
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    min-height: 100dvh;
  }
  h1, h2, h3, h4, p { margin: 0; }
  h1, h2, h3 { font-family: ${({ theme }) => theme.font.display}; letter-spacing: -0.02em; line-height: 1.15; }
  button, input, select, textarea { font: inherit; color: inherit; }
  /* 16px evita o zoom automático de campos no iPhone */
  input, select, textarea { font-size: 16px; }
  button { cursor: pointer; }
  a { color: ${({ theme }) => theme.colors.accent}; }
  :focus-visible { outline: 2px solid ${({ theme }) => theme.colors.accent}; outline-offset: 2px; border-radius: 6px; }
  ::selection { background: ${({ theme }) => theme.colors.accent}; color: ${({ theme }) => theme.colors.accentInk}; }
  table { border-collapse: collapse; width: 100%; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
`;
