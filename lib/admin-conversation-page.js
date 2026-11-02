'use strict';

// 관리자 저장 상담 목록 페이지 나누기 — /api/admin/conversations?page=N&pageSize=30
// page 가 없으면 예전처럼 최신 200건 (알림·미확인 표시가 이 목록을 씀)

const DEFAULT_LIMIT = 200;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10000;
const DB_CHUNK = 1000; // DB(PostgREST)가 한 번에 돌려주는 최대 줄 수

function parseConversationPage(query = {}) {
  if (query.page === undefined || query.page === '') return null;
  const rawPage = parseInt(query.page, 10);
  const page = Number.isSafeInteger(rawPage) ? Math.min(MAX_PAGE, Math.max(1, rawPage)) : 1;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || 30));
  return { page, size };
}

/** 두 표를 합쳐 id 내림차순으로 정렬한 뒤 요청한 페이지만 잘라냄 */
function mergeConversationPage(real = [], test = [], pageQuery = null) {
  const merged = [
    ...real,
    ...test.map(c => ({ ...c, is_test: true })),
  ].sort((a, b) => b.id - a.id);
  if (!pageQuery) return merged.slice(0, DEFAULT_LIMIT);
  const offset = (pageQuery.page - 1) * pageQuery.size;
  return merged.slice(offset, offset + pageQuery.size);
}

/** 한 표에서 최신순 id 만 take 개까지 (DB 한도 1000줄을 넘으면 나눠서) + 전체 개수 */
async function listIds(supabase, table, take) {
  const rows = [];
  let count = 0;
  for (let start = 0; start < take; start += DB_CHUNK) {
    const end = Math.min(take, start + DB_CHUNK) - 1;
    const { data, error, count: c } = await supabase.from(table)
      .select('id', { count: 'exact' }).is('deleted_at', null)
      .order('id', { ascending: false }).range(start, end);
    if (error) throw error;
    if (Number.isFinite(c)) count = c;
    rows.push(...(data || []));
    if (!data || data.length < end - start + 1) break;
  }
  return { rows, count };
}

/** 페이지 하나: id 만 훑어서 그 페이지 상담을 고른 뒤 그 줄만 내용까지 받아옴 */
async function fetchConversationPage(supabase, pageQuery) {
  const take = pageQuery.page * pageQuery.size;
  const [real, test] = await Promise.all([
    listIds(supabase, 'conversations', take),
    listIds(supabase, 'test_conversations', take),
  ]);
  const offset = (pageQuery.page - 1) * pageQuery.size;
  const picked = [
    ...real.rows.map(r => ({ id: r.id, test: false })),
    ...test.rows.map(r => ({ id: r.id, test: true })),
  ].sort((a, b) => b.id - a.id).slice(offset, offset + pageQuery.size);
  const full = async (table, ids) => {
    if (!ids.length) return [];
    const { data, error } = await supabase.from(table).select('*').in('id', ids);
    if (error) throw error;
    return data || [];
  };
  const [realRows, testRows] = await Promise.all([
    full('conversations', picked.filter(p => !p.test).map(p => p.id)),
    full('test_conversations', picked.filter(p => p.test).map(p => p.id)),
  ]);
  return {
    conversations: mergeConversationPage(realRows, testRows, { page: 1, size: pageQuery.size }),
    total: real.count + test.count,
  };
}

module.exports = { parseConversationPage, mergeConversationPage, fetchConversationPage, DEFAULT_LIMIT, MAX_PAGE };
