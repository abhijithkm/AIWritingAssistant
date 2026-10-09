import type { ReactNode } from 'react';

function Icon({ children, fill = 'none' }: { children: ReactNode; fill?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={fill} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function SparkleIcon() {
  return <Icon fill="currentColor"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></Icon>;
}

export function GearIcon() {
  return (
    <Icon>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function MicIcon() {
  return (
    <Icon>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </Icon>
  );
}

export function SidePanelIcon() {
  return <Icon><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></Icon>;
}

export function WindowIcon() {
  return <Icon><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M2 8h20" /><path d="M6 4v4" /><path d="M10 4v4" /></Icon>;
}

export function CloseIcon() {
  return <Icon><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
}

export function ChevronLeftIcon() {
  return <Icon><path d="m15 18-6-6 6-6" /></Icon>;
}
