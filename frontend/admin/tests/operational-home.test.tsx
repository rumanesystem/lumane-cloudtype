import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ sessions: vi.fn(), conversations: vi.fn(), quotes: vi.fn() }));

vi.mock('../src/api/client', () => ({
  adminApi: api,
  AdminApiError: class AdminApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));

import { OperationalHome } from '../src/features/home/OperationalHome';

describe('OperationalHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.sessions.mockResolvedValue({ sessions: [
      { id: 'a', mode: 'admin', unreadAdminCount: 2 },
      { id: 'b', mode: 'ai', unreadAdminCount: 0 },
    ] });
    api.conversations.mockResolvedValue({ conversations: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    api.quotes.mockResolvedValue({ quotes: [{ id: 1, 담당자: '' }, { id: 2, 담당자: '담당자 A' }] });
  });

  it('derives actionable counts from existing APIs and sends each queue to its workspace', async () => {
    const onOpen = vi.fn();
    render(<OperationalHome onOpen={onOpen} />);
    expect(await screen.findByText('진행 중 상담 2건')).toBeVisible();
    expect(screen.getByText('고객 미확인 답장 2건 · 담당자 응대 1건')).toBeVisible();
    expect(screen.getByText('미배정 견적 1건')).toBeVisible();
    expect(screen.getByText('저장 상담 3건')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /미배정 견적/ }));
    expect(onOpen).toHaveBeenCalledWith('quotes');
  });

  it('shows a retryable error rather than a false zero summary', async () => {
    api.quotes.mockRejectedValueOnce(new Error('견적 API 오류')).mockResolvedValueOnce({ quotes: [] });
    render(<OperationalHome onOpen={vi.fn()} />);
    expect(await screen.findByText('견적 API 오류')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.getByText('진행 중 상담 2건')).toBeVisible());
  });
});
