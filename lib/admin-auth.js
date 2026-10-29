'use strict';

const {
  AdminSessionManager,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_IDLE_TTL_MS,
} = require('./admin-session-manager');
const {
  clearCsrfCookie,
  clearSessionCookie,
  clearSessionCookieOptions,
  csrfCookieOptions,
  parseCookieHeader,
  sessionCookieOptions,
  setSessionCookie,
} = require('./admin-cookies');
const { createSessionStoreFromEnv, createSupabaseSessionStore } = require('./admin-session-store');
const { createAdminPageHandler } = require('./admin-page-handler');
const { createSessionSync } = require('./admin-session-sync');

const DEFAULT_COOKIE_NAME = 'lumane_admin_session';
const DEFAULT_CSRF_COOKIE_NAME = 'lumane_admin_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function createAdminAuth({
  signInWithPassword,
  cookieName = DEFAULT_COOKIE_NAME,
  csrfCookieName = DEFAULT_CSRF_COOKIE_NAME,
  sessionManager = new AdminSessionManager(),
  sessionStore = createSessionStoreFromEnv(),
  recheckMs,
  retryCooldownMs,
  storeTimeoutMs,
}) {
  if (typeof signInWithPassword !== 'function') throw new Error('signInWithPassword provider is required');

  const cookieTtl = () => ({ absoluteTtlMs: sessionManager.absoluteTtlMs });
  const { forget, insertSession, resolveSession, saveCsrf } = createSessionSync({
    sessionManager, sessionStore, recheckMs, retryCooldownMs, storeTimeoutMs,
  });

  function cookieToken(req) {
    return parseCookieHeader(req.headers.cookie)[cookieName] || '';
  }

  function rejectAuthentication(res) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  function authenticateRequest(req, options) {
    return resolveSession(cookieToken(req), options);
  }

  async function refreshCsrf(req, res) {
    const token = cookieToken(req);
    if (!(await resolveSession(token))) return false;
    const csrfToken = sessionManager.rotateCsrf(token);
    if (!csrfToken) return false;
    // DB 에서 지워진 기기(강제 로그아웃)는 여기서 바로 로그아웃한다.
    if ((await saveCsrf(AdminSessionManager.hashToken(token))) === 'gone') {
      sessionManager.destroy(token);
      return false;
    }
    // 들어올 때마다 쿠키 기간을 다시 늘려 브라우저 400일 상한에 걸리지 않게 한다.
    setSessionCookie(res, cookieName, token, sessionCookieOptions(cookieTtl()));
    res.cookie(csrfCookieName, csrfToken, csrfCookieOptions(cookieTtl()));
    return true;
  }

  async function requireAdmin(req, res, next) {
    let session;
    let csrfRejected = false;
    try {
      const token = cookieToken(req);
      session = await resolveSession(token);
      if (session && !SAFE_METHODS.has(req.method)) {
        const origin = String(req.get('origin') || '');
        const csrfToken = String(req.get('x-csrf-token') || '');
        csrfRejected = !origin || origin !== requestOrigin(req) || !sessionManager.verifyCsrf(token, csrfToken);
      }
    } catch (error) {
      return next(error);
    }
    if (!session) return rejectAuthentication(res);
    if (csrfRejected) return res.status(403).json({ error: '요청을 확인할 수 없습니다.' });
    req.adminAuth = { type: 'session', session };
    return next();
  }

  async function login(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return rejectAuthentication(res);

    try {
      const { data, error } = await signInWithPassword({ email, password });
      if (error || !data?.session || !data?.user) {
        return rejectAuthentication(res);
      }
      const role = String(data.user.app_metadata?.role || '').trim().toLowerCase();
      if (role !== 'admin' && role !== 'operator') return rejectAuthentication(res);
      const authenticatedEmail = String(data.user.email || email).trim().toLowerCase();
      const session = sessionManager.create(authenticatedEmail);
      // DB 에 없는 로그인은 강제 로그아웃할 수 없으므로 저장 실패 시 로그인을 막는다.
      if (!(await insertSession(session.tokenHash))) {
        sessionManager.destroy(session.token);
        return res.status(503).json({ error: '잠시 후 다시 시도해 주세요.' });
      }
      setSessionCookie(res, cookieName, session.token, sessionCookieOptions(cookieTtl()));
      res.cookie(csrfCookieName, session.csrfToken, csrfCookieOptions(cookieTtl()));
      return res.status(200).json({ email: session.email, expiresAt: session.expiresAt });
    } catch {
      return rejectAuthentication(res);
    }
  }

  async function currentSession(req, res, next) {
    try {
      const session = await resolveSession(cookieToken(req));
      if (!session || !(await refreshCsrf(req, res))) return rejectAuthentication(res);
      return res.status(200).json(session);
    } catch (error) {
      return next(error);
    }
  }

  async function logout(req, res, next) {
    try {
      const token = cookieToken(req);
      sessionManager.destroy(token);
      if (token) await forget(AdminSessionManager.hashToken(token));
      clearSessionCookie(res, cookieName);
      clearCsrfCookie(res, csrfCookieName);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  }

  return {
    authenticateRequest,
    currentSession,
    login,
    logout,
    refreshCsrf,
    requireAdmin,
    sessionManager,
  };
}

module.exports = {
  AdminSessionManager,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_COOKIE_NAME,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_IDLE_TTL_MS,
  clearSessionCookie,
  clearSessionCookieOptions,
  createAdminPageHandler,
  createAdminAuth,
  createSupabaseSessionStore,
  csrfCookieOptions,
  parseCookieHeader,
  setSessionCookie,
  sessionCookieOptions,
};
