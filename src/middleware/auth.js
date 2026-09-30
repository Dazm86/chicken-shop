const { get } = require('../db/helpers');
const { findSession } = require('../services/sessionService');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    const session = await findSession(token, 'user');
    if (!session) return res.status(401).json({ success: false, error: 'ورود لازم است' });
    const user = await get('SELECT id, phone, name FROM users WHERE id = ?', [session.subject_id]);
    if (!user) return res.status(401).json({ success: false, error: 'ورود لازم است' });
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const token = bearerToken(req);
    const session = await findSession(token, 'admin');
    if (!session) return res.status(401).json({ success: false, error: 'ورود مدیر لازم است' });
    const admin = await get(
      'SELECT id, phone, name, role, active FROM admin_users WHERE id = ?',
      [session.subject_id]
    );
    if (!admin || !admin.active) return res.status(401).json({ success: false, error: 'ورود مدیر لازم است' });
    req.admin = admin;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
}

function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'فقط مدیر اصلی اجازه این کار را دارد' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireOwner };
