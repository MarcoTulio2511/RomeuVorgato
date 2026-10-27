const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H19v14H6.5A2.5 2.5 0 0 1 4 16.5v-9ZM16 12h3',
  card: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 5h14M8 3v4m8-4v4',
  chart: 'M4 19V5m0 14h16M8 16v-5m4 5V8m4 8v-3',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-2.5.1-1-.1-1 1.8-1.4-1.7-3-2.1.8a7 7 0 0 0-1.7-1L15.3 4h-3.4l-.4 2.4a7 7 0 0 0-1.7 1l-2.1-.8-1.7 3L7.8 11l-.1 1 .1 1-1.8 1.4 1.7 3 2.1-.8a7 7 0 0 0 1.7 1l.4 2.4h3.4l.4-2.4a7 7 0 0 0 1.7-1l2.1.8 1.7-3-1.8-1.4Z',
  plus: 'M12 5v14M5 12h14',
  search: 'm20 20-3.5-3.5M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  chevron: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M5 20h14',
  download: 'M12 4v12m0 0 5-5m-5 5-5-5M5 20h14',
  trash: 'M5 7h14M10 11v6m4-6v6M7 7l1 12h8l1-12M9 7V4h6v3',
  edit: 'm4 20 4-1 11-11-3-3L5 16l-1 4Z',
  arrows: 'M7 7h13m0 0-3-3m3 3-3 3M17 17H4m0 0 3-3m-3 3 3 3',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  alert: 'M12 4 2.8 19.5h18.4L12 4Zm0 6v5m0 3h.01',
  refresh: 'M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
