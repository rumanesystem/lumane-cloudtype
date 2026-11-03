'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runOptionalSync } = require('../lib/optional-sync');
const product = require('../lib/product-quote');
const contract = require('../lib/conversation-contract');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Load only the real functions under review. Never import server.js, dotenv or SDKs.
function harness() {
  const writes = [];
  const notifications = [];
  const recoveredRows = {};
  const db = schema => ({ from: table => ({
    upsert: async payload => { writes.push({ schema, table, operation: 'upsert', payload }); return {}; },
    update: payload => ({ eq: async (key, value) => { writes.push({ schema, table, operation: 'update', payload, key, value }); return {}; } }),
    select: () => ({ eq: () => ({ maybeSingle: async () => recoveredRows[`${schema}.${table}`] || null }) }),
  }) });
  const context = vm.createContext({
    ...product,
    supabase: db('public'), supabaseCustomer: db('customer'),
    executeSupabase: async (_label, operation) => operation(), runOptionalSync,
    notifySlack: (...args) => notifications.push(args),
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(source.slice(source.indexOf('function parseOrderSheet(text)'), source.indexOf('// ── 대화 종료 시 save_reason')), context);
  vm.runInContext(source.slice(source.indexOf('async function reconcileRecoveredQuoteState(sess)'), source.indexOf('async function ensureSessionHydrated')), context);
  return { context, writes, notifications, recoveredRows };
}
const session = reply => ({ id: 'review_mock_12345678', messages: [{ role: 'user', content: '견적 문의' }, { role: 'assistant', content: reply }], startedAt: '2026-11-03T00:00:00Z' });

test('total-only and template quotations use the same detection in both storage paths', async () => {
  for (const reply of ['총 합계: 1,200,000원', '[금액]\n- 할인 후 금액: 1,200,000원\n[배송비]\n- 별도: 30,000원']) {
    const { context, writes } = harness();
    const sess = session(reply);
    await context.upsertConversation(sess);
    await context.autoRegisterQuote(sess, reply);
    assert.equal(writes.find(w => w.table === 'conversations').payload.estimated_price, 1200000);
    assert.equal(writes.filter(w => w.table === 'quotes').length, 1);
  }
});

test('legacy final or discounted amount wins over pre-discount subtotal; shipping is not added', () => {
  const { context } = harness();
  assert.equal(context.parseOrderSheet('견적서\n총 합계: 1,200,000원\n할인 후 금액: 1,080,000원\n배송비: 30,000원 별도').estimated_price, 1080000);
  assert.equal(context.parseOrderSheet('견적서\n총 합계: 1,200,000원\n최종 금액: 1,110,000원').estimated_price, 1110000);
  assert.equal(context.parseOrderSheet('견적서\n총 합계: 420,000원').estimated_price, 420000);
});

test('revised legacy CRM amount updates pricing only, preserving operational status', async () => {
  const { context, writes } = harness();
  const sess = { ...session(''), customerName: '가상고객', customerPhone: '010-0000-0000' };
  await context.autoRegisterQuote(sess, '견적서\n총 합계: 1,200,000원');
  await context.autoRegisterQuote(sess, '견적서\n총 합계: 1,350,000원');
  const crm = writes.filter(w => w.schema === 'customer');
  assert.equal(crm.length, 2);
  assert.equal(crm[1].operation, 'update');
  assert.equal(crm[1].payload.quote_amount, 1350000);
  assert.equal(crm[1].payload.status, undefined);
  assert.equal(crm[1].key, 'source_ref');
});

test('new product preliminary amounts never become final storage or notifications', async () => {
  const { context, writes, notifications } = harness();
  const reply = '[신규상품 예상안내]\n더도어\n기본·옵션 예상 소계: 1,200,000원\n배송·할인·VAT·시공 조건 미확정';
  const sess = session('견적서\n총 합계: 420,000원');
  sess.messages.push({ role: 'user', content: '더도어 견적' }, { role: 'assistant', content: reply });
  await context.upsertConversation(sess);
  await context.autoRegisterQuote(sess, reply);
  // An old cached reply must not register the earlier product after the switch.
  await context.autoRegisterQuote(sess, '견적서\n총 합계: 420,000원');
  assert.equal(writes.find(w => w.table === 'conversations').payload.estimated_price, null);
  assert.equal(writes.some(w => w.table === 'quotes'), false);
  assert.equal(notifications.length, 0);
});

function chatHarness(initial = {}) {
  const h = harness();
  const sess = { id: 'review_mock_12345678', messages: [], startedAt: '2026-11-03T00:00:00Z', mode: 'ai', customerName: '가상고객', ...initial };
  const sessions = new Map([[sess.id, sess]]);
  let handler;
  let modelCalls = 0;
  Object.assign(h.context, contract, {
    sessions,
    app: { post: (_url, _limit, callback) => { handler = callback; } },
    chatRateLimit: () => {}, withSerializedSession: callback => callback,
    ensureSessionHydrated: async () => sess, isSessionBlocked: () => false,
    SESSION_ID_RE: /^[\w-]+$/, isRelevantMessage: async () => true,
    buildApiMessages: async messages => messages,
    getSystemPrompt: () => 'legacy guidance unchanged',
    addTokenUsage: async () => {},
    client: { messages: { create: async () => {
      modelCalls++;
      return { content: [{ type: 'text', text: '견적서\n총 합계: 1,200,000원\n할인 후 금액: 1,080,000원\n배송비: 30,000원 별도' }], usage: {} };
    } } },
  });
  vm.runInContext(source.slice(source.indexOf("app.post('/api/chat',"), source.indexOf('// ── 세션 등록 API')), h.context);
  let sequence = 0;
  const event = content => ({ id: `msg_123e4567-e89b-42d3-a456-${String(++sequence).padStart(12, '0')}`, content });
  const send = async input => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ body: { sessionId: sess.id, event: input }, ip: '127.0.0.1' }, response);
    return response;
  };
  return { ...h, sess, event, send, modelCalls: () => modelCalls };
}

