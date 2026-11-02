/* ================================================================
   메인 채팅 로직 — 진입점 (ES Module)
================================================================ */
import { SERVER, DEMO } from './config.js';

/* ── 세션 ID: localStorage에 저장하여 새로고침해도 유지 ── */
const SESSION_KEY = '루마네_세션ID';
function generateSessionId() {
  let suffix;
  if (window.crypto?.randomUUID) {
    suffix = window.crypto.randomUUID().replace(/-/g, '');
  } else if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } else {
    suffix = Math.random().toString(36).slice(2, 7); // 구형 브라우저 호환
  }
  const id = `S-${Date.now()}-${suffix}`;
  localStorage.setItem(SESSION_KEY, id);
  return id;
}
let SESSION_ID = (() => {
  const id = localStorage.getItem(SESSION_KEY);
  return (id && /^S-\d{13}-(?:[a-f0-9]{32}|[a-z0-9]{5})$/.test(id)) ? id : generateSessionId();
})();

/* ── 테스트 모드: URL에 ?test=1 파라미터가 있으면 활성화 ── */
const IS_TEST = new URLSearchParams(window.location.search).get('test') === '1';

/* ── 유입 소스: URL ?src=... &src2=... → localStorage 보관 (재방문 시 같은 소스 유지) ── */
const SRC_KEY = '루마네_유입소스';
let _src = '', _src2 = '';
try {
  const _qs = new URLSearchParams(window.location.search);
  const _qSrc  = (_qs.get('src')  || '').trim().slice(0, 50);
  const _qSrc2 = (_qs.get('src2') || '').trim().slice(0, 50);
  if (_qSrc || _qSrc2) {
    _src = _qSrc; _src2 = _qSrc2;
    localStorage.setItem(SRC_KEY, JSON.stringify({ src: _src, src2: _src2 }));
  } else {
    const stored = JSON.parse(localStorage.getItem(SRC_KEY) || '{}');
    _src = stored.src || ''; _src2 = stored.src2 || '';
  }
} catch { /* ignore */ }
const SRC = _src, SRC2 = _src2;

/* ── 닉네임: localStorage에 저장 ── */
const NICKNAME_KEY = '루마네_닉네임';
const _NICK_COLORS  = ['빨간','주황','노란','초록','파란','보라','분홍','하늘','민트','금빛'];
const _NICK_ANIMALS = ['토끼','곰','고양이','강아지','여우','판다','코알라','사슴','너구리','햄스터'];
function _generateNickname() {
  const c = _NICK_COLORS[Math.floor(Math.random() * _NICK_COLORS.length)];
  const a = _NICK_ANIMALS[Math.floor(Math.random() * _NICK_ANIMALS.length)];
  // SESSION_ID 끝 3자리(영숫자) 붙여서 충돌 방지 — 예: "민트너구리-3kx"
  const suffix = (SESSION_ID || '').slice(-3);
  const id = c + a + (suffix ? '-' + suffix : '');
  localStorage.setItem(NICKNAME_KEY, id);
  localStorage.setItem(NICKNAME_KEY + '_세션', SESSION_ID || ''); // 어느 상담에서 만든 별명인지
  return id;
}
let userNickname = localStorage.getItem(NICKNAME_KEY) || '';
// 마이그레이션: 기존 suffix 없는 자동 닉네임("민트너구리" 형식)은 충돌 방지 위해 재생성
if (userNickname && !/-[a-z0-9]{3}$/.test(userNickname)) {
  const matchesAuto = _NICK_COLORS.some(c => _NICK_ANIMALS.some(a => userNickname === c + a));
  if (matchesAuto) userNickname = _generateNickname();
}
// 자동 별명은 상담(세션)마다 새로 — 같은 브라우저에서 새 상담을 시작해도 관리자 화면 이름이 겹치지 않게
// (직접 입력한 별명은 그대로 둠)
function _currentNickname() {
  const m = /^(.+)-([a-z0-9]{3})$/.exec(userNickname || '');
  const isAuto = m && _NICK_COLORS.some(c => _NICK_ANIMALS.some(a => m[1] === c + a));
  const madeFor = localStorage.getItem(NICKNAME_KEY + '_세션');
  const stale = madeFor ? madeFor !== SESSION_ID : m && m[2] !== (SESSION_ID || '').slice(-3);
  if (isAuto && stale) userNickname = _generateNickname();
  return userNickname;
}
import { todayStr, esc } from './utils.js';
import {
  initUI, setLoading, getIsLoading,
  addMsg, addImageMsg, addFileMsg, initFileInput,
  uploadFilePending, getPendingFile,
  setMsgActionHandlers, allocMid,
  setQuick, updateQuickFromText,
  setBanner, setStatusText,
  initInputListeners, initDateSep, appendDateSep,
  clearMessages, clearInput,
  showAdminTyping, hideAdminTyping,
  scrollBottom, initScrollBehavior,
} from './ui.js';
import { getPendingReply, setPendingReply, clearPendingReply } from './reply.js';
import { getEditingMid, startEdit, cancelEdit, applyEditToDom, deleteFromDom } from './message-actions.js';
import { initSearch, toggleSearch, closeSearch } from './search.js';
import { toggleHistory, showTranscript, continueFromHistory, closeTranscript, setHistoryData } from './history.js';
import { toggleCollect, updateCollectDrawer, resetCollect } from './collect.js';
import { showConfirm, confirmBack, confirmSubmit } from './confirm.js';
import { openQuote, closeQuote, printQuote } from './quote.js';
import './chat-export.js';

