const { get, run } = require('../db/helpers');
const { generateOtp } = require('../utils/token');

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 2 * 60 * 1000); // 2 minutes by default
const RATE_LIMIT_MS = Number(process.env.OTP_RATE_LIMIT_MS || 30 * 1000); // 30s between requests
const MAX_ATTEMPTS = 5;

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

// Returns { ok:true, devCode } or { ok:false, status, error }
async function requestOtp(phone, purpose) {
  const recent = await get(
    `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [phone, purpose]
  );
  if (recent) {
    const createdMs = new Date(recent.created_at.replace(' ', 'T') + 'Z').getTime();
    if (Date.now() - createdMs < RATE_LIMIT_MS) {
      return { ok: false, status: 429, error: 'لطفاً کمی صبر کن و دوباره درخواست کد بده' };
    }
  }

  const code = generateOtp();
  await run(
    `INSERT INTO otp_codes (phone, purpose, code, attempts, used, expires_at) VALUES (?, ?, ?, 0, 0, ?)`,
    [phone, purpose, code, isoIn(OTP_TTL_MS)]
  );

  // Mock/dev mode: no real SMS provider is connected, so the code is returned
  // directly in the API response for local testing (see spec: OTP must be testable).
  return { ok: true, devCode: code };
}

// Returns { ok:true } or { ok:false, status, error }
async function verifyOtp(phone, purpose, code) {
  const row = await get(
    `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`,
    [phone, purpose]
  );
  if (!row) return { ok: false, status: 400, error: 'ابتدا درخواست کد کن' };

  const expiresMs = new Date(row.expires_at).getTime();
  if (Date.now() > expiresMs) {
    await run(`UPDATE otp_codes SET used = 1 WHERE id = ?`, [row.id]);
    return { ok: false, status: 400, error: 'کد منقضی شده، دوباره درخواست کن' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await run(`UPDATE otp_codes SET used = 1 WHERE id = ?`, [row.id]);
    return { ok: false, status: 429, error: 'تعداد تلاش بیش از حد مجاز، کد جدید بگیر' };
  }

  if (String(code) !== row.code) {
    await run(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    return { ok: false, status: 400, error: 'کد وارد شده نادرست است' };
  }

  await run(`UPDATE otp_codes SET used = 1 WHERE id = ?`, [row.id]);
  return { ok: true };
}

module.exports = { requestOtp, verifyOtp, OTP_TTL_MS };