test('actual chat handler renders/persists a deterministic preview and deduplicates retries', async () => {
  const h = chatHarness();
  const input = h.event('더도어 ㄱ자; A=1575mm; B=1575mm; 옵션=2단서랍:1');
  const first = await h.send(input);
  const second = await h.send(input);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.message, second.body.message);
  assert.equal(first.body.messageId, second.body.messageId);
  assert.equal(second.body.deduplicated, true);
  assert.equal(h.modelCalls(), 0);
  const persisted = h.writes.filter(w => w.table === 'conversations').at(-1).payload;
  assert.equal(persisted.estimated_price, null);
  const preview = persisted.messages.at(-1).quotePreview;
  assert.equal(preview.knownSubtotal, 1470000);
  assert.equal(preview.input.options[0].quantity, 1);
  assert.equal(preview.total, null);
  assert.equal(h.sess.messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(h.writes.some(w => w.table === 'quotes' || w.schema === 'customer'), false);
  assert.equal(h.notifications.some(([event]) => event === 'AI견적등록'), false);
});

test('failed preview persistence returns 503 and same event can retry without a second message', async () => {
  const h = chatHarness();
  const execute = h.context.executeSupabase;
  let writes = 0;
  h.context.executeSupabase = async (...args) => {
    if (++writes === 2) throw new Error('mock storage unavailable'); // assistant write, after user commit
    return execute(...args);
  };
  const input = h.event('더도어 ㅡ자; A=3000mm; 옵션=없음');
  assert.equal((await h.send(input)).statusCode, 503);
  const retried = await h.send(input);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.deduplicated, true);
  assert.equal(h.sess.messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(h.modelCalls(), 0);
});

test('legacy/new-product/legacy transitions keep partial amounts out of customer records', async () => {
  const h = chatHarness({ customerPhone: '010-0000-0000' });
  await h.send(h.event('기존 행거 신규아파트 견적'));
  assert.equal(h.modelCalls(), 1);
  assert.equal(h.writes.find(w => w.schema === 'customer').payload[0].quote_amount, 1080000);
  const customerWrites = h.writes.filter(w => w.schema === 'customer').length;
  await h.send(h.event('팬트리 ㄱ자; A=1115mm; B=1235mm; 단수=7'));
  assert.equal(h.sess.messages.at(-1).quotePreview.status, 'needs_layout');
  assert.equal(h.writes.filter(w => w.table === 'conversations').at(-1).payload.estimated_price, null);
  assert.equal(h.writes.filter(w => w.schema === 'customer').length, customerWrites);
  assert.equal(h.sess.lastQuoteReply, null);
  await h.send(h.event('1post 견적으로 다시 안내해 주세요'));
  assert.equal(h.modelCalls(), 2);
  assert.equal(h.writes.filter(w => w.table === 'conversations').at(-1).payload.estimated_price, 1080000);
});

