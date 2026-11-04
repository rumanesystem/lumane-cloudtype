'use strict';

// New-product previews only. Legacy 1post pricing remains in the existing guidance.
const PREVIEW_HEADER = '[신규상품 예상안내]';
const POLICY_VERSION = 'chat-preview-2026-11-03';
const FACES = { 'ㅡ자': ['A'], 'ㄱ자': ['A', 'B'], 'ㄷ자': ['A', 'B', 'C'], '11자': ['A', 'C'], 'ㅁ자': ['A', 'B', 'C', 'D'] };
const PRODUCT_PATTERNS = {
  thedoor: /더\s*도어|\bthe\s*door\b|\b2\s*post\b|투포스트/i,
  pantry: /팬트리|펜트리|\bpantry\b/i,
  legacy: /\b1\s*post\b|원포스트|(?:기존|일반)\s*(?:행거|드레스룸)/i,
};
const THEDOOR_OPTIONS = Object.freeze({
  '1단서랍': 100000, '2단서랍': 150000,
  '추가선반': 30000, '코너추가선반': 50000, '측판': 110000,
  '이불반장': 150000, '이불긴장': 300000, '거울문': 110000, '유리문': 110000,
});
const CONDITIONS = '배송·할인·VAT·시공 조건은 챗봇 채널 적용 기준 미확정으로 별도 확인이 필요합니다. 최종 결제금액이 아닙니다.';
const won = amount => amount.toLocaleString('ko-KR') + '원';

function getProductIntent(messages) {
  let product = null;
  for (const message of messages || []) {
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    const matches = Object.entries(PRODUCT_PATTERNS).filter(([, pattern]) => pattern.test(message.content));
    if (matches.length > 1) product = 'unselected';
    else if (matches.length === 1) product = matches[0][0] === 'legacy' ? null : matches[0][0];
  }
  return product;
}

function isProvisionalQuote(text) {
  return typeof text === 'string' && text.startsWith(PREVIEW_HEADER);
}

function isQuoteText(text) {
  return typeof text === 'string' &&
    (isProvisionalQuote(text) || /총\s*합계|견적서|주문서|주문내역|\[금액\]/.test(text));
}

function validateLengths(shape, lengths) {
  if (!Object.hasOwn(FACES, shape) || !lengths || typeof lengths !== 'object') {
    throw new Error('형태와 면별 길이를 확인해 주세요.');
  }
  const faces = FACES[shape];
  if (Object.keys(lengths).length !== faces.length || !faces.every(face => Object.hasOwn(lengths, face))) {
    throw new Error('선택한 형태에 필요한 면만 모두 입력해 주세요.');
  }
  for (const face of faces) {
    if (!Number.isInteger(lengths[face]) || lengths[face] < 1 || lengths[face] > 100000) {
      throw new Error('면별 길이는 1~100000 사이의 정수 mm로 입력해 주세요.');
    }
  }
  return faces.reduce((sum, face) => sum + lengths[face], 0);
}

function computeThedoor({ shape, lengths, options }) {
  const totalLengthMm = validateLengths(shape, lengths);
  if (!Array.isArray(options)) throw new Error('옵션 유무와 수량을 확인해 주세요.');
  const seen = new Set();
  const lines = options.map(option => {
    if (!option || !Object.hasOwn(THEDOOR_OPTIONS, option.name) || seen.has(option.name) ||
        !Number.isInteger(option.quantity) || option.quantity < 1 || option.quantity > 100) {
      throw new Error('옵션은 등록된 이름과 1~100의 정수 수량으로 한 번씩 입력해 주세요. 미등록 옵션은 담당자 확인이 필요합니다.');
    }
    seen.add(option.name);
    const unitPrice = THEDOOR_OPTIONS[option.name];
    return { name: option.name, quantity: option.quantity, unitPrice, amount: unitPrice * option.quantity };
  });
  const ja = Math.max(10, Math.floor((totalLengthMm + 150) / 300));
  const baseAmount = ja * 120000;
  const optionsAmount = lines.reduce((sum, line) => sum + line.amount, 0);
  return { totalLengthMm, ja, baseAmount, optionsAmount, knownSubtotal: baseAmount + optionsAmount, lines, total: null };
}

