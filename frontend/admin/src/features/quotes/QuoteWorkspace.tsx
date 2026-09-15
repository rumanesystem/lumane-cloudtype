import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, adminApi, type AdminQuote, type AdminQuoteUpdate } from '../../api/client';
import { Button, Feedback, FormField, ListDetailLayout, SelectField, TextareaField } from '../../primitives';

type LoadState = 'loading' | 'ready' | 'error';
type SortDirection = 'desc' | 'asc';

function display(value: unknown, fallback = '—') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? display(value)
    : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function optionsText(value: string[] | string) {
  if (Array.isArray(value)) return value.filter((option) => typeof option === 'string' && option.trim()).join(', ') || '없음';
  return display(value, '없음');
}

function quoteSearchText(quote: AdminQuote) {
  const customer = quote.고객정보 ?? ({} as AdminQuote['고객정보']);
  return [
    quote.접수번호,
    quote.상태,
    quote.담당자,
    customer.이름,
    customer.연락처,
    customer.설치지역,
  ].map((value) => typeof value === 'string' ? value.toLocaleLowerCase('ko-KR') : '').join(' ');
}

export function QuoteWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [quotes, setQuotes] = useState<AdminQuote[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AdminQuoteUpdate>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [manager, setManager] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoadState('loading');
    setError('');
    try {
      const payload = await adminApi.quotes(signal);
      if (signal?.aborted || sequence !== requestSequence.current) return;
      const nextQuotes = Array.isArray(payload.quotes) ? payload.quotes : [];
      setQuotes(nextQuotes);
      setSelectedId((current) => current && nextQuotes.some((quote) => String(quote.id) === current)
        ? current
        : nextQuotes[0] ? String(nextQuotes[0].id) : null);
      setLoadState('ready');
    } catch (reason) {
      if (signal?.aborted || sequence !== requestSequence.current) return;
      if (reason instanceof AdminApiError && reason.status === 401) {
        window.location.replace('/admin-react');
        return;
      }
      setError(reason instanceof Error ? reason.message : '견적을 불러오지 못했습니다.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const statuses = useMemo(() => [...new Set(quotes.map((quote) => quote.상태).filter(Boolean))].sort(), [quotes]);
  const managers = useMemo(() => [...new Set(quotes.map((quote) => quote.담당자).filter(Boolean))].sort(), [quotes]);
  const filteredQuotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    return quotes
      .filter((quote) => !status || quote.상태 === status)
      .filter((quote) => !manager || quote.담당자 === manager)
      .filter((quote) => !normalizedQuery || quoteSearchText(quote).includes(normalizedQuery))
      .sort((left, right) => {
        const difference = new Date(right.접수시간).getTime() - new Date(left.접수시간).getTime();
        return sortDirection === 'desc' ? difference : -difference;
      });
  }, [manager, query, quotes, sortDirection, status]);

  const selectedQuote = quotes.find((quote) => String(quote.id) === selectedId) ?? null;

  const save = useCallback(async (quoteId: string, update: AdminQuoteUpdate) => {
    setSavingId(quoteId);
    setSaveError(null);
    try {
      await adminApi.updateQuote(quoteId, update);
      setQuotes((current) => current.map((quote) => String(quote.id) === quoteId ? { ...quote, ...update } : quote));
      setDrafts((current) => {
        if (!(quoteId in current)) return current;
        const next = { ...current };
        delete next[quoteId];
        return next;
      });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '견적을 저장하지 못했습니다.';
      setSaveError({ id: quoteId, message });
      return false;
    } finally {
      setSavingId((current) => current === quoteId ? null : current);
    }
  }, []);

  if (loadState === 'loading') {
    return <Feedback title="견적을 불러오는 중입니다">잠시만 기다려 주세요.</Feedback>;
  }
  if (loadState === 'error') {
    return <Feedback kind="error" title="견적을 불러오지 못했습니다" onRetry={() => void load()}>{error}</Feedback>;
  }

  const list = (
    <section className="quote-list-panel" aria-label="견적 목록">
      <div className="quote-filters">
        <FormField
          label="견적 검색"
          placeholder="접수번호, 이름, 연락처, 지역"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectField label="처리 상태 필터" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">전체 상태</option>
          {statuses.map((value) => <option key={value}>{value}</option>)}
        </SelectField>
        <SelectField label="담당자" value={manager} onChange={(event) => setManager(event.target.value)}>
          <option value="">전체 담당자</option>
          {managers.map((value) => <option key={value}>{value}</option>)}
        </SelectField>
        <SelectField label="정렬" value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
          <option value="desc">최신순</option>
          <option value="asc">오래된순</option>
        </SelectField>
      </div>
      <div className="quote-list-heading">
        <p aria-live="polite">총 {filteredQuotes.length}건</p>
        <Button disabled={savingId !== null} onClick={() => void load()}>새로고침</Button>
      </div>
      {filteredQuotes.length ? (
        <ul className="quote-list">
          {filteredQuotes.map((quote) => {
            const selected = String(quote.id) === selectedId;
            return (
              <li key={quote.id}>
                <button
                  type="button"
                  className="quote-list__item"
                  aria-pressed={selected}
                  disabled={savingId !== null}
                  onClick={() => setSelectedId(String(quote.id))}
                >
                  <span className="quote-list__number">{display(quote.접수번호)}</span>
                  <strong>{display(quote.고객정보?.이름, '이름 미수집')}</strong>
                  <span>{display(quote.고객정보?.설치지역)}</span>
                  <span className="badge">{display(quote.상태, '상태 미정')}</span>
                  <time dateTime={quote.접수시간}>{formatDate(quote.접수시간)}</time>
                  {selected && <span className="quote-list__selected">선택됨</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Feedback title="조건에 맞는 견적이 없습니다">검색어나 필터를 바꿔 보세요.</Feedback>
      )}
    </section>
  );

  const detail = selectedQuote ? <QuoteDetail
    key={selectedQuote.id}
    draft={drafts[String(selectedQuote.id)] ?? { 상태: selectedQuote.상태, 담당자: selectedQuote.담당자, 메모: selectedQuote.메모 }}
    quote={selectedQuote}
    saving={savingId === String(selectedQuote.id)}
    saveError={saveError?.id === String(selectedQuote.id) ? saveError : null}
    onDraftChange={(draft) => setDrafts((current) => ({ ...current, [String(selectedQuote.id)]: draft }))}
    onSave={(update) => save(String(selectedQuote.id), update)}
  /> : (
    <Feedback title="표시할 견적이 없습니다">목록에서 견적을 선택해 주세요.</Feedback>
  );

  return <ListDetailLayout ariaLabel="견적 목록과 상세" list={list} detail={detail} />;
}

function QuoteDetail({ draft, onDraftChange, onSave, quote, saveError, saving }: { draft: AdminQuoteUpdate; onDraftChange: (draft: AdminQuoteUpdate) => void; onSave: (update: AdminQuoteUpdate) => Promise<boolean>; quote: AdminQuote; saveError: { message: string } | null; saving: boolean }) {
  const customer = quote.고객정보 ?? ({} as AdminQuote['고객정보']);
  const changed = draft.상태 !== quote.상태 || draft.담당자 !== quote.담당자 || draft.메모 !== quote.메모;
  return (
    <section className="quote-detail" aria-labelledby="quote-detail-title">
      <header className="quote-detail__header">
        <div>
          <p className="eyebrow">{display(quote.접수번호)}</p>
          <h2 id="quote-detail-title">{display(customer.이름, '이름 미수집')}</h2>
          <p>{formatDate(quote.접수시간)}</p>
        </div>
        <span className="badge">{display(quote.상태, '상태 미정')}</span>
      </header>
      <DetailSection title="고객 정보" items={[
        ['연락처', customer.연락처],
        ['설치 지역', customer.설치지역],
        ['개인정보 동의', customer.개인정보동의],
        ['접수 경로', quote.출처],
      ]} />
      <DetailSection title="공간과 옵션" items={[
        ['공간 형태', customer.공간형태],
        ['공간 사이즈', customer.공간사이즈],
        ['추가 옵션', optionsText(customer.추가옵션)],
        ['프레임 색상', customer.프레임색상],
        ['선반 색상', customer.선반색상],
      ]} />
      <DetailSection title="업무 정보" items={[
        ['담당자', display(quote.담당자, '미배정')],
        ['사진', display(quote.사진여부, '없음')],
        ['파일명', quote.파일명],
      ]} />
      <div className="quote-detail__copy">
        <h3>요청사항</h3>
        <p>{display(customer.요청사항, '없음')}</p>
      </div>
      <div className="quote-detail__copy">
        <h3>내부 메모</h3>
        <p>{display(quote.메모, '없음')}</p>
      </div>
      <form className="quote-detail__section" onSubmit={(event) => { event.preventDefault(); if (changed) void onSave(draft); }}>
        <h3>업무 정보 편집</h3>
        <SelectField label="처리 상태" value={draft.상태} disabled={saving} onChange={(event) => onDraftChange({ ...draft, 상태: event.target.value })}>
          {[...new Set([quote.상태, '접수', '상담중', '견적중', '완료', '보류'].filter(Boolean))].map((value) => <option key={value} value={value}>{value}</option>)}
        </SelectField>
        <FormField label="담당자" value={draft.담당자} disabled={saving} maxLength={100} onChange={(event) => onDraftChange({ ...draft, 담당자: event.target.value })} />
        <TextareaField label="내부 메모" value={draft.메모} disabled={saving} maxLength={2000} rows={5} onChange={(event) => onDraftChange({ ...draft, 메모: event.target.value })} />
        {saveError && <Feedback kind="error" title="견적 저장에 실패했습니다" onRetry={() => void onSave(draft)}>{saveError.message}</Feedback>}
        <div className="detail-actions"><Button type="submit" tone="primary" loading={saving} disabled={!changed}>이 견적에 저장</Button></div>
      </form>
    </section>
  );
}

function DetailSection({ items, title }: { items: Array<[string, unknown]>; title: string }) {
  return (
    <section className="quote-detail__section">
      <h3>{title}</h3>
      <dl className="detail-grid">
        {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}
      </dl>
    </section>
  );
}
