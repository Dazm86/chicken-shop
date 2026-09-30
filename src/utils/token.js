const crypto = require('crypto');

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Only the hash is ever persisted to the database, never the raw token.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = { randomToken, hashToken, generateOtp };
