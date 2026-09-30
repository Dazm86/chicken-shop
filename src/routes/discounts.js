const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateDiscount } = require('../services/discountService');

const router = express.Router();

router.post('/validate', requireAuth, async (req, res) => {
  try {
    const { code, subtotal } = req.body || {};
    if (!code || typeof subtotal !== 'number' || subtotal < 0) {
      return res.status(400).json({ success: false, error: 'ورودی نامعتبر است' });
    }
    const result = await validateDiscount(String(code).trim().toUpperCase(), subtotal);
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, discount_amount: result.amount, type: result.discount.type, value: result.discount.value });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
