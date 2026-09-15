import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../src/api/client';
import { ADMIN_RETURN_PATH, GlobalHeaderStatus } from '../src/workspace/GlobalHeaderStatus';

const session = { email: 'operator@example.com', createdAt: 1, expiresAt: 2 };

function api(overrides: Partial<{
  health: () => Promise<{ status: string }>;
  verifySession: () => Promise<typeof session>;
  logout: () => Promise<void>;
}> = {}) {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
    verifySession: vi.fn().mockResolvedValue(session),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('GlobalHeaderStatus', () => {
  it('announces the verified server and admin session without a fake notification count', async () => {
    render(<GlobalHeaderStatus api={api()} />);
    expect(screen.getByRole('status')).toHaveTextContent('서버·로그인 확인 중');
    expect(await screen.findByText('서버 연결됨 · 로그인 유지 중')).toBeVisible();
    expect(screen.getByText('operator@example.com')).toBeVisible();
    expect(screen.queryByLabelText(/알림/)).not.toBeInTheDocument();
  });

  it('shows an explicit server error and recovers through the retry control', async () => {
    const health = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ status: 'ok' });
    const client = api({ health });
    render(<GlobalHeaderStatus api={client} />);
    expect(await screen.findByText('서버에 연결할 수 없습니다.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    expect(await screen.findByText('서버 연결됨 · 로그인 유지 중')).toBeVisible();
    expect(health).toHaveBeenCalledTimes(2);
  });

  it('offers a login link when the authenticated session expired', async () => {
    expect(ADMIN_RETURN_PATH).toBe('/admin-react');
    render(<GlobalHeaderStatus api={api({
      verifySession: vi.fn().mockRejectedValue(new AdminApiError(401, '인증이 필요합니다.')),
    })} />);
    expect(await screen.findByText('로그인이 만료되었습니다.')).toBeVisible();
    expect(screen.getByRole('link', { name: '다시 로그인' })).toHaveAttribute('href', ADMIN_RETURN_PATH);
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('keeps a transient session-check failure recoverable', async () => {
    const verifySession = vi.fn()
      .mockRejectedValueOnce(new AdminApiError(503, 'unavailable'))
      .mockResolvedValue(session);
    render(<GlobalHeaderStatus api={api({ verifySession })} />);
    expect(await screen.findByText('로그인 상태를 확인하지 못했습니다.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    expect(await screen.findByText('서버 연결됨 · 로그인 유지 중')).toBeVisible();
    expect(verifySession).toHaveBeenCalledTimes(2);
  });

  it('logs out through the existing API and exposes a recoverable failure', async () => {
    const onLoggedOut = vi.fn();
    const logout = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    render(<GlobalHeaderStatus api={api({ logout })} onLoggedOut={onLoggedOut} />);
    const button = await screen.findByRole('button', { name: '로그아웃' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('로그아웃하지 못했습니다. 다시 시도해 주세요.');
    fireEvent.click(button);
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('has no detectable accessibility violations in its ready state', async () => {
    const { container } = render(<GlobalHeaderStatus api={api()} />);
    await screen.findByText('서버 연결됨 · 로그인 유지 중');
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
