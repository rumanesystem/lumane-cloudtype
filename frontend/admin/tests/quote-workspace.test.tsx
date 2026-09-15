import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ quotes: vi.fn(), updateQuote: vi.fn() }));

vi.mock('../src/api/client', () => ({
  adminApi: api,
  AdminApiError: class AdminApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));

import { QuoteWorkspace } from '../src/features/quotes/QuoteWorkspace';

const quotes = [
  {
    id: 1, 접수번호: 'KB-0001', 접수시간: '2026-07-23T01:00:00Z', 상태: '접수완료', 담당자: '',
    메모: '<img src=x onerror=alert(1)>', 사진여부: '', 파일명: '', 출처: '직접입력',
    고객정보: { 이름: '홍길동', 연락처: '010-1111-2222', 설치지역: '서울', 공간형태: 'ㄱ자형', 공간사이즈: '가로 240cm', 추가옵션: ['거울장'], 프레임색상: '블랙', 선반색상: '화이트', 요청사항: '<script>alert(1)</script>', 개인정보동의: '동의' },
  },
  {
    id: 2, 접수번호: 'KB-0002', 접수시간: '2026-07-22T01:00:00Z', 상태: '상담중', 담당자: '관리자',
    메모: '', 사진여부: '', 파일명: '', 출처: 'AI상담',
    고객정보: { 이름: '김고객', 연락처: '010-3333-4444', 설치지역: '부산', 공간형태: '1자형', 공간사이즈: '가로 180cm', 추가옵션: '', 프레임색상: '실버', 선반색상: '오크', 요청사항: '', 개인정보동의: '동의' },
  },
] as const;

describe('QuoteWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.quotes.mockResolvedValue({ quotes });
    api.updateQuote.mockResolvedValue({ ok: true });
  });

  it('loads, selects, searches, filters, and renders API text safely', async () => {
    const { container } = render(<QuoteWorkspace />);
    expect(screen.getByText('견적을 불러오는 중입니다')).toBeVisible();
    expect(await screen.findByRole('heading', { name: '홍길동' })).toBeVisible();
    expect(screen.getByRole('region', { name: '견적 목록과 상세' })).toBeVisible();
    expect(api.quotes).toHaveBeenCalledWith(expect.any(AbortSignal));

    fireEvent.click(screen.getByRole('button', { name: /KB-0002/ }));
    expect(screen.getByRole('heading', { name: '김고객' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('견적 검색'), { target: { value: '010-1111' } });
    expect(screen.getByRole('button', { name: /KB-0001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /KB-0002/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('견적 검색'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('처리 상태 필터'), { target: { value: '접수완료' } });
    expect(screen.getByText('총 1건')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /KB-0001/ }));
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
    expect(screen.getAllByText('<img src=x onerror=alert(1)>')).not.toHaveLength(0);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows empty and error states and retries', async () => {
    const { rerender } = render(<QuoteWorkspace />);
    await screen.findByRole('heading', { name: '홍길동' });
    fireEvent.change(screen.getByLabelText('견적 검색'), { target: { value: '없는 고객' } });
    expect(screen.getByText('조건에 맞는 견적이 없습니다')).toBeVisible();

    api.quotes.mockRejectedValueOnce(new Error('연결 실패'));
    rerender(<QuoteWorkspace key="failed" />);
    expect(await screen.findByText('연결 실패')).toBeVisible();
    api.quotes.mockResolvedValueOnce({ quotes });
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '홍길동' })).toBeVisible());
  });

  it('edits status, manager, and memo only for the captured quote while save is in flight', async () => {
    let finishSave!: () => void;
    api.updateQuote.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<QuoteWorkspace />);
    const detail = await screen.findByRole('heading', { name: '홍길동' }).then((heading) => heading.closest('.quote-detail') as HTMLElement);
    const statusSelect = within(detail).getByLabelText('처리 상태');
    fireEvent.change(statusSelect, { target: { value: '견적중' } });
    fireEvent.change(within(detail).getByLabelText('담당자'), { target: { value: '담당자 A' } });
    fireEvent.change(within(detail).getByLabelText('내부 메모'), { target: { value: '후속 연락 필요' } });
    fireEvent.click(within(detail).getByRole('button', { name: '이 견적에 저장' }));

    expect(api.updateQuote).toHaveBeenCalledWith('1', { 상태: '견적중', 담당자: '담당자 A', 메모: '후속 연락 필요' });
    expect(screen.getByRole('button', { name: /KB-0002/ })).toBeDisabled();
    finishSave();
    await waitFor(() => expect(within(detail).getByRole('button', { name: '이 견적에 저장' })).toBeDisabled());
    expect(within(detail).getByRole('combobox', { name: '처리 상태' })).toHaveValue('견적중');
    expect(within(detail).getByRole('heading', { name: '홍길동' })).toBeVisible();
  });

  it('keeps unsaved values and offers a retry when quote editing fails', async () => {
    api.updateQuote.mockRejectedValueOnce(new Error('저장 연결 실패')).mockResolvedValueOnce({ ok: true });
    render(<QuoteWorkspace />);
    const detail = await screen.findByRole('heading', { name: '홍길동' }).then((heading) => heading.closest('.quote-detail') as HTMLElement);
    fireEvent.change(within(detail).getByLabelText('담당자'), { target: { value: '담당자 B' } });
    fireEvent.click(within(detail).getByRole('button', { name: '이 견적에 저장' }));
    expect(await screen.findByText('저장 연결 실패')).toBeVisible();
    expect(within(detail).getByLabelText('담당자')).toHaveValue('담당자 B');
    fireEvent.change(within(detail).getByLabelText('담당자'), { target: { value: '담당자 C' } });
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(api.updateQuote).toHaveBeenCalledTimes(2));
    expect(api.updateQuote).toHaveBeenLastCalledWith('1', expect.objectContaining({ 담당자: '담당자 C' }));
  });

  it('retains a visible draft per quote when the operator changes targets', async () => {
    render(<QuoteWorkspace />);
    const firstDetail = await screen.findByRole('heading', { name: '홍길동' }).then((heading) => heading.closest('.quote-detail') as HTMLElement);
    fireEvent.change(within(firstDetail).getByLabelText('담당자'), { target: { value: '임시 담당자' } });
    fireEvent.click(screen.getByRole('button', { name: /KB-0002/ }));
    expect(await screen.findByRole('heading', { name: '김고객' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /KB-0001/ }));
    const restoredDetail = screen.getByRole('heading', { name: '홍길동' }).closest('.quote-detail') as HTMLElement;
    expect(within(restoredDetail).getByLabelText('담당자')).toHaveValue('임시 담당자');
  });
});
