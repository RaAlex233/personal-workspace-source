import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import Icon from './Icon';

export function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="panel-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}
export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="leaf" size={25}/></span><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const modal = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = modal.current;
    const elements = () => Array.from(target?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]') ?? []);
    (target?.querySelector<HTMLElement>('[data-autofocus]') ?? elements()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const list = elements(); const first = list[0]; const last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className="modal" ref={modal} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="关闭"><Icon name="close"/></button></header>{children}</div></div>;
}
export const urgencyLabels = { longterm: '长期', shortterm: '短期', urgent: '紧急' };
export const displayDateTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const displayMinutes = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟` : `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
