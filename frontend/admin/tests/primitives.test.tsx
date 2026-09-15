import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { createRef, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Showcase } from '../src/Showcase';
import { AppShell, Button, Dialog, ErrorSummary, Feedback, FormField, ListDetailLayout, SelectField, TextareaField, ToastRegion } from '../src/primitives';

describe('Button', () => {
  it('exposes loading state and prevents duplicate actions', () => {
    const { rerender } = render(<Button onClick={vi.fn()}>저장하기</Button>);
    const before = screen.getByRole('button', { name: '저장하기' });
    expect(before.querySelector('.button__content')).toHaveTextContent('저장하기');
    rerender(<Button loading onClick={vi.fn()}>저장하기</Button>);
    const button = screen.getByRole('button', { name: '처리 중…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.button__content--loading')).toHaveTextContent('저장하기');
    expect(button.querySelector('.button__loading')).toHaveTextContent('처리 중…');
  });

  it('provides a focus, hover, and touch accessible tooltip for icon-only controls', () => {
    const action = vi.fn();
    render(<Button iconOnly accessibleName="더보기" onClick={action}>•••</Button>);
    const button = screen.getByRole('button', { name: '더보기' });
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).not.toBeVisible();
    fireEvent.focus(button);
    expect(tooltip).toBeVisible();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(tooltip).not.toBeVisible();
    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(tooltip).not.toBeVisible();
    fireEvent.mouseEnter(button.parentElement!);
    expect(tooltip).toBeVisible();
    fireEvent.mouseLeave(button.parentElement!);
    fireEvent.touchStart(button.parentElement!);
    expect(tooltip).toBeVisible();
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    fireEvent.touchStart(button.parentElement!);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    expect(tooltip).not.toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
  });
});

