import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { GlobalHeaderStatus } from './GlobalHeaderStatus';

export type WorkspaceArea = 'home' | 'conversations' | 'quotes' | 'analytics' | 'data';

export type WorkspaceIconName = 'home' | 'messages' | 'quotes' | 'analytics' | 'data';

const areas: Array<{ id: WorkspaceArea; label: string; description: string; icon: WorkspaceIconName }> = [
  { id: 'home', label: '대시보드', description: '업무 현황', icon: 'home' },
  { id: 'conversations', label: '상담 관리', description: '고객 응대', icon: 'messages' },
  { id: 'quotes', label: '견적 관리', description: '접수 및 조회', icon: 'quotes' },
  { id: 'analytics', label: '운영 분석', description: '성과와 비용', icon: 'analytics' },
  { id: 'data', label: '데이터 관리', description: '복원 및 백업', icon: 'data' },
];

function getStoredCollapsePreference() {
  try {
    return window.localStorage.getItem('admin-sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

function saveCollapsePreference(value: boolean) {
  try {
    window.localStorage.setItem('admin-sidebar-collapsed', String(value));
  } catch {
    // Storage can be disabled by browser privacy settings. The in-memory state still works.
  }
}

export function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  const paths: Record<WorkspaceIconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></>,
    messages: <><path d="M5 5h14v10H9l-4 4V5Z" /><path d="M8 9h8M8 12h5" /></>,
    quotes: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4M9 11h6M9 15h6" /></>,
    analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    data: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></>,
  };

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function WorkspaceShell({ active, children, onChange }: { active: WorkspaceArea; children: ReactNode; onChange: (area: WorkspaceArea) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(getStoredCollapsePreference);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia?.('(max-width: 768px)').matches ?? false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const current = areas.find((area) => area.id === active)!;
  const select = (area: WorkspaceArea) => { onChange(area); setMobileOpen(false); };
  const toggleCollapsed = () => {
    setCollapsed((currentValue) => {
      const nextValue = !currentValue;
      saveCollapsePreference(nextValue);
      return nextValue;
    });
  };

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.classList.add('has-mobile-menu');
    sidebarRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('has-mobile-menu');
      document.removeEventListener('keydown', closeOnEscape);
      menuButtonRef.current?.focus();
    };
  }, [mobileOpen]);

  const trapSidebarFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!mobileOpen || event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className={`workspace-shell ${collapsed ? 'is-sidebar-collapsed' : ''}`}>
    <aside ref={sidebarRef} id="workspace-navigation" className={`workspace-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="관리자 업무 영역" aria-modal={isMobile && mobileOpen ? true : undefined} inert={isMobile && !mobileOpen ? true : undefined} onKeyDown={trapSidebarFocus} role={isMobile && mobileOpen ? 'dialog' : undefined}>
      <div className="workspace-brand"><span className="workspace-brand__mark" aria-hidden="true">K</span><span className="workspace-brand__copy"><strong>Kate Blanc</strong><small>ADMIN</small></span></div>
      <nav>{areas.map((area) => <button key={area.id} title={collapsed && !isMobile ? area.label : undefined} aria-label={area.label} aria-current={active === area.id ? 'page' : undefined} onClick={() => select(area.id)}><span className="workspace-nav-icon"><WorkspaceIcon name={area.icon} /></span><span className="workspace-nav-copy"><strong>{area.label}</strong><small>{area.description}</small></span></button>)}</nav>
      <div className="workspace-sidebar__footer"><a href="/admin"><span aria-hidden="true">↗</span><span className="workspace-nav-copy">기존 관리자</span></a>{!isMobile && <button type="button" className="workspace-collapse" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} title={collapsed ? '사이드바 펼치기' : '사이드바 접기'} onClick={toggleCollapsed}><span aria-hidden="true">{collapsed ? '›' : '‹'}</span></button>}</div>
    </aside>
    {mobileOpen && <button className="workspace-backdrop" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
    <div className="workspace-main">
      <header className="workspace-header"><button ref={menuButtonRef} className="workspace-menu" aria-label="메뉴 열기" aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>☰</button><div className="workspace-header__title"><h1>{current.label}</h1><span>{current.description}</span></div><div className="workspace-header__actions"><a href="/chat.html" target="_blank" rel="noreferrer">고객 채팅 ↗</a><a href="/" target="_blank" rel="noreferrer">사이트 보기 ↗</a></div><GlobalHeaderStatus /></header>
      <main id="workspace-content" className="workspace-content">{children}</main>
    </div>
  </div>;
}

export function MigrationPanel({ children, legacyHref, legacyLabel, title }: { children: ReactNode; legacyHref: string; legacyLabel: string; title: string }) {
  return <section className="migration-panel"><div><p className="eyebrow">기능 정리 중</p><h2>{title}</h2>{children}</div><a className="button button--secondary" href={legacyHref}>기존 화면에서 {legacyLabel}</a></section>;
}
