/* ================================================================
   admin-pagination.js — 저장된 상담 목록 페이지 넘기기 (페이지당 30건)

   - 대시보드("dash")와 대화 탭("live")이 각자 현재 페이지를 가진다.
   - 1페이지는 이미 받아 둔 최신 목록(_cachedConversations) 앞 30건을 쓰고,
     2페이지부터는 서버에 ?page=N&pageSize=30 으로 따로 받아온다.
   - 모양:  1 2 3 … 10   /   << < [입력칸] > >>   (<< >> 는 10페이지씩)

   의존: admin-state.js (_cachedConversations), admin-config.js (SERVER, adminFetch, adminHeaders)
================================================================ */

const CONV_PAGE_SIZE = 30;
const _convPages = { dash: { page: 1, items: null, req: 0, loading: 0, drawn: '' }, live: { page: 1, items: null, req: 0, loading: 0, drawn: '' } };
let _convTotal = 0;

function setConvTotal(n) {
  _convTotal = Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : 0;
}

function convTotalPages() {
  return Math.max(1, Math.ceil(_convTotal / CONV_PAGE_SIZE));
}

/** 지금 페이지에 보여 줄 저장 상담 (최신순 · 서버와 같은 id 내림차순 기준) */
function convPageItems(key) {
  const st = _convPages[key];
  if (!st || st.page === 1 || !st.items) return (_cachedConversations || []).slice(0, CONV_PAGE_SIZE);
  return st.items;
}

/** 페이지에 상관없이 받아 둔 상담 중에서 id 로 찾기 (카드 클릭·읽음 처리용) */
function findCachedConversation(id) {
  const all = [..._cachedConversations, ...(_convPages.dash.items || []), ...(_convPages.live.items || [])];
  return all.find(c => String(c.id) === String(id));
}

/** 삭제된 상담을 받아 둔 페이지 목록에서도 빼고 전체 개수 줄이기 · 페이지가 비면 앞 페이지로 */
function removeConvFromPages(id) {
  setConvTotal(Math.max(0, _convTotal - 1));
  for (const [key, st] of Object.entries(_convPages)) {
    if (st.items) st.items = st.items.filter(c => String(c.id) !== String(id));
    // 받아오는 중이던 페이지는 삭제 전 내용이라 다시 받기
    if (st.loading) goConvPage(key, st.loading);
    else if (st.page > 1 && st.items && st.items.length === 0) goConvPage(key, st.page - 1);
    else renderConvPager(key);
  }
}

/** 30초 새로고침 때 2페이지 이후를 보고 있으면 그 페이지도 다시 받아오기 (받아오는 중이면 그 결과를 기다림) */
function refreshConvPages() {
  for (const [key, st] of Object.entries(_convPages)) {
    if (st.loading) continue;
    if (st.page > 1) goConvPage(key, st.page);
    else renderConvPager(key);
  }
}

async function goConvPage(key, page) {
  const st = _convPages[key];
  if (!st) return;
  const target = Math.min(Math.max(1, Math.floor(Number(page)) || 1), convTotalPages());
  const req = ++st.req; // 늦게 도착한 예전 요청은 무시
  if (target === 1) {
    st.page = 1;
    st.items = null;
    st.loading = 0;
  } else {
    st.loading = target;
    try {
      const res = await adminFetch(`${SERVER}/api/admin/conversations?page=${target}&pageSize=${CONV_PAGE_SIZE}`, { headers: adminHeaders() });
      const data = res.ok ? await res.json() : null;
      if (req !== st.req) return;
      st.loading = 0;
      if (!data) return;
      st.page = target;
      st.items = data.conversations || [];
      setConvTotal(data.total);
    } catch { if (req === st.req) st.loading = 0; return; }
  }
  renderConvPager(key);
  if (key === 'dash') renderDashboardSessions(_cachedLiveSessions);
  else renderLiveSessionList(_cachedLiveSessions);
}

/** 페이지 버튼 그리기 — 목록과 다른 칸이라 1초마다 다시 그리지 않음 (입력칸 커서 유지) */
function renderConvPager(key) {
  const el = document.getElementById(key === 'dash' ? 'dashPager' : 'livePager');
  if (!el) return;
  const total = convTotalPages();
  if (_convPages[key].page > total) { goConvPage(key, total); return; } // 전체가 줄어 지금 페이지가 없어졌으면 마지막 페이지로
  const page = _convPages[key].page;
  const sig = page + '/' + total;
  // 같은 페이지·같은 전체 수인데 입력칸에 치는 중이면 다시 그리지 않음 (치던 숫자 유지)
  if (sig === _convPages[key].drawn && el.contains(document.activeElement)) return;
  _convPages[key].drawn = sig;
  if (total <= 1) { el.innerHTML = ''; return; }
  const start = Math.floor((page - 1) / 10) * 10 + 1;
  const end = Math.min(start + 9, total);
  const btn = 'min-width:30px;height:30px;padding:0 6px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;font-size:13px;font-weight:600;cursor:pointer;';
  const cur = 'background:#5b21b6;border-color:#5b21b6;color:#fff;';
  const off = 'opacity:.45;cursor:default;';
  let nums = '';
  for (let p = start; p <= end; p++) {
    nums += `<button type="button" data-page="${p}" ${p === page ? 'aria-current="page"' : ''} style="${btn}${p === page ? cur : ''}">${p}</button>`;
  }
  const nav = (label, step, disabled, name) =>
    `<button type="button" data-step="${step}" aria-label="${name}" ${disabled ? 'disabled' : ''} style="${btn}${disabled ? off : ''}">${label}</button>`;
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:4px;">${nums}</div>
    <div style="display:flex;justify-content:center;align-items:center;gap:4px;margin-top:6px;">
      ${nav('&lt;&lt;', -10, page === 1, '10페이지 앞으로')}${nav('&lt;', -1, page === 1, '이전 페이지')}
      <input type="number" min="1" max="${total}" value="${page}" aria-label="이동할 페이지"
        style="width:56px;height:30px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-size:13px;color:#1f2937;">
      <span style="font-size:13px;color:#1f2937;">/ ${total}</span>
      ${nav('&gt;', 1, page === total, '다음 페이지')}${nav('&gt;&gt;', 10, page === total, '10페이지 뒤로')}
    </div>`;
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.page) goConvPage(key, Number(b.dataset.page));
      else if (b.dataset.step) goConvPage(key, _convPages[key].page + Number(b.dataset.step));
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input')) goConvPage(key, Number(e.target.value));
    });
  }
}