test('restored new-product history keeps product/input metadata and clears stale legacy registration', async () => {
  const h = chatHarness();
  await h.send(h.event('더도어 ㅡ자; A=3000mm; 옵션=없음'));
  const recovered = JSON.parse(JSON.stringify(h.sess));
  recovered.messages = contract.normalizeStoredMessages(recovered.messages);
  recovered.lastQuoteReply = '견적서\n총 합계: 420,000원';
  const next = chatHarness(recovered);
  await next.context.reconcileRecoveredQuoteState(next.sess);
  assert.equal(next.sess.lastQuoteReply, null);
  const response = await next.send({ id: 'msg_123e4567-e89b-42d3-a456-999999999999', content: 'ㅡ자; A=3300mm; 옵션=없음' });
  assert.match(response.body.message, /1,320,000원/);
  assert.equal(next.sess.messages.at(-1).quotePreview.productType, 'thedoor');
  assert.equal(next.modelCalls(), 0);
});

test('phone submission with a revised legacy quote cannot race the cached earlier amount', async () => {
  const h = chatHarness({ lastQuoteReply: '견적서\n총 합계: 420,000원' });
  await h.send(h.event('기존 행거 견적 수정, 010-0000-0000'));
  const crm = h.writes.filter(w => w.schema === 'customer');
  assert.equal(crm.length, 1);
  assert.equal(crm[0].payload[0].quote_amount, 1080000);
});

test('optional CRM update failure leaves the quote saved and remains retryable', async () => {
  const { context, writes, notifications } = harness();
  const sess = { ...session(''), customerName: '가상고객', customerPhone: '010-0000-0000', customerInstallSaved: true };
  const execute = context.executeSupabase;
  context.executeSupabase = async (label, operation) => {
    if (label === 'AI customer.install quote update') throw new Error('mock customer write failure');
    return execute(label, operation);
  };
  await context.autoRegisterQuote(sess, '견적서\n총 합계: 1,350,000원');
  assert.equal(writes.filter(w => w.table === 'quotes').length, 1);
  assert.equal(notifications.some(([event]) => event === '고객DB연동실패'), true);
  context.executeSupabase = execute;
  await context.autoRegisterQuote(sess, '견적서\n총 합계: 1,350,000원');
  assert.equal(writes.filter(w => w.schema === 'customer').at(-1).payload.quote_amount, 1350000);
});

test('retrying an earlier event does not replace the latest quote amount in CRM', async () => {
  const h = chatHarness({ customerPhone: '010-0000-0000' });
  const first = h.event('기존 행거 견적');
  await h.send(first);
  h.context.client.messages.create = async () => ({ content: [{ text: '견적서\n총 합계: 1,350,000원' }], usage: {} });
  await h.send(h.event('옵션을 추가한 새 견적'));
  const before = h.writes.filter(w => w.schema === 'customer').length;
  await h.send(first);
  const crm = h.writes.filter(w => w.schema === 'customer');
  assert.equal(crm.length, before);
  assert.equal(crm.at(-1).payload.quote_amount, 1350000);
});

test('recovery during a provisional product keeps existing CRM identity for a later 1post revision', async () => {
  const h = chatHarness({ customerPhone: '010-0000-0000', messages: [
    { role: 'user', content: '더도어 견적' },
    { role: 'assistant', content: '[신규상품 예상안내]\n최종금액 미확정' },
  ] });
  h.recoveredRows['public.quotes'] = { quote_number: 'KB-AI-12345678' };
  h.recoveredRows['customer.install'] = { source_ref: 'KB-AI-12345678' };
  await h.context.reconcileRecoveredQuoteState(h.sess);
  assert.equal(h.sess.lastQuoteReply, null);
  assert.equal(h.sess.customerInstallSaved, true);
  assert.equal(h.sess.quoteNotified, true);
  await h.send(h.event('1post 견적으로 돌아갈게요'));
  const crm = h.writes.filter(w => w.schema === 'customer');
  assert.equal(crm.length, 1);
  assert.equal(crm[0].operation, 'update');
  assert.equal(crm[0].payload.status, undefined);
});

test('new-product guidance never offers the legacy 1post option quick buttons', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
  const fn = ui.slice(ui.indexOf('export function updateQuickFromText'), ui.indexOf('/* ── 서버 상태 배너')).replace('export ', '');
  const choices = [];
  const context = vm.createContext({ setQuick: buttons => choices.push(Array.from(buttons)) });
  vm.runInContext(fn, context);
  context.updateQuickFromText(product.createProductReply([{ role: 'user', content: '더도어 견적' }]).content);
  assert.deepEqual(choices.at(-1), []);
  context.updateQuickFromText('옵션 추가 원하시나요?');
  assert.ok(choices.at(-1).includes('거울장')); // Preserve the original product's buttons.
});