/* ── 대화 상태 ── */
let history        = [];
let demoIdx        = 0;
let pendingConfirm = false;
let serverOnline   = null;

/* ── 대화 내용 localStorage 저장/복원 ── */
function uuidV4() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createClientEvent(content) {
  return { id: `msg_${uuidV4()}`, content };
}

async function persistSyncEvent(event) {
  const res = await fetch(`${SERVER}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, sessionId: SESSION_ID, syncOnly: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `서버 오류 (${res.status})`);
  }
}

function showFileSyncError(event) {
  const group = document.createElement('div');
  group.className = 'msg-group bot';
  const avatar = document.createElement('div');
  avatar.className = 'av';
  avatar.textContent = '👩‍💼';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const sender = document.createElement('div');
  sender.className = 'msg-sender';
  sender.textContent = '루마네';
  const bubble = document.createElement('div');
  bubble.className = 'bubble bot';
  const text = document.createElement('span');
  text.textContent = '⚠️ 첨부 메시지를 서버에 저장하지 못했습니다.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 전송';
  retry.style.cssText = 'margin-top:8px;padding:4px 10px;font-size:12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;display:block;';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    retry.textContent = '전송 중...';
    try {
      await persistSyncEvent(event);
      group.remove();
    } catch (error) {
      text.textContent = `⚠️ 저장 실패: ${error.message}`;
      retry.disabled = false;
      retry.textContent = '다시 전송';
    }
  });
  bubble.append(text, retry);
  body.append(sender, bubble);
  group.append(avatar, body);
  document.getElementById('msgs').appendChild(group);
  scrollBottom();
}

const HISTORY_KEY  = '루마네_히스토리';
const ARCHIVE_KEY  = '루마네_히스토리_아카이브';

const HISTORY_TS_KEY = '루마네_히스토리_시각';
const SESSION_EXPIRE = 60 * 60 * 1000; // 1시간

function isSessionIdExpired() {
  const createdAt = Number((SESSION_ID || '').split('-')[1]);
  return !Number.isFinite(createdAt) || Date.now() - createdAt > SESSION_EXPIRE;
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(HISTORY_TS_KEY, String(Date.now()));
    // SESSION_KEY 안전망 — 누락 시 현재 SESSION_ID 로 복원
    if (SESSION_ID) localStorage.setItem(SESSION_KEY, SESSION_ID);
  } catch { /* 무시 */ }
}

function loadHistory() {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')).filter(m => !m.injected);
  } catch { return []; }
}

function isSessionExpired() {
  const ts = localStorage.getItem(HISTORY_TS_KEY);
  if (!ts) return true;
  return Date.now() - Number(ts) > SESSION_EXPIRE;
}

const ARCHIVE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

function pruneArchive(archive) {
  const cutoff = Date.now() - ARCHIVE_TTL;
  return archive.filter(item => item.timestamp && item.timestamp > cutoff);
}

function archiveCurrent() {
  if (!history || history.length === 0) return;
  if (!history.some(m => m.role === 'user')) return;
  try {
    const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    const archive = pruneArchive(raw);
    const now = new Date();
    const label = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    archive.unshift({ savedAt: label, timestamp: Date.now(), messages: history.filter(m => !m.injected) });
    if (archive.length > 10) archive.length = 10;
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  } catch { /* 무시 */ }
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(HISTORY_TS_KEY);
  // SESSION_KEY 는 여기서 삭제하지 않음 — newChat() 이 generateSessionId() 로 명시적 교체
}

/* ── Admin 난입 상태 ── */
let adminMode      = false;   // true = admin이 현재 대화 중
let pollTimer      = null;    // 폴링 타이머
let silentTimer    = null;    // 서버 재확인 타이머
let updateTimer    = null;    // 배포 감지 타이머

/* ================================================================
   서버 상태 확인
================================================================ */
async function checkServer() {
  // Render 콜드 스타트(15~30초) 대기를 위해 최대 3회 재시도
  const TIMEOUTS = [8000, 12000, 20000];
  for (let i = 0; i < TIMEOUTS.length; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500)); // 서버 기동 대기
    try {
      const res = await fetch(`${SERVER}/api/health`, {
        signal: AbortSignal.timeout(TIMEOUTS[i]),
      });
      if (res.ok) { serverOnline = true; break; }
    } catch { /* 다음 시도 */ }
  }
  if (serverOnline === null) serverOnline = false;

  if (serverOnline) {
    setStatusText('온라인');
    setBanner('ok', '✅ AI 루마네와 실제 연결되었습니다');
    setTimeout(() => setBanner(null), 2500);
  } else {
    setStatusText('데모 모드');
    setBanner('warn',
      '⚠️ 현재 서버에 연결되지 않아 데모 모드로 동작 중입니다. 잠시 후 새로고침해 주세요.');
  }
}

/* ================================================================
   백그라운드 서버 재확인 (오프라인 상태에서 주기적으로 재시도)
================================================================ */
async function checkServerSilent() {
  if (serverOnline) return; // 이미 온라인이면 스킵
  try {
    const r = await fetch(`${SERVER}/api/health`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;

    // 서버가 다시 살아남!
    serverOnline = true;
    setStatusText('온라인');
    setBanner('ok', '✅ 서버에 다시 연결되었습니다. 이제부터 실시간 상담이 가능합니다.');
    setTimeout(() => setBanner(null), 3000);

    // 현재 대화 이력을 서버에 등록 (admin이 이전 대화도 볼 수 있도록)
    await registerSessionWithHistory();
    if (!pollTimer) startPolling();

  } catch { /* 무시 */ }
}

/* visitor_key 가져오기 (재방문 추적용) — site.js와 동일 키 사용. 없으면 새로 생성 */
function _getVisitorKey() {
  try {
    let v = localStorage.getItem('루마네_방문자키') || '';
    if (!v) {
      v = 'v_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem('루마네_방문자키', v);
    }
    return v;
  } catch { return ''; }
}

/* 세션 등록 — 대화 정본은 서버가 DB에서 복원 */
async function registerSessionWithHistory() {
  try {
    // 세션 등록
    await fetch(`${SERVER}/api/session/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, nickname: _currentNickname(), isTest: IS_TEST, src: SRC, src2: SRC2, visitor_key: _getVisitorKey() }),
    });
  } catch { /* 무시 */ }
}

