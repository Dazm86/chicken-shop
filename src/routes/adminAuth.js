const express = require('express');
const { get } = require('../db/helpers');
const { normalizePhone, isValidIranPhone } = require('../utils/phone');
const { requestOtp, verifyOtp } = require('../services/otpService');
const { createSession, destroySession } = require('../services/sessionService');
const { requireAdmin } = require('../middleware/auth');
const { logAdminAction } = require('../services/logService');

const router = express.Router();

router.post('/login/request-otp', async (req, res) => {
  try {
    const phone = normalizePhone(req.body && req.body.phone);
    if (!isValidIranPhone(phone)) {
      return res.status(400).json({ success: false, error: 'شماره موبایل معتبر نیست' });
    }
    const admin = await get('SELECT * FROM admin_users WHERE phone = ? AND active = 1', [phone]);
    if (!admin) {
      return res.status(403).json({ success: false, error: 'این شماره اجازه دسترسی به پنل مدیریت را ندارد' });
    }
    const result = await requestOtp(phone, 'admin');
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    res.json({ success: true, message: 'کد ارسال شد', dev_code: result.devCode });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/login/verify-otp', async (req, res) => {
  try {
    const phone = normalizePhone(req.body && req.body.phone);
    const code = req.body && req.body.code;
    if (!isValidIranPhone(phone) || !code) {
      return res.status(400).json({ success: false, error: 'شماره یا کد نامعتبر است' });
    }
    const admin = await get('SELECT * FROM admin_users WHERE phone = ? AND active = 1', [phone]);
    if (!admin) {
      return res.status(403).json({ success: false, error: 'این شماره اجازه دسترسی به پنل مدیریت را ندارد' });
    }
    const result = await verifyOtp(phone, 'admin', code);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });

    const token = await createSession('admin', admin.id);
    await logAdminAction(admin.id, 'login', { phone });
    res.json({
      success: true,
      token,
      admin: { id: admin.id, phone: admin.phone, name: admin.name, role: admin.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/logout', requireAdmin, async (req, res) => {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    await destroySession(token, 'admin');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

module.exports = router;
