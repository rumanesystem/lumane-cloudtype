import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Feedback, ListDetailLayout } from '../../primitives';
import { useLiveAdmin, type ConsultationFilter } from './useLiveAdmin';

const formatTime = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';

export function LiveAdmin() {
  const live = useLiveAdmin();
  const [filter, setFilter] = useState<ConsultationFilter>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const messagesRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const atBottomRef = useRef<Record<string, boolean>>({});
  const draft = live.selectedKey ? drafts[live.selectedKey] ?? '' : '';
  const visibleItems = useMemo(() => filter === 'all' ? live.items : live.items.filter((item) => item.source === filter), [filter, live.items]);
  const counts = {
    all: live.items.length,
    active: live.items.filter((item) => item.source === 'active').length,
    saved: live.items.filter((item) => item.source === 'saved').length,
  };

  useEffect(() => {
    const element = messagesRef.current;
    if (!element || !live.selectedKey) return;
    const savedPosition = scrollPositionsRef.current[live.selectedKey];
    element.scrollTop = atBottomRef.current[live.selectedKey] === false && savedPosition !== undefined
      ? savedPosition
      : element.scrollHeight;
  }, [live.detail?.messages.length, live.selectedKey]);

  const changeFilter = (nextFilter: ConsultationFilter) => {
    if (live.mutating) return;
    setFilter(nextFilter);
    const nextItems = nextFilter === 'all' ? live.items : live.items.filter((item) => item.source === nextFilter);
    if (!live.selectedKey || !nextItems.some((item) => item.key === live.selectedKey)) {
      live.select(nextItems[0]?.key ?? null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const targetKey = live.selectedKey;
    const message = draft.trim();
    if (!targetKey || !message || live.mutating) return;
    if (await live.send(message)) {
      setDrafts((current) => ({ ...current, [targetKey]: '' }));
    }
  };

  if (live.authState === 'loading') return <Feedback title="관리자 세션 확인 중"><p>잠시만 기다려 주세요.</p></Feedback>;
  if (live.authState === 'error') return <Feedback kind="error" title="관리자 화면을 열 수 없습니다" onRetry={live.refresh}>{live.error}</Feedback>;

  return <>
    {live.error && <Feedback kind="error" title="요청을 완료하지 못했습니다" onRetry={live.refresh}>{live.error}</Feedback>}
    <div className="consultation-tabs" role="tablist" aria-label="상담 상태 필터">
      {([['all', '전체'], ['active', '진행 중'], ['saved', '저장됨']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={filter === id} disabled={live.mutating} onClick={() => changeFilter(id)}>{label} {counts[id]}</button>)}
    </div>
    <ListDetailLayout
      ariaLabel="상담 목록과 상세"
      list={<div className="live-list"><div className="detail-heading"><h2>{filter === 'all' ? '전체 상담' : filter === 'active' ? '진행 중 상담' : '저장 상담'}</h2><span className="badge">{visibleItems.length}개</span></div>{visibleItems.length === 0 ? <p className="empty-copy">이 상태의 상담이 없습니다.</p> : <ul className="conversation-list">{visibleItems.map((item) => <li key={item.key}><button disabled={live.mutating} aria-pressed={live.selectedKey === item.key} className={live.selectedKey === item.key ? 'is-selected' : ''} onClick={() => live.select(item.key)}><span><strong>{item.customerName}</strong><small>{item.source === 'active' ? item.mode === 'admin' ? '담당자 상담 중' : 'AI 상담 중' : '저장된 상담'} · 메시지 {item.messageCount}개{item.meta.length ? ` · ${item.meta.join(' · ')}` : ''}</small>{item.unreadAdminCount > 0 && <span className="conversation-list__selected">고객 미확인 {item.unreadAdminCount}</span>}</span><time>{formatTime(item.timestamp)}</time></button></li>)}</ul>}</div>}
      detail={!live.detail ? <div className="empty-panel"><h2>{live.selectedKey ? '상담을 불러오는 중입니다' : '상담을 선택해 주세요'}</h2><p>{live.selectedKey ? '선택한 상담의 최신 내용을 확인하고 있습니다.' : '진행 중 상담과 저장된 상담을 한곳에서 확인할 수 있습니다.'}</p></div> : <div className="live-detail"><div className="detail-heading"><div><p className="eyebrow">{live.detail.source === 'active' ? '진행 중 상담' : '저장된 상담'}</p><h2>{live.detail.customerName}</h2></div><div className="detail-actions"><span className="badge">{live.detail.source === 'saved' ? '읽기 전용' : live.detail.mode === 'admin' ? '담당자 상담 중' : 'AI 상담 중'}</span>{live.detail.source === 'active' && (live.detail.mode === 'admin' ? <Button disabled={live.mutating} onClick={live.release}>AI에게 넘기기</Button> : <Button tone="primary" disabled={live.mutating} onClick={live.takeover}>난입하기</Button>)}</div></div><div ref={messagesRef} className="live-messages" aria-live="polite" onScroll={(event) => { if (live.selectedKey) { const element = event.currentTarget; scrollPositionsRef.current[live.selectedKey] = element.scrollTop; atBottomRef.current[live.selectedKey] = element.scrollHeight - element.scrollTop - element.clientHeight <= 24; } }}>{live.detail.messages.map((message, index) => <article className={`live-message live-message--${message.role === 'user' ? 'customer' : message.fromAdmin ? 'admin' : 'ai'}`} key={message.mid || `${message.time || message.ts}-${index}`}><strong>{message.role === 'user' ? '고객' : message.fromAdmin ? '담당자' : '루마네 AI'}</strong><p>{message.content}</p><time>{formatTime(message.time || message.ts)}</time></article>)}</div>{live.detail.source === 'saved' ? <p className="saved-consultation-note">저장된 상담은 이 화면에서 읽기만 할 수 있습니다. 답장은 진행 중 상담에서만 전송됩니다.</p> : <form className="live-composer" onSubmit={submit}><label htmlFor="admin-reply">고객에게 답장</label><textarea id="admin-reply" value={draft} onChange={(event) => { const key = live.selectedKey; if (key) setDrafts((current) => ({ ...current, [key]: event.target.value })); }} disabled={live.detail.mode !== 'admin' || live.mutating} maxLength={2000} rows={3} placeholder={live.detail.mode === 'admin' ? '답장을 입력하세요' : '난입 후 답장할 수 있습니다'} /><Button type="submit" tone="primary" loading={live.mutating} disabled={live.detail.mode !== 'admin' || !draft.trim()}>전송</Button></form>}</div>}
    />
  </>;
}
