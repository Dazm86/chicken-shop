const express = require('express');
const { get, run } = require('../db/helpers');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/mock', requireAuth, async (req, res) => {
  try {
    const { order_id } = req.body || {};
    const order = await get('SELECT * FROM orders WHERE id = ?', [order_id]);
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    if (order.user_id !== req.user.id) return res.status(403).json({ success: false, error: 'دسترسی غیرمجاز' });

    const payment = await get('SELECT * FROM payments WHERE order_id = ?', [order.id]);
    if (!payment) return res.status(404).json({ success: false, error: 'رکورد پرداخت یافت نشد' });

    if (order.payment_method === 'online') {
      const reference = 'MOCK-' + Date.now();
      await run("UPDATE payments SET status = 'paid', reference = ? WHERE id = ?", [reference, payment.id]);
      await run("UPDATE orders SET payment_status = 'paid' WHERE id = ?", [order.id]);
      return res.json({ success: true, payment_status: 'paid', reference });
    }

    // Cash on delivery: nothing to charge now, collected at delivery time.
    res.json({ success: true, payment_status: 'pending', message: 'پرداخت هنگام تحویل انجام می‌شود' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
