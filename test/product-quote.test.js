'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../lib/product-quote');
const user = content => ({ role: 'user', content });
const quote = (length, options = []) => api.computeThedoor({ shape: 'ㅡ자', lengths: { A: length }, options });

test('product description and general conversation do not enter the quotation parser', () => {
  const description = api.createProductReply([user('더도어는 어떤 제품인가요?')]);
  assert.equal(description.quotePreview.status, 'information');
  assert.doesNotMatch(description.content, /형태와 면별 길이|전체 입력을 다시/);
  assert.equal(api.createProductReply([user('더도어 견적'), user('아직 이사 전이라 천천히 알아볼게요')]), null);
  assert.equal(api.createProductReply([user('팬트리'), user('고마워요')]), null);
  assert.equal(api.createProductReply([user('팬트리와 더도어 비교'), user('고마워요')]), null);
  assert.equal(api.createProductReply([user('2post는 어떤 제품인가요?')]).quotePreview.status, 'information');
  assert.equal(api.createProductReply([user('더도어'), user('옵션은 어떤 것이 있나요?')]).quotePreview.status, 'information');
  assert.match(api.createProductReply([user('더도어'), user('신규아파트 할인과 배송비는요?')]).content, /미확정/);
  assert.equal(api.createProductReply([user('더도어'), user('측판만 추가해줘')]).quotePreview.status, 'needs_input');
});

test('new product conversational restrictions disappear on an explicit legacy switch', () => {
  assert.match(api.getProductConversationPrompt([user('팬트리')]), /현재 상담 제품은 팬트리/);
  assert.equal(api.getProductConversationPrompt([user('더도어'), user('1post로 바꿀게요')]), null);
});

test('the door uses the aggregate 150mm boundary and ten-ja minimum', () => {
  assert.equal(typeof api.computeThedoor, 'function');
  for (const [length, ja, amount] of [[1, 10, 1200000], [2999, 10, 1200000], [3149, 10, 1200000], [3150, 11, 1320000], [3151, 11, 1320000]]) {
    const result = quote(length);
    assert.equal(result.ja, ja);
    assert.equal(result.baseAmount, amount);
    assert.equal(result.total, null);
  }
  const result = api.computeThedoor({ shape: 'ㄱ자', lengths: { A: 1575, B: 1575 }, options: [] });
  assert.equal(result.ja, 11); // Round the sum, never each face.
});

test('all canonical shapes are quote-only; no fabricated drawing or corner deduction', () => {
  for (const [shape, lengths] of [['ㅡ자', { A: 3300 }], ['ㄱ자', { A: 1650, B: 1650 }], ['ㄷ자', { A: 1100, B: 1100, C: 1100 }], ['11자', { A: 1650, C: 1650 }], ['ㅁ자', { A: 825, B: 825, C: 825, D: 825 }]]) {
    const result = api.computeThedoor({ shape, lengths, options: [] });
    assert.equal(result.baseAmount, 1320000);
    assert.equal(result.optionsAmount, 0); // No automatic pillar or side-panel.
    assert.equal(result.cells, undefined);
    assert.equal(result.drawing, undefined);
  }
});

test('the door has its own quantity-based option prices', () => {
  const prices = { '1단서랍': 100000, '2단서랍': 150000, '추가선반': 30000, '코너추가선반': 50000, '측판': 110000, '이불반장': 150000, '이불긴장': 300000, '거울문': 110000, '유리문': 110000 };
  for (const [name, price] of Object.entries(prices)) {
    const result = quote(3000, [{ name, quantity: 2 }]);
    assert.equal(result.optionsAmount, price * 2, name);
    assert.equal(result.knownSubtotal, 1200000 + price * 2);
  }
});

test('invalid, missing, duplicate, or unpriced input never becomes a cheap quote', () => {
  for (const length of [0, -1, 1.5, NaN, Infinity, '3000', 100001]) assert.throws(() => quote(length));
  for (const options of [[{ name: '3단서랍', quantity: 1 }], [{ name: '측판', quantity: 0 }], [{ name: '측판', quantity: 1.2 }], [{ name: '측판', quantity: 101 }], [{ name: '측판', quantity: '1' }], [{ name: '측판', quantity: 1 }, { name: '측판', quantity: 2 }]]) assert.throws(() => quote(3000, options));
  assert.throws(() => api.computeThedoor({ shape: 'ㄱ자', lengths: { A: 3000 }, options: [] }));
  assert.throws(() => api.computeThedoor({ shape: 'ㅡ자', lengths: { A: 3000, B: 3000 }, options: [] }));
});

