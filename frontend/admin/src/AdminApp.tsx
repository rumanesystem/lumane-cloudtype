import { useState, type ReactNode } from 'react';
import { OperationalHome } from './features/home/OperationalHome';
import { LiveAdmin } from './features/live/LiveAdmin';
import { QuoteWorkspace } from './features/quotes';
import { MigrationPanel, WorkspaceShell, type WorkspaceArea } from './workspace/WorkspaceShell';

export function AdminApp() {
  const [area, setArea] = useState<WorkspaceArea>('home');
  const [visited, setVisited] = useState<Set<WorkspaceArea>>(() => new Set(['home']));
  const openArea = (nextArea: WorkspaceArea) => {
    setVisited((current) => current.has(nextArea) ? current : new Set(current).add(nextArea));
    setArea(nextArea);
  };

  return <WorkspaceShell active={area} onChange={openArea}>
    <AreaPanel active={area === 'home'}>{visited.has('home') && <OperationalHome onOpen={openArea} />}</AreaPanel>
    <AreaPanel active={area === 'conversations'}>{visited.has('conversations') && <section aria-labelledby="conversation-title"><div className="workspace-page-heading"><div><h2 id="conversation-title">상담 관리</h2><p>진행 중인 상담과 저장된 상담을 한곳에서 확인합니다.</p></div></div><LiveAdmin /></section>}</AreaPanel>
    <AreaPanel active={area === 'quotes'}>{visited.has('quotes') && <section aria-labelledby="quotes-title"><div className="workspace-page-heading"><div><h2 id="quotes-title">견적 관리</h2><p>접수된 견적을 검색하고 세부 내용을 확인합니다.</p></div></div><QuoteWorkspace /></section>}</AreaPanel>
    <AreaPanel active={area === 'analytics'}>{visited.has('analytics') && <MigrationPanel title="운영 분석" legacyLabel="통계 열기" legacyHref="/admin#visitor-stats"><p>대시보드에 중복된 상담 통계와 방문자·유입 소스·토큰 비용을 한 영역으로 통합합니다.</p><FeatureList items={['방문·대화·견적 전환', '유입 소스 성과', '기간별 상담 추이', 'AI 토큰과 비용']} /></MigrationPanel>}</AreaPanel>
    <AreaPanel active={area === 'data'}>{visited.has('data') && <MigrationPanel title="데이터 관리" legacyLabel="휴지통·백업 열기" legacyHref="/admin#trash"><p>복원 가능한 삭제와 영구삭제, 전체/테이블 백업을 위험도에 맞는 확인 흐름으로 묶습니다.</p><FeatureList items={['휴지통 조회와 복원', '대상 확인 후 영구삭제', '전체 ZIP 백업', '테이블 CSV 내보내기']} /></MigrationPanel>}</AreaPanel>
  </WorkspaceShell>;
}

function AreaPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return <div hidden={!active}>{children}</div>;
}

function FeatureList({ items }: { items: string[] }) {
  return <ul className="feature-list">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
