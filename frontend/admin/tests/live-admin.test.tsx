import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  verifySession: vi.fn(), sessions: vi.fn(), session: vi.fn(), conversations: vi.fn(), conversation: vi.fn(), takeover: vi.fn(), release: vi.fn(), sendMessage: vi.fn(),
}));

vi.mock('../src/api/client', () => ({
  adminApi: api,
  AdminApiError: class AdminApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));

import { LiveAdmin } from '../src/features/live/LiveAdmin';

const summary = { id: 'session-1', mode: 'ai', customerName: '홍길동', messageCount: 1, unreadAdminCount: 0, startedAt: '2026-07-22T00:00:00Z', lastActivity: '2026-07-22T00:00:00Z', lastMessageAt: '2026-07-22T00:00:00Z' } as const;
const detail = { ...summary, messages: [{ role: 'user' as const, content: '<img src=x onerror=alert(1)>', time: '2026-07-22T00:00:00Z' }] };
const savedSummary = { id: 41, session_id: 'saved-session', mode: 'ai', customer_name: '<b>저장 고객</b>', message_count: 2, saved_at: '2026-07-21T00:00:00Z', messages: [] };
const savedDetail = { ...savedSummary, messages: [{ role: 'assistant' as const, content: '<script>alert(1)</script>', time: '2026-07-21T00:00:00Z' }] };

describe('LiveAdmin', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    api.verifySession.mockResolvedValue({});
    api.sessions.mockResolvedValue({ sessions: [summary] });
    api.session.mockResolvedValue({ session: detail });
    api.conversations.mockResolvedValue({ conversations: [savedSummary] });
    api.conversation.mockResolvedValue({ conversation: savedDetail });
    api.takeover.mockResolvedValue({ ok: true });
    api.release.mockResolvedValue({ ok: true });
    api.sendMessage.mockResolvedValue({ ok: true, mid: 'adm-1' });
  });

  it('loads a real session and renders message content as text', async () => {
    const { container } = render(<LiveAdmin />);
    expect(await screen.findByRole('heading', { name: '홍길동' })).toBeVisible();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(api.verifySession).toHaveBeenCalledOnce();
    expect(api.sessions).toHaveBeenCalled();
    expect(api.conversations).toHaveBeenCalled();
    expect(api.session).toHaveBeenCalledWith('session-1', expect.any(AbortSignal));
  });

  it('offers honest source filters and renders persisted conversations as text', async () => {
    const { container } = render(<LiveAdmin />);
    expect(await screen.findByRole('tab', { name: '전체 2' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '저장됨 1' }));
    expect(screen.queryByRole('button', { name: /홍길동/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /<b>저장 고객<\/b>/ }));
    expect(await screen.findByText('<script>alert(1)</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(api.conversation).toHaveBeenCalledWith('41', false, expect.any(AbortSignal));
  });

  it('keeps real and test saved conversations with the same id distinct and loads the test source', async () => {
    const testSummary = { ...savedSummary, customer_name: '테스트 고객', is_test: true };
    const testActive = { ...summary, id: 'test-active', customerName: '테스트 진행', isTest: true };
    api.sessions.mockResolvedValue({ sessions: [summary, testActive] });
    api.conversations.mockResolvedValue({ conversations: [savedSummary, testSummary] });
    api.conversation.mockImplementation((_id: string, isTest: boolean) => Promise.resolve({
      conversation: isTest ? { ...savedDetail, ...testSummary } : savedDetail,
    }));

    render(<LiveAdmin />);
    expect(await screen.findByRole('tab', { name: '전체 4' })).toBeVisible();
    expect(screen.getByRole('button', { name: /테스트 진행/ })).toHaveTextContent('테스트');
    expect(screen.getByRole('button', { name: /<b>저장 고객<\/b>/ })).toBeVisible();
    const testConversation = screen.getByRole('button', { name: /테스트 고객/ });
    expect(testConversation).toHaveTextContent('테스트');
    fireEvent.click(testConversation);
    expect(await screen.findByRole('heading', { name: '테스트 고객' })).toBeVisible();
    expect(api.conversation).toHaveBeenCalledWith('41', true, expect.any(AbortSignal));
  });

  it('does not duplicate the persisted copy of an active session', async () => {
    api.conversations.mockResolvedValue({ conversations: [{ ...savedSummary, session_id: 'session-1' }] });
    render(<LiveAdmin />);
    expect(await screen.findByRole('tab', { name: '전체 1' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '저장됨 0' })).toBeVisible();
  });

  it('ignores a stale no-signal mutation refresh rejection after a newer poll succeeds', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    render(<LiveAdmin />);
    const takeover = await screen.findByRole('button', { name: '난입하기' });
    const completedLoads = api.sessions.mock.calls.length;
    let rejectStale!: (reason: Error) => void;
    api.sessions.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStale = reject; }));

    fireEvent.click(takeover);
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(completedLoads + 1));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(completedLoads + 2));

    rejectStale(new Error('뒤늦은 실패'));
    await waitFor(() => expect(screen.getByRole('button', { name: '난입하기' })).toBeEnabled());
    expect(screen.queryByText('뒤늦은 실패')).not.toBeInTheDocument();
    expect(screen.queryByText('요청을 완료하지 못했습니다')).not.toBeInTheDocument();
  });

  it('keeps drafts per conversation while changing selection and filters', async () => {
    api.sessions.mockResolvedValue({ sessions: [{ ...summary, mode: 'admin' }] });
    api.session.mockResolvedValue({ session: { ...detail, mode: 'admin' } });
    render(<LiveAdmin />);
    const reply = await screen.findByLabelText('고객에게 답장');
    fireEvent.change(reply, { target: { value: '활성 상담 초안' } });
    fireEvent.click(screen.getByRole('button', { name: /<b>저장 고객<\/b>/ }));
    await screen.findByText('<script>alert(1)</script>');
    fireEvent.click(screen.getByRole('button', { name: /홍길동/ }));
    expect(await screen.findByLabelText('고객에게 답장')).toHaveValue('활성 상담 초안');
  });

  it('runs takeover and enables replies after the refreshed session enters admin mode', async () => {
    let adminMode = false;
    api.session.mockImplementation(() => Promise.resolve({ session: { ...detail, mode: adminMode ? 'admin' : 'ai' } }));
    api.takeover.mockImplementation(() => { adminMode = true; return Promise.resolve({ ok: true }); });
    render(<LiveAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: '난입하기' }));
    await waitFor(() => expect(api.takeover).toHaveBeenCalledWith('session-1'));
    const reply = await screen.findByLabelText('고객에게 답장');
    await waitFor(() => expect(reply).toBeEnabled());
    fireEvent.change(reply, { target: { value: '확인했습니다.' } });
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith('session-1', '확인했습니다.'));
  });

  it('keeps the reply draft when sending fails', async () => {
    api.session.mockResolvedValue({ session: { ...detail, mode: 'admin' } });
    api.sendMessage.mockRejectedValue(new Error('전송 실패'));
    render(<LiveAdmin />);
    const reply = await screen.findByLabelText('고객에게 답장');
    fireEvent.change(reply, { target: { value: '사라지면 안 되는 답장' } });
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
    expect(await screen.findByText('전송 실패')).toBeVisible();
    expect(reply).toHaveValue('사라지면 안 되는 답장');
  });

  it('clears only the draft that was sent when the selected target changes while sending', async () => {
    const second = { ...summary, id: 'session-2', customerName: '다른 고객', mode: 'admin' as const };
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let completeSend!: () => void;
    api.sessions.mockResolvedValue({ sessions: [{ ...summary, mode: 'admin' }, second] });
    api.session.mockImplementation((id: string) => Promise.resolve({
      session: { ...detail, ...(id === 'session-2' ? second : { mode: 'admin' as const }) },
    }));
    api.sendMessage.mockImplementation(() => new Promise((resolve) => {
      completeSend = () => resolve({ ok: true, mid: 'adm-1' });
    }));

    render(<LiveAdmin />);
    let reply = await screen.findByLabelText('고객에게 답장');
    fireEvent.change(reply, { target: { value: '첫 상담 답장' } });
    fireEvent.click(screen.getByRole('button', { name: /다른 고객/ }));
    reply = await screen.findByLabelText('고객에게 답장');
    fireEvent.change(reply, { target: { value: '둘째 상담 초안' } });
    fireEvent.click(screen.getByRole('button', { name: /홍길동/ }));
    reply = await screen.findByLabelText('고객에게 답장');
    fireEvent.click(screen.getByRole('button', { name: '전송' }));

    api.sessions.mockResolvedValue({ sessions: [second] });
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByRole('heading', { name: '다른 고객' })).toBeVisible();

    completeSend();
    await waitFor(() => expect(screen.getByLabelText('고객에게 답장')).toHaveValue('둘째 상담 초안'));
    expect(api.sendMessage).toHaveBeenCalledWith('session-1', '첫 상담 답장');
  });

  it('removes stale reply controls while a newly selected consultation loads', async () => {
    const second = { ...summary, id: 'session-2', customerName: '새 고객', mode: 'admin' as const };
    let resolveSecond!: (value: unknown) => void;
    const pendingSecond = new Promise((resolve) => { resolveSecond = resolve; });
    api.sessions.mockResolvedValue({ sessions: [{ ...summary, mode: 'admin' }, second] });
    api.session.mockImplementation((id: string) => id === 'session-2'
      ? pendingSecond
      : Promise.resolve({ session: { ...detail, mode: 'admin' } }));

    render(<LiveAdmin />);
    expect(await screen.findByLabelText('고객에게 답장')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /새 고객/ }));

    expect(screen.queryByLabelText('고객에게 답장')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '상담을 불러오는 중입니다' })).toBeVisible();
    expect(api.sendMessage).not.toHaveBeenCalled();

    resolveSecond({ session: { ...detail, ...second } });
    expect(await screen.findByRole('heading', { name: '새 고객' })).toBeVisible();
  });

  it('locks the consultation target while takeover is still pending', async () => {
    const second = { ...summary, id: 'session-2', customerName: '다른 고객' };
    let completeTakeover!: () => void;
    api.sessions.mockResolvedValue({ sessions: [summary, second] });
    api.takeover.mockImplementation(() => new Promise<void>((resolve) => { completeTakeover = resolve; }));
    render(<LiveAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: '난입하기' }));
    expect(api.takeover).toHaveBeenCalledWith('session-1');
    expect(screen.getByRole('button', { name: /다른 고객/ })).toBeDisabled();
    expect(screen.getByRole('tab', { name: '저장됨 1' })).toBeDisabled();
    completeTakeover();
    await waitFor(() => expect(screen.getByRole('button', { name: /다른 고객/ })).toBeEnabled());
  });
});