/* ================================================================
   Admin 난입 — 세션 등록 & 폴링
================================================================ */
async function registerSession() {
  try {
    await fetch(`${SERVER}/api/session/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, nickname: _currentNickname(), isTest: IS_TEST, src: SRC, src2: SRC2, visitor_key: _getVisitorKey() }),
    });
  } catch { /* 무시 */ }
}

function startPolling() {
  if (pollTimer) return; // 이미 시작됨
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${SERVER}/api/session/status?id=${SESSION_ID}`);
      if (!res.ok) return;
      const data = await res.json();

      /* admin 모드 전환 감지 */
      if (data.mode === 'admin' && !adminMode) {
        adminMode = true;
        showAdminBanner(true);
      } else if (data.mode === 'ai' && adminMode) {
        adminMode = false;
        showAdminBanner(false);
      }

      /* 상담원 타이핑 표시 */
      if (data.adminTyping) showAdminTyping();
      else hideAdminTyping();

      /* admin이 보낸 메시지 표시 */
      for (const msg of (data.pendingMsgs || [])) {
        const alreadyReceived = msg.mid && history.some(item => item.eventId === msg.mid);
        if (alreadyReceived) continue;
        hideAdminTyping();
        addMsg('bot', msg.content, { fromAdmin: true });
        // 관리자 메시지 메타를 로컬 화면 기록에도 보존
        history.push({
          eventId: msg.mid,
          role: 'assistant',
          content: msg.content,
          fromAdmin: true,
          time: msg.time,
          ts: msg.time || new Date().toISOString(),
        });
        // 탭이 백그라운드일 때 브라우저 알림
        if (document.visibilityState !== 'visible' && Notification.permission === 'granted') {
          new Notification('👩‍💼 담당자 메시지', {
            body: msg.content.slice(0, 80),
            icon: '/favicon.ico',
          });
        }
      }
      /* 서버가 매번 동봉하는 안읽음 mid 목록으로 _pendingReadMids 동기화.
         drain 유실 / 페이지 재접속 / 새로고침 어떤 상황이든 mark-read 가능 */
      if (Array.isArray(data.unreadAdminMids)) {
        _pendingReadMids.clear();
        data.unreadAdminMids.forEach(id => _pendingReadMids.add(id));
      }
      /* 받자마자 시도 — 탭이 포커스 상태면 즉시 read 처리, 아니면 다음 visible 이벤트 때 처리 */
      _markReadIfFocused();
    } catch { /* 네트워크 오류 무시 */ }
  }, 2000);
}

/* ── 어드민 메시지 읽음 처리 (카카오톡 '1' 사라짐 효과) ──
   read 정의: 채팅 탭이 활성 + 포커스됐을 때. 둘 다 만족할 때만 read 처리 */
const _pendingReadMids = new Set();

