'use strict';

const crypto = require('crypto');

// 한 번 로그인한 기기는 로그아웃 전까지 유지한다 (2026-10-29 사용자 결정).
const DEFAULT_IDLE_TTL_MS = Infinity;
const DEFAULT_ABSOLUTE_TTL_MS = Infinity;
const DEFAULT_MAX_SESSIONS = 20;

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function secretsEqual(expectedHash, candidate) {
  if (!Buffer.isBuffer(expectedHash) || typeof candidate !== 'string' || candidate.length === 0) return false;
  return crypto.timingSafeEqual(expectedHash, hashSecret(candidate));
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

const HEX_HASH = /^[0-9a-f]{64}$/;

class AdminSessionManager {
  constructor({
    idleTtlMs = DEFAULT_IDLE_TTL_MS,
    absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    now = Date.now,
    tokenFactory = randomToken,
  } = {}) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new Error('maxSessions must be positive');
    this.idleTtlMs = idleTtlMs;
    this.absoluteTtlMs = absoluteTtlMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.tokenFactory = tokenFactory;
    this.sessions = new Map();
  }

  static hashToken(token) {
    return hashSecret(token).toString('hex');
  }

  create(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Authenticated email is required');
    const now = this.now();
    this.#purgeExpired(now);
    while (this.sessions.size >= this.maxSessions) this.#deleteOldest();

    const token = this.tokenFactory();
    const csrfToken = this.tokenFactory();
    const tokenHash = AdminSessionManager.hashToken(token);
    this.sessions.set(tokenHash, {
      email: normalizedEmail,
      csrfHashes: [hashSecret(csrfToken)],
      createdAt: now,
      lastSeenAt: now,
    });
    return { token, tokenHash, csrfToken, email: normalizedEmail, expiresAt: this.#expiresAt(now) };
  }

  // 서버가 다시 켜진 뒤 저장소에서 불러온 로그인을 메모리에 되살린다.
  restore(tokenHash, { email, csrfHashes, createdAt } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (typeof tokenHash !== 'string' || !HEX_HASH.test(tokenHash)) return false;
    if (!normalizedEmail || !Number.isFinite(createdAt) || !Array.isArray(csrfHashes)) return false;
    const hashes = csrfHashes
      .filter(hex => typeof hex === 'string' && HEX_HASH.test(hex))
      .map(hex => Buffer.from(hex, 'hex'));
    if (hashes.length === 0) return false;
    const now = this.now();
    this.#purgeExpired(now);
    while (this.sessions.size >= this.maxSessions) this.#deleteOldest();
    this.sessions.set(tokenHash, {
      email: normalizedEmail,
      csrfHashes: hashes.slice(-10),
      createdAt,
      lastSeenAt: now,
    });
    return true;
  }

  // 저장소에 쓸 값 (토큰 원문은 없음 · 해시만).
  snapshot(tokenHash) {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    return {
      email: session.email,
      csrfHashes: session.csrfHashes.map(hash => hash.toString('hex')),
      createdAt: session.createdAt,
    };
  }

  authenticate(token, { touch = true } = {}) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const now = this.now();
    const tokenHash = AdminSessionManager.hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (this.#isExpired(session, now)) {
      this.sessions.delete(tokenHash);
      return null;
    }
    if (touch) session.lastSeenAt = now;
    return {
      email: session.email,
      createdAt: session.createdAt,
      expiresAt: this.#expiresAt(session.createdAt),
    };
  }

  verifyCsrf(token, csrfToken) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const session = this.sessions.get(AdminSessionManager.hashToken(token));
    if (!session || this.#isExpired(session, this.now())) return false;
    return session.csrfHashes.some(expectedHash => secretsEqual(expectedHash, csrfToken));
  }

  rotateCsrf(token) {
    if (!this.authenticate(token)) return null;
    const session = this.sessions.get(AdminSessionManager.hashToken(token));
    const csrfToken = this.tokenFactory();
    session.csrfHashes.push(hashSecret(csrfToken));
    if (session.csrfHashes.length > 10) session.csrfHashes.shift();
    return csrfToken;
  }

  destroy(token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    return this.sessions.delete(AdminSessionManager.hashToken(token));
  }

  #expiresAt(createdAt) {
    return Number.isFinite(this.absoluteTtlMs) ? createdAt + this.absoluteTtlMs : null;
  }

  #isExpired(session, now) {
    return now - session.lastSeenAt >= this.idleTtlMs || now - session.createdAt >= this.absoluteTtlMs;
  }

  #purgeExpired(now) {
    for (const [key, session] of this.sessions) {
      if (this.#isExpired(session, now)) this.sessions.delete(key);
    }
  }

  #deleteOldest() {
    let oldestKey;
    let oldestCreatedAt = Infinity;
    for (const [key, session] of this.sessions) {
      if (session.createdAt < oldestCreatedAt) {
        oldestKey = key;
        oldestCreatedAt = session.createdAt;
      }
    }
    if (oldestKey) this.sessions.delete(oldestKey);
  }
}

module.exports = {
  AdminSessionManager,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_MAX_SESSIONS,
};
