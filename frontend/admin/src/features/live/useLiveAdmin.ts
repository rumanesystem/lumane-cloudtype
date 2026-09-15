import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, adminApi, type AdminConversationDetail, type AdminMessage } from '../../api/client';

type LoadState = 'loading' | 'ready' | 'error';
export type ConsultationFilter = 'all' | 'active' | 'saved';
export type ConsultationItem = {
  key: string;
  source: 'active' | 'saved';
  isTest: boolean;
  id: string;
  sessionId: string | null;
  mode: 'ai' | 'admin';
  customerName: string;
  messageCount: number;
  unreadAdminCount: number;
  timestamp: string;
  meta: string[];
};
export type ConsultationDetail = ConsultationItem & { messages: AdminMessage[] };

const savedName = (conversation: { customer_name?: string | null; name?: string | null }) =>
  conversation.customer_name || conversation.name || '(이름 미수집)';

export function useLiveAdmin() {
  const [authState, setAuthState] = useState<LoadState>('loading');
  const [items, setItems] = useState<ConsultationItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [error, setError] = useState('');
  const [mutating, setMutating] = useState(false);
  const selectedKeyRef = useRef<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => { selectedKeyRef.current = selectedKey; }, [selectedKey]);

  const select = useCallback((key: string | null) => {
    selectedKeyRef.current = key;
    setSelectedKey(key);
    setDetail(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    try {
      const [listPayload, savedPayload] = await Promise.all([
        adminApi.sessions(signal),
        adminApi.conversations(signal),
      ]);
      if (signal?.aborted || sequence !== requestSequence.current) return;
      const activeIdentities = new Set(listPayload.sessions.map((session) => `${session.isTest === true ? 'test' : 'real'}:${session.id}`));
      const activeItems: ConsultationItem[] = listPayload.sessions.map((session) => ({
        key: `session:${session.isTest === true ? 'test' : 'real'}:${session.id}`, source: 'active', isTest: session.isTest === true, id: String(session.id), sessionId: String(session.id),
        mode: session.mode, customerName: session.nickname || session.customerName,
        messageCount: session.messageCount, unreadAdminCount: session.unreadAdminCount,
        timestamp: session.lastMessageAt, meta: session.isTest === true ? ['테스트'] : [],
      }));
      const savedItems: ConsultationItem[] = savedPayload.conversations
        .filter((conversation) => !conversation.session_id || !activeIdentities.has(`${conversation.is_test === true ? 'test' : 'real'}:${conversation.session_id}`))
        .map((conversation) => ({
          key: `saved:${conversation.is_test === true ? 'test' : 'real'}:${conversation.id}`,
          source: 'saved', isTest: conversation.is_test === true, id: String(conversation.id),
          sessionId: conversation.session_id ? String(conversation.session_id) : null,
          mode: conversation.mode === 'admin' ? 'admin' : 'ai', customerName: savedName(conversation),
          messageCount: conversation.message_count ?? conversation.messages?.length ?? 0, unreadAdminCount: 0,
          timestamp: conversation.saved_at, meta: [conversation.is_test === true ? '테스트' : null, conversation.region, conversation.layout].filter((value): value is string => Boolean(value)),
        }));
      const nextItems = [...activeItems, ...savedItems].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      setItems(nextItems);
      const currentKey = selectedKeyRef.current;
      const nextKey = currentKey && nextItems.some((item) => item.key === currentKey)
        ? currentKey
        : nextItems[0]?.key ?? null;
      if (nextKey !== currentKey) {
        selectedKeyRef.current = nextKey;
        setSelectedKey(nextKey);
      }
      if (!nextKey) {
        setDetail(null);
        setError('');
        return;
      }
      const selected = nextItems.find((item) => item.key === nextKey)!;
      const payload = selected.source === 'active'
        ? (await adminApi.session(selected.id, signal)).session
        : (await adminApi.conversation(selected.id, selected.isTest, signal)).conversation;
      if (signal?.aborted || sequence !== requestSequence.current || selectedKeyRef.current !== nextKey) return;
      setDetail({
        ...selected,
        mode: payload.mode === 'admin' ? 'admin' : 'ai',
        customerName: selected.source === 'active'
          ? ('nickname' in payload && payload.nickname || 'customerName' in payload && payload.customerName || selected.customerName)
          : savedName(payload as AdminConversationDetail),
        messages: Array.isArray(payload.messages) ? payload.messages : [],
      });
      setError('');
    } catch (reason) {
      if (signal?.aborted || sequence !== requestSequence.current) return;
      if (reason instanceof AdminApiError && reason.status === 401) {
        window.location.replace('/admin-react');
        return;
      }
      setError(reason instanceof Error ? reason.message : '상담을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    adminApi.verifySession(controller.signal).then(() => {
      if (controller.signal.aborted) return;
      setAuthState('ready');
      void refresh(controller.signal);
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) window.location.replace('/admin-react');
      else { setAuthState('error'); setError(reason instanceof Error ? reason.message : '관리자 세션을 확인하지 못했습니다.'); }
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (authState !== 'ready') return;
    let controller = new AbortController();
    const poll = () => {
      if (document.hidden) return;
      controller.abort();
      controller = new AbortController();
      void refresh(controller.signal);
    };
    const timer = window.setInterval(poll, 2000);
    document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); controller.abort(); document.removeEventListener('visibilitychange', poll); };
  }, [authState, refresh]);

  useEffect(() => {
    if (authState !== 'ready' || !selectedKey) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [authState, refresh, selectedKey]);

  const runMutation = useCallback(async (action: () => Promise<unknown>) => {
    setMutating(true);
    setError('');
    try { await action(); await refresh(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '요청을 처리하지 못했습니다.'); return false; }
    finally { setMutating(false); }
  }, [refresh]);

  return {
    authState, detail, error, items, mutating, refresh: () => refresh(), selectedKey,
    select,
    takeover: () => detail?.sessionId && runMutation(() => adminApi.takeover(detail.sessionId!)),
    release: () => detail?.sessionId && runMutation(() => adminApi.release(detail.sessionId!)),
    send: (message: string) => detail?.source === 'active' && detail.sessionId
      ? runMutation(() => adminApi.sendMessage(detail.sessionId!, message))
      : Promise.resolve(false),
  };
}
