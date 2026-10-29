'use strict';

const { DEFAULT_ABSOLUTE_TTL_MS } = require('./admin-session-manager');

// 브라우저는 쿠키 만료를 최대 400일로 자르므로, 관리자 화면에 들어올 때마다 다시 늘려 준다.
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

function parseCookieHeader(header) {
  const cookies = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Malformed cookie values are ignored instead of reaching authentication.
    }
  }
  return cookies;
}

function cookieMaxAge(absoluteTtlMs) {
  return Math.min(absoluteTtlMs, COOKIE_MAX_AGE_MS);
}

function sessionCookieOptions({ absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS } = {}) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: cookieMaxAge(absoluteTtlMs),
  };
}

function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  };
}

function setSessionCookie(res, name, value, options) {
  res.cookie(name, value, options);
}

function clearSessionCookie(res, name) {
  res.clearCookie(name, clearSessionCookieOptions());
}

function csrfCookieOptions({ absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS } = {}) {
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: cookieMaxAge(absoluteTtlMs),
  };
}

function clearCsrfCookie(res, name) {
  res.clearCookie(name, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
}

module.exports = {
  COOKIE_MAX_AGE_MS,
  clearCsrfCookie,
  clearSessionCookie,
  clearSessionCookieOptions,
  csrfCookieOptions,
  parseCookieHeader,
  sessionCookieOptions,
  setSessionCookie,
};
