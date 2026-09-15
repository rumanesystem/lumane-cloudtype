import type { ReactNode } from 'react';
import { Button } from './Button';

export function Feedback({ children, kind = 'status', onRetry, title }: { children: ReactNode; kind?: 'status' | 'error'; onRetry?: () => void; title: string }) {
  return (
    <section className={`feedback feedback--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <h3>{title}</h3>
      <div>{children}</div>
      {onRetry && <Button type="button" onClick={onRetry}>다시 시도</Button>}
    </section>
  );
}

export type ToastMessage = { id: string; message: string };

export function ToastRegion({ messages }: { messages: ToastMessage[] }) {
  const uniqueMessages = messages.filter((toast, index) => messages.findIndex((candidate) => candidate.id === toast.id) === index);
  return (
    <aside className="toast-region" aria-label="알림" aria-live="polite" aria-relevant="additions text">
      {uniqueMessages.map((toast) => <div className="toast" key={toast.id}>{toast.message}</div>)}
    </aside>
  );
}
