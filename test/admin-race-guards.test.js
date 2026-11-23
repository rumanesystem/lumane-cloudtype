const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
// 실제 파일에서 함수 하나(또는 앞에 붙은 변수까지)를 꺼낸다
const pick = (file, re) => { const m = read(file).match(re); assert.ok(m, `${file}: ${re} 못 찾음`); return m[0]; };

// 응답을 원하는 때에 돌려주는 가짜 요청 (늦게 온 응답 흉내)
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const okJson = body => ({ ok: true, json: async () => body });
const tick = () => new Promise(r => setImmediate(r));

function fakeEl() {
  return { value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    focused: 0, focus() { this.focused++; }, insertAdjacentHTML() {}, querySelector() { return null; } };
}
function fakeDocument(ids) {
  const els = Object.fromEntries(ids.map(id => [id, fakeEl()]));
  return { els, document: { hidden: false, getElementById: id => els[id] || null } };
}

// ── 대화 탭: 늦게 온 이전 손님 대화 ──
function liveMsgsContext() {
  const { els, document } = fakeDocument(['liveMsgs']);
  const pending = [];
  const rendered = [];
  const context = vm.createContext({
    String, JSON, window: {}, document, SERVER: '', serverOnline: true,
    adminHeaders: () => ({}),
    adminFetch: url => { const d = deferred(); pending.push({ url, d }); return d.promise; },
    renderLiveChatPanel: s => rendered.push(s.id),
    _liveSelectedByClick: false, _cachedLiveSessions: [],
    _saveSeenCount() {}, _refreshDashBadge() {},
  });
  vm.runInContext('var liveSelectedId = null;', context);
  vm.runInContext(pick('js/admin-live-messages.js', /async function fetchLiveSessionMsgs\(\) \{[\s\S]*?\n\}\n/), context);
  return { context, els, pending, rendered };
}

test('대화 탭: 손님 A 대화를 받는 사이 B 로 바꾸면 늦게 온 A 대화는 화면에 안 그림', async () => {
  const { context, pending, rendered } = liveMsgsContext();
  vm.runInContext('liveSelectedId = "S-A"', context);
  const run = vm.runInContext('fetchLiveSessionMsgs()', context);
  vm.runInContext('liveSelectedId = "S-B"', context);
  pending[0].d.resolve(okJson({ session: { id: 'S-A', mode: 'admin', messages: [] } }));
  await run;
  assert.match(pending[0].url, /S-A/);
  assert.deepEqual(rendered, []);
});

test('대화 탭: 그대로 A 를 보고 있으면 A 대화를 그림', async () => {
  const { context, pending, rendered } = liveMsgsContext();
  vm.runInContext('liveSelectedId = "S-A"', context);
  const run = vm.runInContext('fetchLiveSessionMsgs()', context);
  pending[0].d.resolve(okJson({ session: { id: 'S-A', mode: 'admin', messages: [] } }));
  await run;
  assert.deepEqual(rendered, ['S-A']);
});

test('대화 탭: 서버가 다른 상담 내용을 돌려주면 그리지 않음', async () => {
  const { context, pending, rendered } = liveMsgsContext();
  vm.runInContext('liveSelectedId = "S-A"', context);
  const run = vm.runInContext('fetchLiveSessionMsgs()', context);
  pending[0].d.resolve(okJson({ session: { id: 'S-B', mode: 'admin', messages: [] } }));
  await run;
  assert.deepEqual(rendered, []);
});

// ── 대화 탭: 보내는 사이 다른 손님으로 옮김 ──
function sendAdminContext() {
  const { els, document } = fakeDocument(['liveInput']);
  const posts = [];
  const upload = deferred();
  const context = vm.createContext({
    String, JSON, Date, document, SERVER: '', location: { origin: 'http://x' },
    FormData: class { append() {} },
    fetch: () => upload.promise,
    adminHeaders: () => ({}),
    adminFetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return okJson({}); },
    clearAdminReplyBar() {}, clearAdminPendingFile() { vm.runInContext('adminPendingFile = null', context); },
    sendAdminTyping() {}, refreshAdminSendBtn() {}, showToast() {}, fetchLiveSessionMsgs: async () => {},
    _adminReplyContent: '', _typingTimer: null, clearTimeout() {},
  });
  vm.runInContext('var liveSelectedId = null, liveAdminMode = false, adminPendingFile = null;', context);
  vm.runInContext(pick('js/admin-mode.js', /async function sendAdminMsg\(\) \{[\s\S]*?\n\}\n/), context);
  return { context, els, posts, upload };
}

