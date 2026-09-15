import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, adminApi, type AdminAuthSession } from '../api/client';

type HeaderApi = Pick<typeof adminApi, 'health' | 'logout' | 'verifySession'>;
type CheckState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: AdminAuthSession }
  | { kind: 'server-error'; message: string }
  | { kind: 'session-expired' }
  | { kind: 'session-error'; message: string };

const CHECK_INTERVAL_MS = 30_000;
export const ADMIN_RETURN_PATH = '/admin-react';

export function GlobalHeaderStatus({
  api = adminApi,
  onLoggedOut = () => window.location.replace(ADMIN_RETURN_PATH),
}: {
  api?: HeaderApi;
  onLoggedOut?: () => void;
}) {
  const [state, setState] = useState<CheckState>({ kind: 'checking' });
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const checkId = useRef(0);

  const check = useCallback(async (signal?: AbortSignal) => {
    const currentCheck = ++checkId.current;
    setState({ kind: 'checking' });
    const [health, session] = await Promise.allSettled([
      api.health(signal),
      api.verifySession(signal),
    ]);
    if (signal?.aborted || currentCheck !== checkId.current) return;

    if (health.status === 'rejected' || health.value.status !== 'ok') {
      setState({ kind: 'server-error', message: '서버에 연결할 수 없습니다.' });
      return;
    }
    if (session.status === 'rejected') {
      if (session.reason instanceof AdminApiError && session.reason.status === 401) {
        setState({ kind: 'session-expired' });
      } else {
        setState({ kind: 'session-error', message: '로그인 상태를 확인하지 못했습니다.' });
      }
      return;
    }
    setState({ kind: 'ready', session: session.value });
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check(controller.signal);
    }, CHECK_INTERVAL_MS);
    return () => {
      checkId.current += 1;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [check]);

  const logout = async () => {
    setLogoutError('');
    setLoggingOut(true);
    try {
      await api.logout();
      onLoggedOut();
    } catch {
      setLogoutError('로그아웃하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setLoggingOut(false);
    }
  };

  return <div className="global-header-status">
    <div className="global-header-status__summary" role="status" aria-live="polite">
      <span className={`status-indicator status-indicator--${statusTone(state)}`} aria-hidden="true" />
      <span>{statusText(state)}</span>
      {state.kind === 'ready' && <span className="global-header-status__account">{state.session.email}</span>}
    </div>
    {(state.kind === 'server-error' || state.kind === 'session-error') &&
      <button className="global-header-status__retry" type="button" onClick={() => void check()}>다시 확인</button>}
    {state.kind === 'session-expired'
      ? <a className="global-header-status__login" href={ADMIN_RETURN_PATH}>다시 로그인</a>
      : <button className="global-header-status__logout" type="button" disabled={loggingOut || state.kind === 'checking'} onClick={() => void logout()}>
          {loggingOut ? '로그아웃 중…' : '로그아웃'}
        </button>}
    {logoutError && <p className="global-header-status__error" role="alert">{logoutError}</p>}
  </div>;
}

function statusTone(state: CheckState) {
  if (state.kind === 'ready') return 'success';
  if (state.kind === 'checking') return 'pending';
  return 'danger';
}

function statusText(state: CheckState) {
  switch (state.kind) {
    case 'checking': return '서버·로그인 확인 중';
    case 'ready': return '서버 연결됨 · 로그인 유지 중';
    case 'server-error': return state.message;
    case 'session-expired': return '로그인이 만료되었습니다.';
    case 'session-error': return state.message;
  }
}
