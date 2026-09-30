const { get, run } = require('../db/helpers');
const { randomToken, hashToken } = require('../utils/token');

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000); // 30 days

async function createSession(subjectType, subjectId) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(
    `INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES (?, ?, ?, ?)`,
    [hashToken(token), subjectType, subjectId, expiresAt]
  );
  return token;
}

async function findSession(token, subjectType) {
  if (!token) return null;
  const row = await get(
    `SELECT * FROM sessions WHERE token_hash = ? AND subject_type = ?`,
    [hashToken(token), subjectType]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

async function destroySession(token, subjectType) {
  if (!token) return;
  await run(`DELETE FROM sessions WHERE token_hash = ? AND subject_type = ?`, [hashToken(token), subjectType]);
}

module.exports = { createSession, findSession, destroySession };
