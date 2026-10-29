'use strict';

const { AdminSessionManager } = require('./admin-session-manager');

// 화면을 쓰지 않고 열어만 둔 기기도, DB 에서 지우면 이 간격 안에 풀리도록 다시 맞춘다.
const DEFAULT_RECHECK_MS = 5 * 60 * 1000;
// 로그아웃 때 못 지운 줄을 다시 지워 보는 간격.
const RETRY_COOLDOWN_MS = 60 * 1000;
// DB 작업(읽기·저장·갱신·삭제)이 응답 없이 멈춰도 이 시간이 지나면 실패로 본다 (요청이 끝없이 기다리지 않게).
const STORE_TIMEOUT_MS = 5 * 1000;
// 로그아웃한 로그인을 기억하는 최대 개수 (넘치면 오래된 것부터 잊는다 · DB 줄은 이미 지워진 뒤).
const REVOKED_CAP = 1000;

function logStoreError(action, error) {
  console.warn(`[ADMIN_SESSION_STORE] ${action} failed: ${error?.message || error}`);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 표(admin_sessions)가 아직 없음 = SQL 실행 전 배포. 이때는 예전처럼 메모리 로그인만 쓴다.
function isMissingTable(error) {
  const code = String(error?.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  // 코드가 없을 때만 메시지로 판단 · 이 표 이름이 들어간 "없음" 오류만 인정한다.
  return !code && /admin_sessions/i.test(String(error?.message || ''))
    && /does not exist|could not find the table/i.test(String(error?.message || ''));
}

// 메모리 로그인 목록 + 저장소(DB)를 함께 다룬다. 저장소가 없으면 메모리만 쓴다.
function createSessionSync({
  sessionManager,
  sessionStore = null,
  recheckMs = DEFAULT_RECHECK_MS,
  retryCooldownMs = RETRY_COOLDOWN_MS,
  storeTimeoutMs = STORE_TIMEOUT_MS,
  now = Date.now,
}) {
  // 마지막으로 DB 를 "읽어서" 확인한 시각 · 쓰기(저장)는 확인으로 치지 않는다.
  const lastChecked = new Map();
  // 로그아웃했지만 DB 삭제가 실패한 로그인 · DB 에 줄이 남아 있어도 받지 않고, DB 가 되면 다시 지운다.
  const pendingRemoval = new Set();
  // 로그아웃한 로그인 · 로그아웃 순간 동시에 DB 에서 읽어 온 요청이 되살리지 못하게 막는다.
  const revoked = new Set();
  let lastRetryAt = 0;
  let retrying = false;

  function markRevoked(tokenHash) {
    revoked.add(tokenHash);
    if (revoked.size > REVOKED_CAP) revoked.delete(revoked.values().next().value);
  }

  function isRevoked(tokenHash) {
    return revoked.has(tokenHash) || pendingRemoval.has(tokenHash);
  }

  async function retryPendingRemovals() {
    for (const tokenHash of pendingRemoval) {
      try {
        await withTimeout(sessionStore.remove(tokenHash), storeTimeoutMs);
        pendingRemoval.delete(tokenHash);
      } catch (error) {
        logStoreError('remove retry', error);
        return; // 아직 DB 장애 · 다음 기회에 다시 시도
      }
    }
  }

  // 요청은 기다리지 않는다 · 1분에 한 번만 뒤에서 다시 지워 본다.
  function scheduleRetry() {
    if (pendingRemoval.size === 0 || retrying || now() - lastRetryAt < retryCooldownMs) return;
    retrying = true;
    lastRetryAt = now();
    retryPendingRemovals().finally(() => { retrying = false; });
  }

  function markChecked(tokenHash) {
    lastChecked.set(tokenHash, now());
    if (lastChecked.size > sessionManager.maxSessions * 2) {
      for (const key of lastChecked.keys()) {
        if (!sessionManager.sessions.has(key)) lastChecked.delete(key);
      }
    }
  }

  async function loadStored(tokenHash) {
    try {
      return { ok: true, row: await withTimeout(sessionStore.load(tokenHash), storeTimeoutMs) };
    } catch (error) {
      logStoreError('load', error);
      return { ok: false, row: null };
    }
  }

  async function resolveSession(token, options) {
    // 어떤 요청이든(로그아웃한 기기의 요청 포함) 못 지운 줄을 다시 지워 볼 기회를 준다.
    if (sessionStore) scheduleRetry();
    if (typeof token !== 'string' || token.length === 0) return null;
    const tokenHash = AdminSessionManager.hashToken(token);
    if (isRevoked(tokenHash)) return null;
    const session = sessionManager.authenticate(token, options);
    if (!sessionStore) return session;

    if (session) {
      if (now() - (lastChecked.get(tokenHash) || 0) < recheckMs) return session;
      const { ok, row } = await loadStored(tokenHash);
      // 기다리는 사이 로그아웃됐거나, 줄이 확실히 없으면 로그아웃 · 저장소 장애일 때는 끊지 않는다.
      if (isRevoked(tokenHash) || (ok && !row)) {
        sessionManager.destroy(token);
        lastChecked.delete(tokenHash);
        return null;
      }
      // 실패해도 "확인함"으로 둔다 · 같은 요청 안에서, 또 장애 동안 요청마다 다시 기다리지 않게.
      markChecked(tokenHash);
      return session;
    }

    const { row } = await loadStored(tokenHash);
    // 기다리는 사이 로그아웃됐으면 되살리지 않는다.
    if (!row || isRevoked(tokenHash)) return null;
    // 다른 요청이 먼저 되살렸으면 덮어쓰지 않는다 (그 사이 새로 발급한 CSRF 를 잃지 않게).
    if (!sessionManager.sessions.has(tokenHash) && !sessionManager.restore(tokenHash, row)) return null;
    markChecked(tokenHash);
    return sessionManager.authenticate(token, options);
  }

  // 새 로그인 저장. 실패하면 false (로그인을 막는다 · DB 에 없는 로그인은 강제 로그아웃할 수 없으므로).
  async function insertSession(tokenHash) {
    if (!sessionStore) return true;
    const snapshot = sessionManager.snapshot(tokenHash);
    if (!snapshot) return false;
    try {
      await withTimeout(sessionStore.insert(tokenHash, snapshot), storeTimeoutMs);
      markChecked(tokenHash);
      return true;
    } catch (error) {
      logStoreError('insert', error);
      if (!isMissingTable(error)) return false;
      markChecked(tokenHash); // 표가 없을 때 요청마다 DB 를 다시 읽지 않게 (5분 간격으로만)
      return true;
    }
  }

  // CSRF 갱신 저장. 'ok' | 'gone'(DB 에서 지워짐 → 로그아웃) | 'error'(저장소 장애 → 유지).
  async function saveCsrf(tokenHash) {
    if (!sessionStore) return 'ok';
    const snapshot = sessionManager.snapshot(tokenHash);
    if (!snapshot) return 'gone';
    try {
      return (await withTimeout(sessionStore.updateCsrf(tokenHash, snapshot.csrfHashes), storeTimeoutMs)) ? 'ok' : 'gone';
    } catch (error) {
      logStoreError('updateCsrf', error);
      return 'error';
    }
  }

  async function forget(tokenHash) {
    markRevoked(tokenHash); // DB 삭제를 기다리기 전에 먼저 막는다
    lastChecked.delete(tokenHash);
    if (!sessionStore) return;
    try {
      await withTimeout(sessionStore.remove(tokenHash), storeTimeoutMs);
    } catch (error) {
      pendingRemoval.add(tokenHash);
      logStoreError('remove', error);
    }
  }

  return { forget, insertSession, resolveSession, saveCsrf };
}

module.exports = { DEFAULT_RECHECK_MS, createSessionSync };