describe('Form primitives', () => {
  it('wires label, description, invalid state, and error', () => {
    render(<FormField label="전화번호" description="연락 가능한 번호" error="필수 항목입니다" />);
    const input = screen.getByLabelText('전화번호');
    expect(input).toHaveAccessibleDescription('연락 가능한 번호 필수 항목입니다');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('reuses the field accessibility contract for textarea and select controls', () => {
    render(<><TextareaField label="상담 메모" description="내부 메모" error="메모를 입력하세요" /><SelectField label="상담 상태" description="현재 처리 단계" error="상태를 선택하세요"><option value="">선택</option></SelectField></>);
    const textarea = screen.getByLabelText('상담 메모');
    const select = screen.getByLabelText('상담 상태');
    expect(textarea).toHaveAccessibleDescription('내부 메모 메모를 입력하세요');
    expect(select).toHaveAccessibleDescription('현재 처리 단계 상태를 선택하세요');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });

  it('merges caller-provided ARIA relationships and invalid state', () => {
    render(<><span id="external-help">외부 도움말</span><FormField label="카드" aria-describedby="external-help" description="내부 도움말" aria-invalid="spelling" /><TextareaField label="메모" aria-describedby="external-help" /><SelectField label="상태" aria-invalid><option>선택</option></SelectField></>);
    expect(screen.getByLabelText('카드')).toHaveAccessibleDescription('외부 도움말 내부 도움말');
    expect(screen.getByLabelText('카드')).toHaveAttribute('aria-invalid', 'spelling');
    expect(screen.getByLabelText('메모')).toHaveAttribute('aria-describedby', 'external-help');
    expect(screen.getByLabelText('상태')).toHaveAttribute('aria-invalid', 'true');
  });

  it('allows the error summary to receive programmatic focus', () => {
    const summaryRef = createRef<HTMLElement>();
    const fieldRef = createRef<HTMLInputElement>();
    render(<><input id="customer-name" ref={fieldRef} /><ErrorSummary ref={summaryRef} errors={[{ fieldId: 'customer-name', fieldRef, message: '이름을 입력하세요' }]} /></>);
    summaryRef.current?.focus();
    expect(screen.getByRole('alert')).toHaveFocus();
    const link = screen.getByRole('link', { name: '이름을 입력하세요' });
    expect(link).toHaveAttribute('href', '#customer-name');
    expect(link).toHaveAttribute('aria-controls', 'customer-name');
    fireEvent.click(link);
    expect(fieldRef.current).toHaveFocus();
  });
});

function DialogFixture() {
  const [open, setOpen] = useState(false);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  return <><button onClick={() => setOpen(true)}>열기</button><Dialog open={open} onClose={() => setOpen(false)} title="메모" initialFocusRef={initialFocusRef}><FormField ref={initialFocusRef} label="메모 내용" /><button onClick={() => setOpen(false)}>닫기</button></Dialog></>;
}

describe('Dialog', () => {
  it('names the modal, traps and contains focus, closes with Escape, and restores focus', async () => {
    render(<DialogFixture />);
    const trigger = screen.getByRole('button', { name: '열기' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '메모' });
    const input = screen.getByLabelText('메모 내용');
    const close = screen.getByRole('button', { name: '닫기' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(document.body).toHaveClass('has-dialog');
    trigger.focus();
    await waitFor(() => expect(input).toHaveFocus());
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveClass('has-dialog');
  });

  it('focuses and traps Tab on the dialog container when it has no focusable descendants', async () => {
    function NoFocusableFixture() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>빈 대화상자 열기</button><Dialog open={open} onClose={() => setOpen(false)} title="안내"><p>확인할 내용입니다.</p></Dialog></>;
    }
    render(<NoFocusableFixture />);
    const trigger = screen.getByRole('button', { name: '빈 대화상자 열기' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '안내' });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog).toHaveFocus();
    trigger.focus();
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('ignores hidden or external initial focus targets and uses the first usable control', async () => {
    function InvalidInitialFocusFixture({ external = false }: { external?: boolean }) {
      const externalRef = useRef<HTMLInputElement>(null);
      const hiddenRef = useRef<HTMLInputElement>(null);
      return <><input ref={externalRef} aria-label="외부 입력" /><Dialog open onClose={() => undefined} title="초기 포커스" initialFocusRef={external ? externalRef : hiddenRef}><div hidden><input ref={hiddenRef} aria-label="숨김 입력" /></div><button>사용 가능한 동작</button></Dialog></>;
    }
    const { rerender } = render(<InvalidInitialFocusFixture />);
    await waitFor(() => expect(screen.getByRole('button', { name: '사용 가능한 동작' })).toHaveFocus());
    rerender(<InvalidInitialFocusFixture external />);
    await waitFor(() => expect(screen.getByRole('button', { name: '사용 가능한 동작' })).toHaveFocus());
  });

  it('excludes inert ancestors and tabindex -1 descendants from initial focus and the Tab cycle', async () => {
    function InertFixture() {
      const inertRef = useRef<HTMLInputElement>(null);
      return <Dialog open onClose={() => undefined} title="비활성 포커스" initialFocusRef={inertRef}><div inert><fieldset disabled><input ref={inertRef} aria-label="비활성 입력" /></fieldset></div><button tabIndex={-1}>탭 제외 동작</button><button>활성 동작</button></Dialog>;
    }
    render(<InertFixture />);
    const dialog = screen.getByRole('dialog', { name: '비활성 포커스' });
    const active = screen.getByRole('button', { name: '활성 동작' });
    await waitFor(() => expect(active).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(active).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(active).toHaveFocus();
  });

  it('lets Escape reach the dialog after an icon tooltip is dismissed', async () => {
    function TooltipDialogFixture() {
      const [open, setOpen] = useState(false);
      const inputRef = useRef<HTMLInputElement>(null);
      return <><button onClick={() => setOpen(true)}>도구 대화상자 열기</button><Dialog open={open} onClose={() => setOpen(false)} title="도구" initialFocusRef={inputRef}><FormField ref={inputRef} label="이름" /><Button iconOnly accessibleName="도움말">?</Button></Dialog></>;
    }
    render(<TooltipDialogFixture />);
    const trigger = screen.getByRole('button', { name: '도구 대화상자 열기' });
    trigger.focus();
    fireEvent.click(trigger);
    const icon = screen.getByRole('button', { name: '도움말' });
    fireEvent.focus(icon);
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.keyDown(icon, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '도구' })).toBeVisible();
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
    fireEvent.keyDown(icon, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '도구' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('traps focus only in the topmost dialog', async () => {
    render(<><Dialog open onClose={() => undefined} title="아래 대화상자"><button>아래 동작</button></Dialog><Dialog open onClose={() => undefined} title="위 대화상자"><button>위 동작</button></Dialog></>);
    const topAction = screen.getByRole('button', { name: '위 동작' });
    await waitFor(() => expect(topAction).toHaveFocus());
    screen.getByRole('button', { name: '아래 동작' }).focus();
    await waitFor(() => expect(topAction).toHaveFocus());
  });

  it('keeps the most recently opened dialog visually and logically on top', async () => {
    function StackedDialogFixture() {
      const [openLower, setOpenLower] = useState(false);
      return <><button onClick={() => setOpenLower(true)}>아래 대화상자 열기</button><Dialog open={openLower} onClose={() => setOpenLower(false)} title="나중에 연 대화상자"><button>나중 동작</button></Dialog><Dialog open onClose={() => undefined} title="먼저 연 대화상자"><button>먼저 동작</button></Dialog></>;
    }
    render(<StackedDialogFixture />);
    fireEvent.click(screen.getByRole('button', { name: '아래 대화상자 열기' }));
    const backdrops = document.body.querySelectorAll('.dialog-backdrop');
    expect(backdrops[backdrops.length - 1]).toHaveTextContent('나중에 연 대화상자');
    await waitFor(() => expect(screen.getByRole('button', { name: '나중 동작' })).toHaveFocus());
  });
});

describe('Feedback and layout', () => {
  it('provides retry and polite toast announcements', () => {
    const retry = vi.fn();
    render(<><Feedback kind="error" title="실패" onRetry={retry}>연결 오류</Feedback><ToastRegion messages={[{ id: 'saved', message: '저장 완료' }]} /></>);
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('알림')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps duplicate toast messages by id in one live region without nested status roles', () => {
    const { container } = render(<ToastRegion messages={[{ id: 'first', message: '저장 완료' }, { id: 'second', message: '저장 완료' }]} />);
    expect(screen.getAllByText('저장 완료')).toHaveLength(2);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it('deduplicates duplicate toast ids while preserving the first payload', () => {
    render(<ToastRegion messages={[{ id: 'same', message: '첫 알림' }, { id: 'same', message: '중복 알림' }]} />);
    expect(screen.getByText('첫 알림')).toBeVisible();
    expect(screen.queryByText('중복 알림')).not.toBeInTheDocument();
  });

  it('renders reusable navigation data with current-page semantics', () => {
    render(<AppShell navigation={{ brand: { href: '/admin', label: '운영 도구' }, items: [{ href: '/inbox', label: '받은 상담', current: true }, { href: '/settings', label: '설정' }] }}><ListDetailLayout ariaLabel="상담 목록과 상세" list={<ul><li>상담</li></ul>} detail={<h2>상세</h2>} /></AppShell>);
    expect(screen.getByRole('navigation', { name: '관리자 메뉴' })).toBeVisible();
    expect(screen.getByRole('link', { name: '운영 도구' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: '받은 상담' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '설정' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('region', { name: '상담 목록과 상세' })).toBeVisible();
    expect(screen.getByRole('article')).toBeVisible();
  });
});

describe('Showcase accessibility', () => {
  it('announces the selected consultation without relying on color', () => {
    render(<Showcase />);
    const selected = screen.getByRole('button', { name: /신규 고객.*선택됨/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveTextContent('선택됨');
    expect(screen.getByRole('button', { name: /재방문 고객/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no detectable axe violations', async () => {
    const { container } = render(<Showcase />);
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
