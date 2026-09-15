import { useRef, useState, type FormEvent } from 'react';
import { AppShell, Button, Dialog, ErrorSummary, Feedback, FormField, ListDetailLayout, SelectField, TextareaField, ToastRegion, type ErrorSummaryItem } from './primitives';

const conversations = [
  { name: '신규 고객', summary: '드레스룸 설치 일정 문의', time: '오전 10:24' },
  { name: '재방문 고객', summary: '견적서 옵션 변경 요청', time: '오전 9:48' },
  { name: '현장 담당자', summary: '실측 사진을 전달했습니다', time: '어제' },
];

export function Showcase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const phoneFieldRef = useRef<HTMLInputElement>(null);
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const errors: ErrorSummaryItem[] = hasErrors ? [
    { fieldId: 'customer-name', fieldRef: firstFieldRef, message: '고객 이름을 입력해 주세요.' },
    { fieldId: 'customer-phone', fieldRef: phoneFieldRef, message: '전화번호를 확인해 주세요.' },
  ] : [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasErrors(true);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  return (
    <AppShell navigation={{ brand: { href: '#overview', label: 'Kate Blanc' }, items: [{ href: '#overview', label: '상담 관리', current: true }, { href: '#forms', label: '폼' }, { href: '#feedback', label: '상태' }] }}>
      <header className="page-header">
        <div><p className="eyebrow">Admin primitives</p><h1>상담 운영 쇼케이스</h1><p>기존 관리자 화면을 교체하지 않는 React·TypeScript 검증용 화면입니다.</p></div>
        <div className="page-header__actions"><Button tone="primary" onClick={() => setDialogOpen(true)}>새 상담 메모</Button><Button iconOnly accessibleName="더보기">•••</Button></div>
      </header>

      <ListDetailLayout
        ariaLabel="상담 목록과 상세"
        list={<><h2>최근 상담</h2><ul className="conversation-list">{conversations.map((item, index) => <li key={item.name}><button aria-pressed={index === 0} className={index === 0 ? 'is-selected' : ''}><span><strong>{item.name}</strong><small>{item.summary}</small>{index === 0 && <span className="conversation-list__selected">✓ 선택됨</span>}</span><time>{item.time}</time></button></li>)}</ul></>}
        detail={<><div className="detail-heading"><div><p className="eyebrow">상담 상세</p><h2>신규 고객</h2></div><span className="badge">AI 상담 중</span></div><dl className="detail-grid"><div><dt>연락처</dt><dd>010-••••-1234</dd></div><div><dt>설치 지역</dt><dd>서울시 마포구</dd></div></dl><div className="message"><strong>고객 메시지</strong><p>안방 드레스룸에 ㄱ자 형태로 설치하고 싶어요. 이번 주 실측이 가능할까요?</p></div><div className="detail-actions"><Button tone="primary">답장 작성</Button><Button>관리자 난입</Button><Button>첨부 확인</Button></div></>}
      />

      <section id="forms" className="showcase-section">
        <div className="section-heading"><p className="eyebrow">Forms</p><h2>고객 정보 확인</h2></div>
        <form noValidate onSubmit={submit}>
          <ErrorSummary ref={summaryRef} errors={errors} />
          <div className="form-grid"><FormField id="customer-name" ref={firstFieldRef} label="고객 이름" description="상담 기록에 표시할 이름입니다." error={errors[0]?.message} /><FormField id="customer-phone" ref={phoneFieldRef} label="전화번호" inputMode="tel" description="숫자와 하이픈을 사용할 수 있습니다." error={errors[1]?.message} /><TextareaField label="상담 메모" description="고객 요청의 핵심 내용을 기록합니다." rows={2} /><SelectField label="우선순위" description="후속 대응 순서를 선택합니다." defaultValue="normal"><option value="normal">보통</option><option value="high">높음</option></SelectField></div>
          <Button type="submit" tone="primary">저장하기</Button>
        </form>
      </section>

      <section id="feedback" className="showcase-section">
        <div className="section-heading"><p className="eyebrow">Feedback</p><h2>상태와 복구</h2></div>
        <div className="feedback-grid"><Feedback title="모든 상담을 불러왔습니다"><p>새 상담이 들어오면 목록에 자동으로 표시됩니다.</p><div className="loading-demo" aria-label="버튼 로딩 폭 예시"><Button>동기화</Button><Button loading>동기화</Button></div></Feedback><Feedback kind="error" title="첨부 파일을 불러오지 못했습니다" onRetry={() => setRetryCount((value) => value + 1)}>네트워크 연결을 확인한 뒤 다시 시도해 주세요. 재시도 {retryCount}회</Feedback></div>
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="상담 메모 추가" initialFocusRef={dialogInputRef}>
        <FormField ref={dialogInputRef} label="메모" description="관리자만 확인할 수 있습니다." />
        <div className="dialog__actions"><Button onClick={() => setDialogOpen(false)}>취소</Button><Button tone="primary" onClick={() => setDialogOpen(false)}>메모 저장</Button></div>
      </Dialog>
      <ToastRegion messages={[{ id: 'design-ready', message: '디자인 토큰과 접근성 규칙이 적용되었습니다.' }]} />
    </AppShell>
  );
}