test('대화 탭: 사진 올리는 사이 다른 손님으로 옮겨도 사진·글은 처음 손님에게만 감', async () => {
  const { context, els, posts, upload } = sendAdminContext();
  vm.runInContext('liveSelectedId = "S-A"; liveAdminMode = true; adminPendingFile = { name: "a.png" };', context);
  els.liveInput.value = '사진 보냈어요';
  const run = vm.runInContext('sendAdminMsg()', context);
  vm.runInContext('liveSelectedId = "S-B"; liveAdminMode = false;', context);  // AI 가 응대 중인 손님으로 옮김
  upload.resolve(okJson({ success: true, url: '/uploads/a.png', isImage: true }));
  await run;
  assert.deepEqual(posts.map(p => p.body.sessionId), ['S-A', 'S-A']);
  assert.equal(els.liveInput.disabled, true, 'AI 상담으로 옮겼으면 입력칸은 꺼진 채로');
  assert.equal(els.liveInput.focused, 0);
});

test('대화 탭: 같은 손님에게 보내면 끝난 뒤 입력칸이 켜지고 커서가 들어감', async () => {
  const { context, els, posts } = sendAdminContext();
  vm.runInContext('liveSelectedId = "S-A"; liveAdminMode = true;', context);
  els.liveInput.value = '안녕하세요';
  await vm.runInContext('sendAdminMsg()', context);
  assert.deepEqual(posts.map(p => p.body.sessionId), ['S-A']);
  assert.equal(els.liveInput.disabled, false);
  assert.equal(els.liveInput.focused, 1);
});

// ── 저장된 대화 팝업 ──
function popupContext() {
  const { els, document } = fakeDocument(['historyDetailOverlay', 'hdTitle', 'hdMeta', 'hdSummary', 'hdMsgs',
    'hdReplyInput', 'hdReplyArea', 'hdSendBtn']);
  const pending = [];
  const posts = [];
  let postGate = null;  // 정해 두면 전송 요청이 그 때까지 기다림
  const context = vm.createContext({
    String, JSON, Number, Date, Set, Error, window: {}, document, SERVER: '',
    adminHeaders: () => ({}),
    adminFetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); if (postGate) await postGate.promise; return okJson({}); }
      const d = deferred(); pending.push({ url, d }); return d.promise;
    },
    getConvLabel: c => c.label, parseSummary: () => null, escAdmin: s => String(s),
    parseLiveAttachment: () => null, createLiveAttachmentElement() {}, showToast() {},
  });
  vm.runInContext('let _currentHistoryId = null; let _currentHdSessionId = null;', context);
  vm.runInContext(pick('js/admin.js', /async function openHistoryDetail\(id\) \{[\s\S]*?\n\}\n/), context);
  vm.runInContext(pick('js/admin.js', /const _hdSendingIds = new Set\(\);[\s\S]*?async function sendHdReply\(\) \{[\s\S]*?\n\}\n/), context);
  return { context, els, pending, posts, gate: () => { postGate = deferred(); return postGate; } };
}
const conv = (id, sessionId, label) => okJson({ conversation: { id, session_id: sessionId, label, messages: [] } });

test('팝업: A 팝업 내용이 늦게 와도 지금 열린 B 팝업을 덮어쓰지 않음', async () => {
  const { context, els, pending } = popupContext();
  const runA = vm.runInContext('openHistoryDetail("101")', context);
  const runB = vm.runInContext('openHistoryDetail("102")', context);
  pending[1].d.resolve(conv('102', 'S-B', '손님B'));
  await runB;
  pending[0].d.resolve(conv('101', 'S-A', '손님A'));
  await runA;
  assert.equal(els.hdTitle.textContent, '손님B');
  assert.equal(vm.runInContext('_currentHdSessionId', context), 'S-B');
});

test('팝업: 답장 보내는 사이 다른 팝업을 열어도 답장은 처음 손님에게만 감', async () => {
  const { context, els, pending, posts, gate } = popupContext();
  const openA = vm.runInContext('openHistoryDetail("101")', context);
  pending[0].d.resolve(conv('101', 'S-A', '손님A'));
  await openA;
  els.hdReplyInput.value = '확인했습니다';
  const g = gate();
  const send = vm.runInContext('sendHdReply()', context);
  await tick();
  const openB = vm.runInContext('openHistoryDetail("102")', context);
  pending[1].d.resolve(conv('102', 'S-B', '손님B'));
  await openB;
  g.resolve();
  await send;
  assert.deepEqual(posts.map(p => p.body.sessionId), ['S-A', 'S-A']);
  assert.equal(els.hdSendBtn.disabled, false, 'B 팝업 전송 버튼은 보통 상태');
});

test('팝업: 보내는 중에 Enter 를 또 눌러도 한 번만 보냄', async () => {
  const { context, els, pending, posts, gate } = popupContext();
  const openA = vm.runInContext('openHistoryDetail("101")', context);
  pending[0].d.resolve(conv('101', 'S-A', '손님A'));
  await openA;
  els.hdReplyInput.value = '확인했습니다';
  const g = gate();
  const first = vm.runInContext('sendHdReply()', context);
  await tick();
  const second = vm.runInContext('sendHdReply()', context);
  g.resolve();
  await Promise.all([first, second]);
  assert.equal(posts.filter(p => /\/message$/.test(p.url)).length, 1);
});