// Deliberately narrow grammar: no model-derived quantities, inferred units, or old input reuse.
// One complete message is a revision, so removing an option cannot leave a stale charge.
function readInput(text, product) {
  const parts = text.trim().split(/[;\n]+/).map(part => part.trim()).filter(Boolean);
  const heading = (parts.shift() || '').replace(/^(?:더\s*도어|the\s*door|2\s*post|투포스트|팬트리|펜트리|pantry)\s*/i, '');
  const shape = heading === '일자' ? 'ㅡ자' : heading;
  const lengths = {};
  let options;
  let tiers;
  for (const part of parts) {
    const length = part.match(/^([ABCD])\s*=\s*(\d+)\s*mm$/i);
    if (length) {
      const key = length[1].toUpperCase();
      if (Object.hasOwn(lengths, key)) throw new Error('같은 면을 중복 입력하지 말아 주세요.');
      lengths[key] = Number(length[2]);
      continue;
    }
    const option = part.match(/^옵션\s*=\s*(.+)$/);
    if (product === 'thedoor' && option && options === undefined) {
      options = option[1].trim() === '없음' ? [] : option[1].split(',').map(entry => {
        const match = entry.trim().match(/^([^:]+):\s*(\d+)$/);
        if (!match) throw new Error('옵션은 이름:수량으로 입력해 주세요.');
        return { name: match[1].replace(/\s/g, '').replace(/서랍장$/, '서랍').replace(/^일반추가선반$/, '추가선반'), quantity: Number(match[2]) };
      });
      continue;
    }
    const tier = part.match(/^단수\s*=\s*(\d+)$/);
    if (product === 'pantry' && tier && tiers === undefined) {
      tiers = Number(tier[1]);
      continue;
    }
    throw new Error('추정 없이 계산할 수 있도록 아래 형식으로 전체 입력을 다시 보내 주세요.');
  }
  validateLengths(shape, lengths);
  if (product === 'pantry' && (!Number.isInteger(tiers) || tiers < 2 || tiers > 7)) {
    throw new Error('팬트리 실제 단수는 2~7단의 정수로 입력해 주세요.');
  }
  if (product === 'thedoor' && options === undefined) throw new Error('옵션이 없으면 옵션=없음이라고 명시해 주세요.');
  return product === 'pantry' ? { shape, lengths, tiers } : { shape, lengths, options };
}

