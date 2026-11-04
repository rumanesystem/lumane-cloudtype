'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createFixture } = require('./fixtures/chatbot-review');

async function start(t) {
  const h = createFixture();
  const server = await new Promise(resolve => { const s = h.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  h.send = async (id, content, eventId = `msg_${randomUUID()}`) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id, event: { id: eventId, content } }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return h;
}
const firstId = 'S-1793698000000-aaaaaaaaaaaaaaaaaaaaaaaa12345678';
const otherId = 'S-1793698000001-bbbbbbbbbbbbbbbbbbbbbbbb12345678';

test('unowned legacy short keys block automatic overwrite and duplicate registration', async t => {
  const h = await start(t);
  h.rows['public.quotes'] = [{ quote_number: 'KB-AI-12345678', name: '기존가상고객' }];
  h.rows['customer.install'] = [{ source_ref: 'KB-AI-12345678', quote_amount: 420000, status: '시공완료' }];
  const sess = h.context.getOrCreateSession(firstId);
  sess.messages = [{ role: 'user', content: '1post 견적' }, { role: 'assistant', content: '견적서\n총 합계: 1,200,000원' }];
  sess.customerName = '가상고객'; sess.customerNameIsTemp = false; sess.customerPhone = '010-0000-0000';
  await h.context.reconcileRecoveredQuoteState(sess);
  await assert.rejects(h.context.autoRegisterQuote(sess, sess.messages.at(-1).content), { code: 'AI_QUOTE_IDENTITY_REVIEW' });
  assert.equal(h.rows['public.quotes'].length, 1);
  assert.equal(h.rows['customer.install'].length, 1);
  assert.equal(h.rows['customer.install'][0].quote_amount, 420000);
  assert.equal(h.rows['customer.install'][0].status, '시공완료');
});

test('isolated HTTP persistence keeps distinct customers with identical short ID suffixes', async t => {
  const h = await start(t);
  await h.send(firstId, '1post 견적 010-0000-0000');
  await h.send(otherId, '1post 수정 견적 010-0000-0001');
  assert.equal(h.rows['public.quotes'].length, 2);
  assert.ok(h.rows['public.quotes'].every(row => /^KB-AI-[A-F0-9]{32}$/.test(row.quote_number)));
  assert.ok(h.rows['public.quotes'].every(row => !row.quote_number.includes(firstId)));
  assert.equal(h.rows['customer.install'].length, 2);
  assert.deepEqual(h.rows['customer.install'].map(row => row.quote_amount), [1200000, 1350000]);
  h.context.sessions.clear();
  await h.send(firstId, '수정2 견적');
  assert.deepEqual(h.rows['customer.install'].map(row => row.quote_amount), [1500000, 1350000]);
});

test('reload hydrates identity, preserves CRM status, and never registers a provisional subtotal', async t => {
  const h = await start(t);
  const event = `msg_${randomUUID()}`;
  const input = '1post 신규아파트 견적 010-0000-0000';
  await h.send(firstId, input, event);
  assert.equal(h.rows['public.conversations'][0].phone, '010-0000-0000');
  assert.equal(h.rows['public.conversations'][0].estimated_price, 1080000);
  const install = h.rows['customer.install'][0];
  install.status = '시공예정';
  install.owner = 'fixture-owner';
  await h.send(firstId, '더도어 ㅡ자; A=3300mm; 옵션=없음');
  assert.equal(h.rows['public.conversations'][0].estimated_price, null);
  assert.equal(h.rows['public.conversations'][0].phone, '010-0000-0000');
  assert.equal(install.quote_amount, 1080000);
  h.context.sessions.clear();
  const recovered = await h.context.ensureSessionHydrated(firstId);
  recovered.isReturning = true;
  recovered.previousQuoteSummary = '견적 1,080,000원';
  await h.send(firstId, '아직 이사 전이라 천천히 알아볼게요');
  assert.equal(h.context.sessions.get(firstId).customerPhone, '010-0000-0000');
  assert.equal(h.rows['public.conversations'][0].estimated_price, null);
  assert.equal(h.modelCalls.at(-1).system.at(-1).text.includes('현재 상담 제품은 더도어'), true);
  assert.equal(h.modelCalls.at(-1).system.some(block => block.text.includes('[재방문 고객 컨텍스트]')), false);
  await h.send(firstId, '1post 수정 신규아파트 견적');
  assert.equal(install.quote_amount, 1215000);
  assert.equal(install.status, '시공예정');
  assert.equal(install.owner, 'fixture-owner');
  await h.send(firstId, input, event); // Old response replay must not write its old amount.
  assert.equal(install.quote_amount, 1215000);
  await h.send(firstId, '수정2 신규아파트 최종 견적');
  assert.equal(install.quote_amount, 1380000);
  assert.equal(h.rows['public.conversations'][0].estimated_price, 1380000);
  assert.equal(h.rows['public.quotes'].length, 1);
  assert.equal(h.rows['customer.install'].length, 1);
});