function _markReadIfFocused() {
  if (_pendingReadMids.size === 0) return;
  if (document.visibilityState !== 'visible') return;  /* 다른 탭 보고 있으면 미루기 */
  const mids = [..._pendingReadMids];
  fetch(`${SERVER}/api/session/mark-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, mids }),
  }).then(r => {
    if (r.ok) {
      mids.forEach(m => _pendingReadMids.delete(m));
    } else if (r.status >= 400 && r.status < 500) {
      /* 서버가 명시적으로 거부 — 재시도 무의미. Set 비워서 무한 반복 차단 */
      _pendingReadMids.clear();
    }
  }).catch(() => { /* 네트워크 오류 무시 — 다음 visibilitychange 때 재시도 */ });
}

/* 탭 다시 활성화될 때 누적된 mid 일괄 mark-read */
document.addEventListener('visibilitychange', _markReadIfFocused);
window.addEventListener('focus', _markReadIfFocused);

function showAdminBanner(isAdmin) {
  setBanner(
    isAdmin ? 'admin' : 'ok',
    isAdmin
      ? '👩‍💼 담당자가 연결되었습니다. 직접 상담을 도와드리겠습니다.'
      : '🤖 AI 루마네가 다시 상담을 이어드립니다.'
  );
  if (!isAdmin) setTimeout(() => setBanner(null), 3000);
}

/* ================================================================
   히스토리에서 고객 정보 추출 (데모 모드 전용)
================================================================ */
function extractFromHistory() {
  const userMsgs = history
    .filter(m => m.role === 'user' && !m.content?.startsWith('[이미지]') && !m.content?.startsWith('[파일:'))
    .map(m => m.content);
  return {
    이름:         userMsgs[0] || '-',
    연락처:       userMsgs[1] || '-',
    설치지역:     userMsgs[2] || '-',
    공간사이즈:   { 가로mm: '-', 세로mm: '-', 높이mm: '-', raw: userMsgs[3] || '-' },
    형태:         userMsgs[4] || '-',
    추가옵션:     userMsgs[5] || '-',
    프레임색상:   userMsgs[6] || '-',
    선반색상:     userMsgs[7] || '-',
    요청사항:     userMsgs[8] || '-',
    개인정보동의: userMsgs[9] || '-',
  };
}

/* ================================================================
   부모 페이지(2패널)에 수집된 폼 필드 전달
================================================================ */
function postFieldsToParent() {
  if (window.parent === window) return; // iframe 아닌 경우 무시
  const info = extractFromHistory();
  const size = info.공간사이즈?.raw || '';
  const nums = size.replace(/[×xX×]/g, ' ').match(/\d{3,4}/g) || [];
  window.parent.postMessage({
    type: 'lumane_fields',
    fields: {
      name:        info.이름 !== '-' ? info.이름 : '',
      phone:       info.연락처 !== '-' ? info.연락처 : '',
      region:      info.설치지역 !== '-' ? info.설치지역 : '',
      width:       nums[0] || '',
      depth:       nums[1] || '',
      height:      nums[2] || '',
      layout:      info.형태 !== '-' ? info.형태 : '',
      options:     info.추가옵션 !== '-' ? info.추가옵션 : '',
      frameColor:  info.프레임색상 !== '-' ? info.프레임색상 : '',
      shelfColor:  info.선반색상 !== '-' ? info.선반색상 : '',
      memo:        info.요청사항 !== '-' ? info.요청사항 : '',
    }
  }, window.location.origin);
}

/* ================================================================
   confirmStep용 — 수집 내용 텍스트 요약
================================================================ */
function buildConfirmSummary() {
  const info = extractFromHistory();
  const lines = [
    `👤 성함: ${info.이름}`,
    `📞 연락처: ${info.연락처}`,
    `📍 설치지역: ${info.설치지역}`,
    `📐 공간사이즈: ${info.공간사이즈.raw}`,
    `🪞 드레스룸 형태: ${info.형태}`,
  ];
  if (info.추가옵션 && info.추가옵션 !== '-' && !/없어요|없음/i.test(info.추가옵션)) {
    lines.push(`✨ 추가옵션: ${info.추가옵션}`);
  }
  if (info.프레임색상 && info.프레임색상 !== '-') {
    lines.push(`🎨 프레임색상: ${info.프레임색상}`);
  }
  if (info.선반색상 && info.선반색상 !== '-') {
    lines.push(`🎨 선반색상: ${info.선반색상}`);
  }
  if (info.요청사항 && info.요청사항 !== '-' && !/없어요|없음/i.test(info.요청사항)) {
    lines.push(`📝 요청사항: ${info.요청사항}`);
  }
  return lines.join('\n');
}

/* ================================================================
   메시지 전송
================================================================ */
async function send(prefilledText, retryEvent = null) {
  const text       = prefilledText !== undefined ? String(prefilledText) : document.getElementById('inp').value.trim();
  const hasPending = !prefilledText && !!getPendingFile();
  const editingMid = !prefilledText && getEditingMid();
  if ((!text && !hasPending) || getIsLoading()) return;

  /* 전송 시 타이핑 종료 */
  if (serverOnline) {
    fetch(`${SERVER}/api/session/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, typing: false }),
    }).catch(() => {});
  }

  /* ── 수정 모드 ── */
  if (editingMid && text) {
    applyEditToDom(editingMid, text);
    const entry = history.find(m => m.mid === editingMid);
    if (entry) entry.content = text;
    saveHistory();
    cancelEdit();
    clearInput();
    return;
  }

  /* ── 답장 상태 가져오기 ── */
  const replyTo = getPendingReply();
  clearPendingReply();

  /* ── 첨부 파일 먼저 업로드 ── */
  if (hasPending) {
    await uploadFilePending(async (url, name, isImage) => {
      const mid = allocMid();
      addFileMsg(url, name, isImage, mid);
      const fullUrl = url.startsWith('http') ? url : `${SERVER}${url}`;
      const content = isImage ? `[이미지]\n${fullUrl}` : `[파일: ${name}]\n${fullUrl}`;
      const event = createClientEvent(content);
      history.push({ role: 'user', content, eventId: event.id, mid, ts: new Date().toISOString() });
      saveHistory();
      if (serverOnline) {
        try {
          await persistSyncEvent(event);
        } catch {
          showFileSyncError(event);
        }
      }
    });
  }

  /* ── 텍스트가 없으면 여기서 종료 ── */
  if (!text) return;

  const mid = allocMid();
  // prefilledText 재시도 경로: 이미 화면에 user 버블이 있으므로 addMsg 스킵, history만 추가
  if (!prefilledText) {
    addMsg('user', text, { mid, replyTo });
    clearInput();
    setQuick([]);
  }
  const event = retryEvent || createClientEvent(text);
  history.push({ role: 'user', content: text, eventId: event.id, mid, replyTo: replyTo ?? undefined, ts: new Date().toISOString() });

  /* ── 접수 확인 단계 ── */
  if (pendingConfirm) {
    const isYes = /^(네|예|ㅇ|응|맞아|접수|좋아|확인|ok|yes)/i.test(text);
    const isNo  = /수정|아니|틀|다시|고칠|변경/i.test(text);

    if (isYes) {
      pendingConfirm = false;
      setLoading(true);
      await new Promise(r => setTimeout(r, 600));
      addMsg('bot', '감사합니다! 😊\n지금까지 말씀해 주신 내용을 정리해 드릴게요.\n아래 내용을 한 번 더 확인해 주세요.');
      history.push({ role: 'assistant', content: '견적 요청 확인 안내', ts: new Date().toISOString() });
      setLoading(false);
      setTimeout(() => showConfirm({ 고객정보: extractFromHistory() }), 1000);
      return;
    }

    if (isNo) {
      pendingConfirm = false;
      setLoading(true);
      await new Promise(r => setTimeout(r, 600));
      addMsg('bot', '네, 수정하고 싶으신 내용을 말씀해 주세요.\n성함·연락처·사이즈·형태 등 어느 것이든 다시 알려주시면 수정해 드릴게요 😊');
      history.push({ role: 'assistant', content: '수정 안내', ts: new Date().toISOString() });
      setLoading(false);
      return;
    }

    setLoading(true);
    await new Promise(r => setTimeout(r, 500));
    addMsg('bot', '죄송해요, 잘 이해하지 못했어요 😅\n지금 내용으로 접수하시겠어요? 아니면 수정할 부분이 있으신가요?');
    history.push({ role: 'assistant', content: '재확인 요청', ts: new Date().toISOString() });
    setQuick(['네, 접수할게요!', '아니요, 수정할게요'], true);
    setLoading(false);
    pendingConfirm = true;
    return;
  }

  setLoading(true);

  try {
    let reply, replyMessageId;

    if (serverOnline) {
      /* ── 실제 서버 AI 응답 ── */
      const res = await fetch(`${SERVER}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, sessionId: SESSION_ID, isTest: IS_TEST }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `서버 오류 (${res.status})`);
      }
      const data = await res.json();
      replyMessageId = data.messageId;

      /* ── admin이 난입 중이면 AI 응답 없음 ── */
      if (data.adminMode) {
        saveHistory();  // #22: user 메시지 localStorage 보존 (새로고침 시 소실 방지)
        setLoading(false);
        return;
      }

      reply = data.message;

    } else {
      /* ── 데모 응답 ── */
      await new Promise(r => setTimeout(r, 700 + Math.random() * 500));
      const s = DEMO[Math.min(demoIdx, DEMO.length - 1)];
      demoIdx++;

      reply = s.confirmStep
        ? `지금까지 말씀해 주신 내용을 정리했어요 😊\n\n${buildConfirmSummary()}\n\n위 내용으로 견적 접수를 도와드릴까요?`
        : s.say;

      setQuick(s.quick || [], s.choiceStep === true);
      history.push({ role: 'assistant', content: reply, ts: new Date().toISOString() });
      addMsg('bot', reply);
      updateCollectDrawer(demoIdx - 1);

      if (s.confirmStep) pendingConfirm = true;

      setLoading(false);
      return;
    }

    /* ── [SHOW_EXAMPLE:...] 태그 처리 ── */
    const exTag = reply.match(/\[SHOW_EXAMPLE:([^\]]*)\]/);
    if (exTag) {
      reply = reply.replace(/\[SHOW_EXAMPLE:[^\]]*\]/, '').trim();
      const parts   = exTag[1].split(':');
      const exShape = parts[0] || '';
      const exUnits = parts[1] || '';
      const exOpts  = parts[2] || '';
      // 같은 형태(shape) 예시는 세션당 최대 3개까지 표시
      const shownCount = history.filter(m => m.role === 'image' && m.label === `📐 ${exShape} 예시`).length;
      if (shownCount < 3) {
        fetch(`${SERVER}/api/find-example?shape=${encodeURIComponent(exShape)}&units=${encodeURIComponent(exUnits)}&options=${encodeURIComponent(exOpts)}`)
          .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(d => {
            if (d.success && typeof d.url === 'string') {
              const imgUrl = d.url.startsWith('http') ? d.url : `${SERVER}${d.url}`;
              const imgLabel = `📐 ${exShape} 예시`;
              history.push({ role: 'image', url: imgUrl, label: imgLabel });
              saveHistory();
              setTimeout(() => addImageMsg(imgUrl, imgLabel), 600);
            }
          })
          .catch(e => console.warn('예시 이미지 로딩 실패:', e));
      }
    }

    // 빈 응답 (API 오류 후 중복 방지용 빈 메시지) 무시
    if (!reply) { setLoading(false); return; }

    history.push({ role: 'assistant', content: reply, eventId: replyMessageId, ts: new Date().toISOString() });
    addMsg('bot', reply);
    if (!/케이트블랑.*견적서/.test(reply)) updateQuickFromText(reply);
    saveHistory();

    // (자동 화면 전환 제거 — 견적서가 채팅창에서 혼자 사라지는 버그 수정)
    // 1.2초 후 confirmView로 자동 전환되던 코드 제거. 두 가지 버그 동시 해결:
    // ① 견적서가 혼자 사라짐 ② 그 1.2초 사이 상담사가 적어준 견적도 같이 사라짐.

    // 부모 페이지(2패널 레이아웃)에 수집된 고객 정보 전달
    postFieldsToParent();

  } catch (err) {
    // 실패한 user 메시지 텍스트를 재전송 버튼에 캡처
    const failedEvent = (() => {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') return { content: history[i].content, id: history[i].eventId };
      }
      return null;
    })();

    const errMid = allocMid();
    const errDiv = document.createElement('div');
    errDiv.className = 'msg-group bot';
    errDiv.dataset.mid = errMid;
    const bubble = document.createElement('div');
    bubble.className = 'bubble bot';
    const errText = document.createElement('span');
    errText.textContent = `⚠️ 오류가 발생했습니다. ${err.message}`;
    bubble.appendChild(errText);
    if (failedEvent?.content) {
      const retryBtn = document.createElement('button');
      retryBtn.setAttribute('data-retry', '');
      retryBtn.style.cssText = 'margin-top:8px;padding:4px 10px;font-size:12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;display:block;';
      retryBtn.textContent = '↩ 다시 시도';
      bubble.appendChild(retryBtn);
    }
    errDiv.innerHTML = '<div class="av">👩‍💼</div>';
    const msgBody = document.createElement('div');
    msgBody.className = 'msg-body';
    msgBody.innerHTML = '<div class="msg-sender">루마네</div>';
    msgBody.appendChild(bubble);
    errDiv.appendChild(msgBody);
    document.getElementById('msgs').appendChild(errDiv);
    document.getElementById('msgs').scrollTop = 99999;

    if (failedEvent?.content) {
      errDiv.querySelector('[data-retry]')?.addEventListener('click', () => {
        // history에서 실패한 user 메시지 제거 후 재전송
        let idx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'user' && history[i].eventId === failedEvent.id) { idx = i; break; }
        }
        if (idx !== -1) history.splice(idx, 1);
        errDiv.remove();
        send(failedEvent.content, { id: failedEvent.id, content: failedEvent.content });
      });
    }
  } finally {
    setLoading(false);
  }
}

/* ================================================================
   첫 인사
================================================================ */
function greet() {
  if (serverOnline) {
    setLoading(true);
    fetch(`${SERVER}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, isTest: IS_TEST }),
    })
    .then(r => { if (!r.ok) throw new Error('greet failed'); return r.json(); })
    .then(data => {
      const reply = data.message;
      if (!reply) throw new Error('no message');
      history.push({ role: 'assistant', content: reply, eventId: data.messageId, ts: new Date().toISOString() });
      addMsg('bot', reply);
      saveHistory();
      setLoading(false);
      // 첫 인사 후 시작 도우미 — 모바일 진입 손님이 키보드 없이도 대화 시작 가능
      setQuick([
        '드레스룸 견적 받고 싶어요',
        '옵션이랑 가격 궁금해요',
        '그냥 둘러볼게요',
      ]);
    })
    .catch(() => {
      demoGreet();
    });
  } else {
    demoGreet();
  }
}

