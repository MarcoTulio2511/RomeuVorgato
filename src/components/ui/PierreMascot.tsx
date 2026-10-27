import styled, { keyframes } from 'styled-components';

const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
`;

const Wrap = styled.span<{ $size: number; $animate: boolean }>`
  display: inline-grid;
  place-items: center;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  flex: none;
  svg {
    animation: ${({ $animate }) => ($animate ? bob : 'none')} 4s ease-in-out infinite;
  }
`;

export type PierreMood = 'happy' | 'worried' | 'calm';

/** Pierre: um seixo-moeda verde-limão com olhos curiosos. Identidade própria, desenhada em SVG. */
export function PierreMascot({
  size = 48,
  mood = 'happy',
  animate = true,
}: {
  size?: number;
  mood?: PierreMood;
  animate?: boolean;
}) {
  const mouth =
    mood === 'happy' ? 'M20 35 Q28 42 36 35' : mood === 'worried' ? 'M21 39 Q28 33 35 39' : 'M22 37 H34';
  return (
    <Wrap $size={size} $animate={animate} role="img" aria-label="Pierre, o assistente financeiro">
      <svg viewBox="0 0 56 56" width={size} height={size}>
        <defs>
          <radialGradient id="pierre-body" cx="35%" cy="28%" r="80%">
            <stop offset="0" stopColor="#e4ff8a" />
            <stop offset="1" stopColor="#b6e02f" />
          </radialGradient>
        </defs>
        <path d="M28 4c13 0 23 9 23 23 0 15-10 25-23 25S5 42 5 27C5 13 15 4 28 4Z" fill="url(#pierre-body)" />
        <circle cx="28" cy="10" r="4" fill="#10130a" opacity="0.14" />
        <ellipse cx="21" cy="24" rx="3.6" ry="4.4" fill="#10130a" />
        <ellipse cx="35" cy="24" rx="3.6" ry="4.4" fill="#10130a" />
        <circle cx="22.2" cy="22.6" r="1.2" fill="#fff" />
        <circle cx="36.2" cy="22.6" r="1.2" fill="#fff" />
        <path d={mouth} fill="none" stroke="#10130a" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </Wrap>
  );
}