// ── 한글 조합 중 Enter ──
// admin.html 의 Enter 보내기 칸들을 실제 속성 그대로 실행해 본다
function adminEnterHandlers() {
  const html = read('admin.html');
  // 대화 탭 입력칸은 input, 메모·팝업 답장은 textarea
  return [...html.matchAll(/<(?:textarea|input)\b[^>]*?\bid="(\w+)"[^>]*?onkeydown="([^"]*Enter[^"]*)"/g)].map(m => ({ id: m[1], code: m[2] }));
}
function runHandler(code, event) {
  const calls = [];
  const context = vm.createContext({
    event, window: { lvAddMemo: () => calls.push('lvAddMemo'), hdAddMemo: () => calls.push('hdAddMemo') },
    sendAdminMsg: () => calls.push('sendAdminMsg'), sendHdReply: () => calls.push('sendHdReply'),
  });
  vm.runInContext(code.replace(/&amp;/g, '&'), context);
  return calls;
}
const keyEvent = o => Object.assign({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault() {} }, o);

test('관리자 화면: 한글 조합 중 Enter 로는 보내지 않고, 조합 끝난 Enter 로 한 번 보냄', () => {
  const handlers = adminEnterHandlers();
  assert.deepEqual(handlers.map(h => h.id).sort(), ['hdMemoInput', 'hdReplyInput', 'liveInput', 'lvMemoInput']);
  for (const h of handlers) {
    assert.deepEqual(runHandler(h.code, keyEvent({ isComposing: true, keyCode: 229 })), [], `${h.id}: 크롬 조합 중`);
    assert.deepEqual(runHandler(h.code, keyEvent({ keyCode: 229 })), [], `${h.id}: 사파리 조합 확정`);
    assert.equal(runHandler(h.code, keyEvent({})).length, 1, `${h.id}: 보통 Enter`);
    assert.deepEqual(runHandler(h.code, keyEvent({ shiftKey: true })), [], `${h.id}: Shift+Enter 는 줄바꿈`);
  }
});

test('손님 화면: 한글 조합 중 Enter 로는 보내지 않음', () => {
  const src = pick('js/ui.js', /\$inp\.addEventListener\('keydown', e => \{[\s\S]*?\n {2}\}\);\n/);
  const sent = [];
  let handler;
  const $inp = { addEventListener: (_t, fn) => { handler = fn; }, value: '', selectionStart: 0, selectionEnd: 0 };
  const context = vm.createContext({ $inp, onSend: () => sent.push(1), autoResize() {}, refreshSendBtn() {} });
  vm.runInContext(src, context);
  handler(keyEvent({ isComposing: true, keyCode: 229 }));
  handler(keyEvent({ keyCode: 229 }));
  assert.equal(sent.length, 0);
  handler(keyEvent({}));
  assert.equal(sent.length, 1);
});

// keydown 등록 한 줄(+본문)을 꺼내 실제로 눌러 본다
function pressAll(file, re, input, names) {
  const calls = [];
  let handler;
  const target = { addEventListener: (type, fn) => { if (type === 'keydown') handler = fn; } };
  const context = vm.createContext({ [input]: target, ...Object.fromEntries(names.map(n => [n, () => calls.push(n)])) });
  vm.runInContext(pick(file, re), context);
  handler(keyEvent({ isComposing: true, keyCode: 229 }));
  handler(keyEvent({ keyCode: 229 }));
  const composing = calls.length;
  handler(keyEvent({}));
  return { composing, normal: calls.length - composing };
}

test('손님 이름 칸·손님 대화 검색·관리자 검색도 조합 중 Enter 는 무시', () => {
  const cases = [
    ['js/chat.js', /nicknameInput\.addEventListener\('keydown', e => \{\n[^\n]*\n {2}\}\);/, 'nicknameInput', ['startChatWithNickname']],
    ['js/search.js', /inp\.addEventListener\('keydown', e => \{\n[\s\S]*?\n {2}\}\);/, 'inp', ['step', 'closeSearch']],
    ['js/admin-mode.js', /inp\.addEventListener\('keydown', e => \{\n[^\n]*stepAdminSearch[\s\S]*?\n {2}\}\);/, 'inp', ['stepAdminSearch', 'closeAdminSearch']],
  ];
  for (const [file, re, input, names] of cases) {
    const r = pressAll(file, re, input, names);
    assert.equal(r.composing, 0, `${file}: 조합 중 Enter`);
    assert.equal(r.normal, 1, `${file}: 보통 Enter`);
  }
});