function demoGreet() {
  // showTyping은 setLoading(true)가 처리
  setLoading(true);
  setTimeout(() => {
    const s = DEMO[demoIdx++];
    history.push({ role: 'assistant', content: s.say, ts: new Date().toISOString() });
    addMsg('bot', s.say);
    setQuick(s.quick || [], s.choiceStep === true);
    setLoading(false);
  }, 800);
}

/* ================================================================
   새 상담 시작
================================================================ */
export function newChat() {
  archiveCurrent();
  SESSION_ID     = generateSessionId();
  history        = [];
  demoIdx        = 0;
  pendingConfirm = false;
  clearHistory();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (adminMode) {
    adminMode = false;
    showAdminBanner(false);
  }

  clearMessages();
  scrollBottom();
  setQuick([]);

  document.getElementById('confirmView').classList.remove('show');
  document.getElementById('doneView').classList.remove('show');
  document.getElementById('chatView').style.display = 'flex';

  resetCollect();
  appendDateSep(todayStr());
  greet();
  if (serverOnline) { registerSession(); startPolling(); }
}

/* ================================================================
   초기화
================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initScrollBehavior();
  initDateSep(todayStr());
  initInputListeners(send);

  /* 테스트 모드 표시 */
  if (IS_TEST) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#1c1917;text-align:center;font-size:12px;font-weight:700;padding:4px 8px;letter-spacing:.05em;pointer-events:none;';
    bar.textContent = '⚠️ 테스트 모드 — 이 대화는 저장되지 않습니다';
    document.body.prepend(bar);
    document.title = '[테스트] ' + document.title;
  }

  /* contenteditable 붙여넣기 — 순수 텍스트만 허용 */
  document.querySelectorAll('#quoteBox [contenteditable]').forEach(el => {
    el.addEventListener('paste', e => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  /* ESC로 견적서 오버레이 닫기 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('quoteOverlay').classList.contains('open')) {
      closeQuote(null);
    }
  });

  /* ── 메시지 액션 핸들러 등록 ── */
  setMsgActionHandlers({
    onReply: (mid, role, text) => setPendingReply(mid, role, text),
    onEdit:  (mid, text) => startEdit(mid, text, (t) => {
      document.getElementById('inp').value = t;
      document.getElementById('inp').dispatchEvent(new Event('input'));
      document.getElementById('inp').focus();
    }),
    onDelete: (mid) => {
      deleteFromDom(mid);
      history = history.filter(m => m.mid !== mid);
      saveHistory();
    },
  });

  /* ── 검색 초기화 ── */
  initSearch();

  /* 이전 상담 내역을 현재 history에 주입 — history.js에서 호출 */
  window.injectPreviousContext = function(summaryText) {
    history = history.filter(m => !m.injected); // 이전 주입 항목 제거 (연속 호출 대비)
    const safe = String(summaryText).slice(0, 2000);
    history.unshift(
      { role: 'user',      content: '[이전 상담 내용 요약 참고 요청]', injected: true },
      { role: 'assistant', content: safe, injected: true }
    );
    /* saveHistory() 생략 — 주입 항목을 localStorage에 저장하지 않음 */
  };

  /* HTML onclick에서 호출 가능하도록 window에 등록 */
  window.toggleHistory      = toggleHistory;
  window.toggleCollect      = toggleCollect;
  window.confirmBack        = confirmBack;
  window.confirmSubmit      = confirmSubmit;
  window.newChat            = newChat;
  window.closeQuote         = closeQuote;
  window.printQuote         = printQuote;
  window.showTranscript     = showTranscript;
  window.continueFromHistory = continueFromHistory;
  window.closeTranscript    = closeTranscript;
  window.toggleSearch       = toggleSearch;
  window.closeSearch        = closeSearch;

  /* 파일 업로드 초기화 (칩 방식 — 전송 시 send()에서 처리) */
  initFileInput();


  /* ── 고객 타이핑 신호 (어드민에게 전달) ── */
  let _customerTypingTimer = null;
  document.getElementById('inp').addEventListener('input', () => {
    if (!serverOnline) return;
    clearTimeout(_customerTypingTimer);
    fetch(`${SERVER}/api/session/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, typing: true }),
    }).catch(() => {});
    // 2초 후 타이핑 종료 신호
    _customerTypingTimer = setTimeout(() => {
      fetch(`${SERVER}/api/session/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, typing: false }),
      }).catch(() => {});
    }, 2000);
  });

  /* ── 닉네임 오버레이 처리 ── */
  const nicknameOverlay = document.getElementById('nicknameOverlay');
  const nicknameInput   = document.getElementById('nicknameInput');
  const nicknameBtn     = document.getElementById('nicknameBtn');
  const nicknameError   = document.getElementById('nicknameError');

  function startChatWithNickname() {
    const val = nicknameInput.value.trim();
    if (!val) {
      nicknameError.textContent = '닉네임을 입력해 주세요.';
      nicknameInput.focus();
      return;
    }
    userNickname = val;
    localStorage.setItem(NICKNAME_KEY, userNickname);
    nicknameOverlay.classList.add('hidden');
    startChat();
  }

  nicknameBtn.addEventListener('click', startChatWithNickname);
  nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startChatWithNickname();
  });
  nicknameInput.addEventListener('input', () => { nicknameError.textContent = ''; });

  // 닉네임 없으면 랜덤 자동 생성
  if (!userNickname) userNickname = _generateNickname();
  nicknameOverlay.classList.add('hidden');
  startChat();
});

