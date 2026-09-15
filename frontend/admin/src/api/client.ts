export type AdminSessionSummary = {
  id: string;
  mode: 'ai' | 'admin';
  customerName: string;
  messageCount: number;
  unreadAdminCount: number;
  startedAt: string;
  lastActivity: string;
  lastMessageAt: string;
  nickname?: string | null;
  src?: string | null;
  src2?: string | null;
  isTest?: boolean;
};

export type AdminMessage = {
  role: 'user' | 'assistant';
  content: string;
  fromAdmin?: boolean;
  time?: string;
  ts?: string;
  mid?: string;
  read?: boolean;
};

export type AdminSessionDetail = AdminSessionSummary & {
  messages: AdminMessage[];
  customerTyping?: boolean;
};

export type AdminConversationSummary = {
  id: number | string;
  session_id?: string | null;
  mode?: 'ai' | 'admin' | null;
  customer_name?: string | null;
  name?: string | null;
  message_count?: number | null;
  saved_at: string;
  region?: string | null;
  layout?: string | null;
  messages?: AdminMessage[] | null;
  is_test?: boolean;
};

export type AdminConversationDetail = AdminConversationSummary & {
  messages: AdminMessage[];
};

export type AdminQuoteCustomer = {
  이름: string;
  연락처: string;
  설치지역: string;
  공간형태: string;
  공간사이즈: string;
  추가옵션: string[] | string;
  프레임색상: string;
  선반색상: string;
  요청사항: string;
  개인정보동의: string;
};

export type AdminQuote = {
  id: string | number;
  접수번호: string;
  접수시간: string;
  상태: string;
  담당자: string;
  메모: string;
  고객정보: AdminQuoteCustomer;
  사진여부: string;
  파일명: string;
  출처: string;
};

export type AdminQuoteUpdate = Pick<AdminQuote, '상태' | '담당자' | '메모'>;

export type AdminAuthSession = {
  email: string;
  createdAt: number;
  expiresAt: number;
};

export class AdminApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const csrfToken = readCookie('lumane_admin_csrf');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new AdminApiError(response.status, payload?.error || '요청을 처리하지 못했습니다.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const adminApi = {
  health: (signal?: AbortSignal) => request<{ status: string; message?: string }>('/api/health', { signal }),
  verifySession: (signal?: AbortSignal) => request<AdminAuthSession>('/api/admin-auth/session', { signal }),
  logout: () => request<void>('/api/admin-auth/logout', { method: 'POST' }),
  sessions: (signal?: AbortSignal) => request<{ sessions: AdminSessionSummary[] }>('/api/admin/sessions', { signal }),
  session: (id: string, signal?: AbortSignal) => request<{ session: AdminSessionDetail }>(`/api/admin/session/${encodeURIComponent(id)}`, { signal }),
  conversations: (signal?: AbortSignal) => request<{ conversations: AdminConversationSummary[] }>('/api/admin/conversations', { signal }),
  conversation: (id: string, isTest: boolean, signal?: AbortSignal) => request<{ conversation: AdminConversationDetail }>(`/api/admin/conversations/${encodeURIComponent(id)}${isTest ? '?is_test=true' : ''}`, { signal }),
  takeover: (sessionId: string) => request<{ ok: true }>('/api/admin/takeover', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  release: (sessionId: string) => request<{ ok: true }>('/api/admin/release', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  sendMessage: (sessionId: string, message: string) => request<{ ok: true; mid: string }>('/api/admin/message', { method: 'POST', body: JSON.stringify({ sessionId, message }) }),
  quotes: (signal?: AbortSignal) => request<{ quotes: AdminQuote[] }>('/api/quotes', { signal }),
  updateQuote: (id: string | number, update: AdminQuoteUpdate) => request<{ ok: true }>(`/api/quotes/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: update.상태, manager: update.담당자, memo: update.메모 }),
  }),
};