function createProductReply(messages) {
  const productType = getProductIntent(messages);
  if (!productType) return null;
  const quotePreview = { version: POLICY_VERSION, productType, status: 'needs_input', total: null };
  const content = [PREVIEW_HEADER];
  const latest = [...messages].reverse().find(message => message.role === 'user');
  if (/(?:상담원|상담사|담당자|사람).*(?:연결|상담|문의)|카카오|카톡/.test(latest?.content || '')) {
    quotePreview.status = 'needs_consultation';
    content.push('담당자와 상담을 원하시면 기존 카카오 채널에서 문의해 주세요.',
      'http://pf.kakao.com/_qbxjwxb/chat', CONDITIONS);
    return { content: content.join('\n'), quotePreview };
  }
  const text = latest?.content || '';
  // Only calculation/revision intent enters the strict grammar. Product context
  // remains active for storage guards even when ordinary conversation resumes.
  const withoutProduct = text.replace(/더\s*도어|the\s*door|2\s*post|투포스트|팬트리|펜트리|pantry/gi, '').trim();
  const calculation = /견적|계산|총액|소계|수정|변경|바꿔|추가해|빼\s*줘|제거|[ABCD]\s*=|옵션\s*=|단수\s*=|\d+\s*(?:mm|cm)|^\d+\s*$/i.test(withoutProduct);
  const information = /제품|상품|설명|어떤|뭐|무엇|옵션|가격|단가|얼마|배송|할인|VAT|부가세|시공|설치|더\s*도어|the\s*door|2\s*post|투포스트|팬트리|펜트리|pantry/i.test(text);
  if (!calculation && !information) return null;
  if (productType === 'unselected') {
    quotePreview.status = 'needs_product';
    content.push('먼저 계산할 제품을 하나 골라 주세요: 더도어(2post), 팬트리, 기존 행거(1post). 제품별 조건을 섞어 계산하지 않습니다.');
    return { content: content.join('\n'), quotePreview };
  }
  if (!calculation) {
    quotePreview.status = 'information';
    if (productType === 'thedoor') {
      content.push('더도어는 2post 제품이며 기본가에 일반문이 포함됩니다.',
        '기본가는 1자(300mm)당 120,000원, 최소 10자입니다. 합산 길이의 잔여 150mm부터 올림합니다.',
        '전용 옵션 단가: ' + Object.entries(THEDOOR_OPTIONS).map(([name, price]) => `${name} ${won(price)}`).join(' / '),
        '거울문·유리문은 교체 짝당 추가금이며, 측판은 선택 수량만 추가합니다.');
    } else {
      content.push('팬트리는 실제 2~7단과 일반·코너 선반 구성을 확인합니다. 현재 챗봇은 자동 칸수·총액 계산을 제공하지 않습니다.');
    }
    content.push(CONDITIONS, '예상금액 입력 안내가 필요하면 견적이라고 말씀해 주세요. 다른 궁금한 점도 편하게 질문해 주세요.');
    return { content: content.join('\n'), quotePreview };
  }
  content.push(productType === 'thedoor' ? '더도어(2post) 예상 안내' : '팬트리 입력 확인');
  try {
    const input = readInput(latest?.content || '', productType);
    const dimensions = Object.entries(input.lengths).map(([face, mm]) => `${face}=${mm}mm`).join(', ');
    if (productType === 'thedoor') {
      const result = computeThedoor(input);
      Object.assign(quotePreview, result, { input, status: 'partial' });
      content.push(`형태: ${input.shape} / 치수: ${dimensions}`,
        `합산 ${result.totalLengthMm}mm → ${result.ja}자 (1자=300mm, 잔여 150mm부터 올림, 최소 10자)`,
        `기본 예상금액: ${won(result.baseAmount)} (일반문 포함)`,
        ...result.lines.map(line => `옵션: ${line.name} ${line.quantity}개 × ${won(line.unitPrice)} = ${won(line.amount)}`),
        `옵션 예상금액: ${won(result.optionsAmount)}`,
        `기본·옵션 예상 소계: ${won(result.knownSubtotal)}`,
        '길이 합산 예상금액만 안내하며, 실제 코너 시공 가능 여부와 도면은 담당자 확인이 필요합니다.');
    } else {
      Object.assign(quotePreview, { input, status: 'needs_layout' });
      content.push(`확인한 입력: ${input.shape} / ${dimensions} / 실제 ${input.tiers}단`,
        '팬트리는 일반·코너 선반 칸수 확인이 필요합니다. 현재 챗봇에서는 자동 칸수·총액 계산을 제공하지 않습니다. 입력 내용을 바탕으로 담당자에게 구성을 확인해 주세요.');
    }
  } catch (error) {
    content.push(error.message);
    if (productType === 'thedoor') {
      content.push('예: 더도어 ㄱ자; A=2000mm; B=3000mm; 옵션=1단서랍:1, 측판:2',
        '기본가는 자당 120,000원(일반문 포함), 최소 10자입니다.',
        '전용 옵션 단가: ' + Object.entries(THEDOOR_OPTIONS).map(([name, price]) => `${name} ${won(price)}`).join(' / '),
        '거울문·유리문은 교체 짝당 추가금이며, 측판은 선택한 수량만 추가합니다.');
    } else {
      content.push('예: 팬트리 ㄱ자; A=1115mm; B=1235mm; 단수=7',
        '팬트리는 실제 2~7단을 확인하며 자동 칸수·총액 계산은 아직 제공하지 않습니다.');
    }
    content.push('면 이름: ㅡ자=A, ㄱ자=A/B, ㄷ자=A/B/C, 11자=A/C, ㅁ자=A/B/C/D.');
  }
  content.push(CONDITIONS, '변경 시 형태·모든 면의 mm·옵션(팬트리는 단수)을 한 메시지로 다시 보내 주세요. 기존 행거 상담은 1post라고 알려 주세요.');
  return { content: content.join('\n'), quotePreview };
}

function getProductConversationPrompt(messages) {
  const product = getProductIntent(messages);
  if (!product) return null;
  return `현재 상담 제품은 ${product === 'thedoor' ? '더도어(2post)' : product === 'pantry' ? '팬트리' : '미선택 신규 제품'}입니다. 현재 질문에 자연스럽게 답하고 견적 입력 형식을 반복 요구하지 마세요. 기존 행거(1post)의 가격·옵션·할인·배송 정책과 예시 이미지를 이 제품에 적용하지 마세요. 금액 계산은 서버의 전용 견적 입력 안내로 맡기고, 배송·할인·VAT·시공 조건은 미확정으로 안내하세요. 근거 없는 제품 사양·설치 가능 여부·최종금액을 만들지 마세요.`;
}

module.exports = { computeThedoor, createProductReply, getProductIntent, getProductConversationPrompt, isProvisionalQuote, isQuoteText };