/* ── 실제 채팅 초기화 (닉네임 확인 후 실행) ── */
async function startChat() {

  /* 서버 확인 후 인사 or 복원 + 세션 등록 + 폴링 시작 */
  checkServer().then(async () => {
    const savedHistory = loadHistory();

    if (savedHistory.length > 0 && isSessionExpired()) {
      /* ── 1시간 이상 경과 → 아카이브 후 새 채팅 ── */
      history = savedHistory;
      archiveCurrent();
      history = [];
      clearHistory();
      SESSION_ID = generateSessionId();
      clearMessages();
      greet();
      if (serverOnline) { registerSession(); startPolling(); }
    } else if (savedHistory.length > 0) {
      /* ── 새로고침 복원: 저장된 대화 화면에 다시 표시 ── */
      history = savedHistory;
      try {
        for (const m of savedHistory) {
          if (!m || !m.role) continue;
          if (m.role === 'image') {
            if (m.url && /^https?:\/\//.test(m.url)) addImageMsg(m.url, m.label || '');
            continue;
          }
          if (!m.content) continue;
          addMsg(m.role === 'assistant' ? 'bot' : 'user', m.content, {
            mid: m.mid,
            replyTo: m.replyTo ?? null,
            time: m.ts || m.time || null,
            skipQuoteImage: true,
            fromAdmin: !!m.fromAdmin,
          });
        }
      } catch (e) {
        /* 복원 실패 시 히스토리 초기화 후 새 인사 */
        console.warn('대화 복원 실패, 초기화 후 재시작:', e);
        history = [];
        clearHistory();
        clearMessages();
        greet();
        if (serverOnline) { registerSession(); startPolling(); }
        return;
      }
      /* 복원 완료 후 맨 아래로 스크롤 */
      setTimeout(() => scrollBottom(), 80);
      /* 서버가 DB 정본을 hydrate하도록 세션만 등록 */
      if (serverOnline) {
        await registerSession();
        startPolling();
      }
    } else {
      /* ── 최초 진입: 인사 ── */
      if (isSessionIdExpired()) SESSION_ID = generateSessionId();
      greet();
      if (serverOnline) {
        registerSession();
        startPolling();
      }
    }

  }).catch(() => {
    /* 예상치 못한 오류 시 데모 인사로 fallback */
    greet();
  });

  /* 브라우저 알림 권한 요청 */
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  /* 오프라인이면 30초마다 서버 재확인 (Render.com 절전 후 복귀 대응) */
  if (silentTimer) clearInterval(silentTimer);
  silentTimer = setInterval(checkServerSilent, 30000);

  /* 배포 자동감지 — 새 버전 배포 시 자동 새로고침 */
  startUpdateChecker();
}

/* ================================================================
   이전 상담 이력 조회 (Supabase, 연락처 기반)
================================================================ */
/* ================================================================
   배포 자동감지 (30초마다 /api/version 체크)
================================================================ */
let _deployedVersion = null;

async function startUpdateChecker() {
  // 현재 버전 초기화
  try {
    const r = await fetch(`${SERVER}/api/version`);
    if (r.ok) _deployedVersion = (await r.json()).v;
  } catch { /* 무시 */ }

  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(async () => {
    if (!serverOnline) return;
    try {
      const r = await fetch(`${SERVER}/api/version?t=${Date.now()}`);
      if (!r.ok) return;
      const { v } = await r.json();
      if (_deployedVersion && v !== _deployedVersion) {
        // 새 배포 감지 → 강제 새로고침 대신 배너 안내 (세션 분리 방지)
        setBanner('warn', '✨ 새 버전이 배포되었어요. 대화가 끝난 후 새로고침해 주세요.');
        clearInterval(updateTimer);
        updateTimer = null;
      }
    } catch { /* 무시 */ }
  }, 30000);
}