test('explicit inputs produce a partial amount with commercial conditions unresolved', () => {
  const result = api.createProductReply([user('더도어 ㄱ자; A=1575mm; B=1575mm; 옵션=1단서랍:2, 측판:1')]);
  assert.equal(result.quotePreview.productType, 'thedoor');
  assert.equal(result.quotePreview.status, 'partial');
  assert.equal(result.quotePreview.knownSubtotal, 1630000);
  assert.equal(result.quotePreview.total, null);
  assert.match(result.content, /1,630,000원/);
  assert.match(result.content, /배송.*할인.*VAT.*시공/);
  assert.match(result.content, /미확정/);
  assert.doesNotMatch(result.content, /총 합계|SHOW_EXAMPLE/);
});

test('missing options and ambiguous units ask for input, never assume zero or mm', () => {
  for (const input of ['더도어 3000', '더도어 ㅡ자; A=300cm; 옵션=없음', '더도어 ㅡ자; A=3000mm', '더도어 ㅡ자; A=3000mm; 옵션=3단서랍:1', '더도어 ㅡ자; A=3000mm; A=4000mm; 옵션=없음', '더도어 ㅡ자; A=3000mm; 옵션=없음; 할인=10%']) {
    const result = api.createProductReply([user(input)]);
    assert.equal(result.quotePreview.status, 'needs_input', input);
    assert.equal(result.quotePreview.knownSubtotal, undefined);
    assert.equal(result.quotePreview.total, null);
  }
});

test('new product context survives storage, while an explicit 1post switch returns to legacy', () => {
  const messages = [user('더도어 견적'), { role: 'assistant', content: '입력 안내' }, user('ㅡ자; A=3000mm; 옵션=없음')];
  assert.equal(api.createProductReply(JSON.parse(JSON.stringify(messages))).quotePreview.knownSubtotal, 1200000);
  assert.equal(api.createProductReply([...messages, user('1post로 바꿀게요')]), null);
  assert.equal(api.createProductReply([user('기존 행거 신규아파트 할인 견적')]), null);
  assert.equal(api.createProductReply([user('ㄱ자 2400 1800')]), null);
  assert.equal(api.createProductReply([user('팬트리와 더도어 비교')]).quotePreview.status, 'needs_product');
  const revised = api.createProductReply([...messages, user('측판만 추가해줘')]);
  assert.equal(revised.quotePreview.status, 'needs_input'); // Never reuse stale lengths/options implicitly.
});

test('pantry collects actual tiers and dimensions but leaves cell counts and price unresolved', () => {
  const result = api.createProductReply([user('팬트리 ㄱ자; A=1115mm; B=1235mm; 단수=7')]);
  assert.equal(result.quotePreview.productType, 'pantry');
  assert.equal(result.quotePreview.status, 'needs_layout');
  assert.equal(result.quotePreview.input.tiers, 7);
  assert.equal(result.quotePreview.total, null);
  assert.equal(result.quotePreview.knownSubtotal, undefined);
  assert.match(result.content, /일반.*코너.*칸수/);
  assert.doesNotMatch(result.content, /600,000|SHOW_EXAMPLE/);
  for (const tiers of [1, 8, 2.5]) {
    assert.equal(api.createProductReply([user(`팬트리 ㅡ자; A=3000mm; 단수=${tiers}`)]).quotePreview.status, 'needs_input');
  }
});

test('a request for a human retains the existing support channel without pretending to connect', () => {
  const result = api.createProductReply([user('더도어 견적'), user('상담원 연결해주세요')]);
  assert.match(result.content, /http:\/\/pf\.kakao\.com\/_qbxjwxb\/chat/);
  assert.doesNotMatch(result.content, /접수했습니다|연결했습니다|곧.*연락/);
  assert.equal(result.quotePreview.total, null);
});

test('stored previews cannot select a product on behalf of a user or overwrite legacy guidance', () => {
  assert.equal(api.createProductReply([{ role: 'assistant', content: '더도어 안내' }, user('2400mm 견적')]), null);
  assert.equal(api.createProductReply([user('기존 행거 견적'), { role: 'assistant', content: '팬트리', quotePreview: { productType: 'pantry' } }]), null);
  const result = api.createProductReply([user('더도어'), user('ㅡ자; A=3000mm; 옵션=__proto__:1')]);
  assert.equal(result.quotePreview.status, 'needs_input');
});
