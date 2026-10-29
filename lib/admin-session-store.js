'use strict';

// 관리자 로그인 저장소 (Supabase 표 admin_sessions).
// 토큰 원문은 저장하지 않는다 · sha256 해시만 저장.
function createSupabaseSessionStore(client, table = 'admin_sessions') {
  if (!client || typeof client.from !== 'function') throw new Error('Supabase client is required');

  return {
    async load(tokenHash) {
      const { data, error } = await client
        .from(table)
        .select('email, csrf_hashes, created_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        email: data.email,
        csrfHashes: Array.isArray(data.csrf_hashes) ? data.csrf_hashes : [],
        createdAt: Date.parse(data.created_at),
      };
    },

    // 로그인 때 한 번만 새 줄을 만든다.
    async insert(tokenHash, { email, csrfHashes, createdAt }) {
      const { error } = await client.from(table).insert({
        token_hash: tokenHash,
        email,
        csrf_hashes: csrfHashes,
        created_at: new Date(createdAt).toISOString(),
      });
      if (error) throw error;
    },

    // 있는 줄만 고친다 · 지워진 줄(강제 로그아웃)을 다시 만들지 않는다.
    // 반환: 줄이 있었으면 true, 없었으면 false.
    async updateCsrf(tokenHash, csrfHashes) {
      const { data, error } = await client
        .from(table)
        .update({ csrf_hashes: csrfHashes })
        .eq('token_hash', tokenHash)
        .select('token_hash');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },

    async remove(tokenHash) {
      const { error } = await client.from(table).delete().eq('token_hash', tokenHash);
      if (error) throw error;
    },
  };
}

// server.js 와 같은 환경변수로 연결한다. 값이 없으면(시험·로컬) 저장소 없이 메모리만 쓴다.
function createSessionStoreFromEnv(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    db: { schema: env.DB_SCHEMA || 'public' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createSupabaseSessionStore(client);
}

module.exports = { createSessionStoreFromEnv, createSupabaseSessionStore };
