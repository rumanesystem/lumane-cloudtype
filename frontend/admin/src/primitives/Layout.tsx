import type { ReactNode } from 'react';

export type NavigationProps = {
  brand: { href: string; label: string };
  items: Array<{ current?: boolean; href: string; label: string }>;
};

export function Navigation({ brand, items }: NavigationProps) {
  return (
    <nav className="navigation" aria-label="관리자 메뉴">
      <a className="navigation__brand" href={brand.href}>{brand.label}</a>
      {items.map((item) => <a key={`${item.href}-${item.label}`} aria-current={item.current ? 'page' : undefined} href={item.href}>{item.label}</a>)}
    </nav>
  );
}

export function AppShell({ children, navigation }: { children: ReactNode; navigation: NavigationProps }) {
  return <div className="app-shell"><Navigation {...navigation} /><main id="overview">{children}</main></div>;
}

export function ListDetailLayout({ ariaLabel, detail, list }: { ariaLabel: string; detail: ReactNode; list: ReactNode }) {
  return <section className="list-detail" aria-label={ariaLabel}><div className="list-detail__list">{list}</div><article className="list-detail__detail">{detail}</article></section>;
}
