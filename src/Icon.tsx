import type { ReactNode } from 'react';
export type IconName = 'home' | 'check' | 'calendar' | 'clock' | 'report' | 'database' | 'plus' | 'play' | 'stop' | 'edit' | 'trash' | 'search' | 'left' | 'right' | 'download' | 'upload' | 'close';
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></>,
  check: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  report: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, play: <path d="m8 5 11 7-11 7z"/>, stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16zM13 7l4 4"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m4 0-1 13H6L5 7M10 11v6m4-6v6"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  left: <path d="m15 5-7 7 7 7"/>, right: <path d="m9 5 7 7-7 7"/>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 17v4h16v-4"/></>,
  close: <path d="M5 5l14 14M19 5 5 19"/>,
};
export default function Icon({ name, size = 19 }: { name: IconName; size?: number }) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>; }
