import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/live/LiveAdmin', () => ({
  LiveAdmin: () => <label>상담 답장<textarea /></label>,
}));

vi.mock('../src/features/quotes', () => ({
  QuoteWorkspace: () => <label>견적 검색<input /></label>,
}));

vi.mock('../src/features/home/OperationalHome', () => ({
  OperationalHome: ({ onOpen }: { onOpen: (area: 'conversations' | 'quotes') => void }) => <><h2>운영 홈</h2><button onClick={() => onOpen('conversations')}>진행 중 상담</button><button onClick={() => onOpen('quotes')}>견적 후속 업무</button></>,
}));

import { AdminApp } from '../src/AdminApp';

describe('Admin workspace', () => {
  beforeEach(() => window.localStorage.clear());

  it('groups the curated business areas without duplicating primary navigation', () => {
    render(<AdminApp />);
    const navigation = screen.getByRole('navigation');
    expect(navigation).toHaveTextContent('대시보드');
    expect(navigation).toHaveTextContent('상담 관리');
    expect(navigation).toHaveTextContent('견적 관리');
    expect(navigation).toHaveTextContent('운영 분석');
    expect(navigation).toHaveTextContent('데이터 관리');
    expect(screen.getAllByRole('button', { name: /견적/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '견적 관리' }));
    expect(screen.getByRole('heading', { name: '견적 관리', level: 2 })).toBeVisible();
    expect(screen.getByLabelText('견적 검색')).toBeVisible();
  });

  it('opens and closes the mobile navigation without changing the active area', () => {
    render(<AdminApp />);
    fireEvent.click(screen.getByRole('button', { name: '메뉴 열기' }));
    expect(screen.getByRole('button', { name: '메뉴 닫기' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '메뉴 닫기' }));
    expect(screen.queryByRole('button', { name: '메뉴 닫기' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '운영 홈' })).toBeVisible();
  });

  it('keeps conversation state while moving between workspace areas', () => {
    render(<AdminApp />);
    fireEvent.click(screen.getByRole('button', { name: '진행 중 상담' }));
    const reply = screen.getByLabelText('상담 답장');
    fireEvent.change(reply, { target: { value: '작성 중인 답장' } });
    fireEvent.click(screen.getByRole('button', { name: '견적 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '상담 관리' }));
    expect(screen.getByLabelText('상담 답장')).toHaveValue('작성 중인 답장');
  });

  it('lazy mounts the quote workspace and retains its state after navigation', () => {
    render(<AdminApp />);
    expect(screen.queryByLabelText('견적 검색')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '견적 관리' }));
    fireEvent.change(screen.getByLabelText('견적 검색'), { target: { value: 'KB-1004' } });
    fireEvent.click(screen.getByRole('button', { name: '상담 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '견적 관리' }));
    expect(screen.getByLabelText('견적 검색')).toHaveValue('KB-1004');
  });

  it('closes the mobile navigation with Escape and restores page scrolling', () => {
    render(<AdminApp />);
    fireEvent.click(screen.getByRole('button', { name: '메뉴 열기' }));
    expect(document.body).toHaveClass('has-mobile-menu');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '메뉴 닫기' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass('has-mobile-menu');
  });

  it('exposes a modal mobile drawer and unlocks scrolling when the viewport becomes desktop', () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    let matches = true;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() { return matches; },
        media: '(max-width: 768px)',
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });

    try {
      const view = render(<AdminApp />);
      const menuButton = screen.getByRole('button', { name: '메뉴 열기' });
      fireEvent.click(menuButton);
      expect(screen.getByRole('dialog', { name: '관리자 업무 영역' })).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('button', { name: '대시보드' })).toHaveFocus();
      expect(document.body).toHaveClass('has-mobile-menu');

      act(() => {
        matches = false;
        listeners.forEach((listener) => listener());
      });
      expect(screen.queryByRole('dialog', { name: '관리자 업무 영역' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '메뉴 닫기' })).not.toBeInTheDocument();
      expect(document.body).not.toHaveClass('has-mobile-menu');
      expect(menuButton).toHaveFocus();
      view.unmount();
    } finally {
      if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('persists the desktop sidebar collapse preference', () => {
    const firstRender = render(<AdminApp />);
    fireEvent.click(screen.getByRole('button', { name: '사이드바 접기' }));
    expect(window.localStorage.getItem('admin-sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: '사이드바 펼치기' })).toBeVisible();
    firstRender.unmount();
    render(<AdminApp />);
    expect(screen.getByRole('button', { name: '사이드바 펼치기' })).toBeVisible();
  });

  it('keeps the sidebar usable when browser storage is unavailable', () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('Storage disabled'); } });

    try {
      const view = render(<AdminApp />);
      fireEvent.click(screen.getByRole('button', { name: '사이드바 접기' }));
      expect(screen.getByRole('button', { name: '사이드바 펼치기' })).toBeVisible();
      view.unmount();
    } finally {
      if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor);
    }
  });
});
