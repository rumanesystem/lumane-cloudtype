import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, type AdminQuote, type AdminSessionSummary } from '../../api/client';
import { Button, Feedback } from '../../primitives';
import type { WorkspaceArea } from '../../workspace/WorkspaceShell';

type LoadState = 'loading' | 'ready' | 'error';

type OperationalSummary = {
  activeSessions: number;
  adminSessions: number;
  unreadMessages: number;
  savedConversations: number;
  unassignedQuotes: number;
  totalQuotes: number;
};

function createSummary(sessions: AdminSessionSummary[], savedConversations: number, quotes: AdminQuote[]): OperationalSummary {
  return {
    activeSessions: sessions.length,
    adminSessions: sessions.filter((session) => session.mode === 'admin').length,
    unreadMessages: sessions.reduce((total, session) => total + Math.max(0, session.unreadAdminCount || 0), 0),
    savedConversations,
    unassignedQuotes: quotes.filter((quote) => !quote.담당자?.trim()).length,
    totalQuotes: quotes.length,
  };
}

export function OperationalHome({ onOpen }: { onOpen: (area: WorkspaceArea) => void }) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<OperationalSummary | null>(null);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoadState('loading');
    setError('');
    try {
      const [sessionsResult, conversationsResult, quotesResult] = await Promise.all([
        adminApi.sessions(signal),
        adminApi.conversations(signal),
        adminApi.quotes(signal),
      ]);
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setSummary(createSummary(
        Array.isArray(sessionsResult.sessions) ? sessionsResult.sessions : [],
        Array.isArray(conversationsResult.conversations) ? conversationsResult.conversations.length : 0,
        Array.isArray(quotesResult.quotes) ? quotesResult.quotes : [],
      ));
      setLoadState('ready');
    } catch (reason) {
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : '운영 현황을 불러오지 못했습니다.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const liveLabel = useMemo(() => summary?.unreadMessages
    ? `고객 미확인 답장 ${summary.unreadMessages}건`
    : '고객 미확인 답장 없음', [summary]);

  if (loadState === 'loading' && !summary) return <Feedback title="운영 현황을 불러오는 중입니다">진행 중 상담과 견적 접수를 확인하고 있습니다.</Feedback>;
  if (loadState === 'error' && !summary) return <Feedback kind="error" title="운영 현황을 불러오지 못했습니다" onRetry={() => void load()}>{error}</Feedback>;
  if (!summary) return null;

  return <section aria-labelledby="home-title">
    <div className="workspace-page-heading"><div><p className="eyebrow">오늘 처리할 업무</p><h2 id="home-title">운영 홈</h2></div><Button onClick={() => void load()} loading={loadState === 'loading'}>새로고침</Button></div>
    {error && <Feedback kind="error" title="현황을 갱신하지 못했습니다" onRetry={() => void load()}>{error}</Feedback>}
    <div className="work-queue" aria-label="운영 요약">
      <button type="button" onClick={() => onOpen('conversations')}>
        <strong>진행 중 상담 {summary.activeSessions}건</strong>
        <span>{liveLabel} · 담당자 응대 {summary.adminSessions}건</span>
      </button>
      <button type="button" onClick={() => onOpen('quotes')}>
        <strong>미배정 견적 {summary.unassignedQuotes}건</strong>
        <span>전체 접수 {summary.totalQuotes}건의 담당자·상태·메모를 정리합니다.</span>
      </button>
      <button type="button" onClick={() => onOpen('conversations')}>
        <strong>저장 상담 {summary.savedConversations}건</strong>
        <span>이전 상담 내용을 확인해 현재 고객 응대에 연결합니다.</span>
      </button>
    </div>
  </section>;
}
