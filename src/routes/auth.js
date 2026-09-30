const express = require('express');
const { get, run } = require('../db/helpers');
const { normalizePhone, isValidIranPhone } = require('../utils/phone');
const { requestOtp, verifyOtp } = require('../services/otpService');
const { createSession, destroySession } = require('../services/sessionService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/request-otp', async (req, res) => {
  try {
    const phone = normalizePhone(req.body && req.body.phone);
    if (!isValidIranPhone(phone)) {
      return res.status(400).json({ success: false, error: 'شماره موبایل معتبر نیست' });
    }
    const result = await requestOtp(phone, 'customer');
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    res.json({ success: true, message: 'کد ارسال شد', dev_code: result.devCode });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const phone = normalizePhone(req.body && req.body.phone);
    const code = req.body && req.body.code;
    if (!isValidIranPhone(phone) || !code) {
      return res.status(400).json({ success: false, error: 'شماره یا کد نامعتبر است' });
    }
    const result = await verifyOtp(phone, 'customer', code);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });

    let user = await get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!user) {
      const inserted = await run('INSERT INTO users (phone) VALUES (?)', [phone]);
      user = await get('SELECT * FROM users WHERE id = ?', [inserted.lastInsertId]);
    }
    const token = await createSession('user', user.id);
    res.json({ success: true, token, user: { id: user.id, phone: user.phone, name: user.name } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    await destroySession(token, 'user');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
