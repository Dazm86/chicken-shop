const express = require('express');
const { all, get, transaction } = require('../db/helpers');
const { requireAuth } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { isStoreOpen } = require('../services/storeService');
const { validateDiscount } = require('../services/discountService');
const { computeDeliveryFee, generateOrderNumber } = require('../services/deliveryService');
const { canCancel } = require('../services/orderStateMachine');

const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);

async function loadOrderWithItems(orderId) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return null;
  const items = await all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  const payment = await get('SELECT * FROM payments WHERE order_id = ?', [orderId]);
  return { ...order, items, payment };
}

router.post('/', async (req, res) => {
  const b = req.body || {};
  try {
    // 1. authentication -> requireAuth middleware
    // 2. store open
    const open = await isStoreOpen();
    if (!open) return res.status(400).json({ success: false, error: 'فروشگاه در حال حاضر بسته است' });

    // 7. quantity/items shape
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (rawItems.length === 0) return res.status(400).json({ success: false, error: 'سبد خرید خالی است' });
    if (rawItems.length > 100) return res.status(400).json({ success: false, error: 'تعداد اقلام زیاد است' });

    // Validate each line and merge duplicate product lines so stock is checked on the combined quantity.
    const merged = new Map();
    for (const it of rawItems) {
      const productId = Number(it && it.product_id);
      const quantity = Number(it && it.quantity);
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) {
        return res.status(400).json({ success: false, error: 'اقلام سبد خرید نامعتبر است' });
      }
      merged.set(productId, (merged.get(productId) || 0) + quantity);
    }
    const items = [...merged.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));

    // 13. address ownership
    if (!b.address_id) return res.status(400).json({ success: false, error: 'انتخاب آدرس الزامی است' });
    const address = await get('SELECT * FROM addresses WHERE id = ?', [b.address_id]);
    if (!address || address.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'آدرس نامعتبر است' });
    }

    const paymentMethod = b.payment_method === 'online' ? 'online' : 'cod';

    const result = await transaction(async (tx) => {
      // 4,5,6,8,9. resolve each product from DB (never trust client price), check active + stock
      const resolvedItems = [];
      let subtotal = 0;
      for (const it of items) {
        const product = tx.get('SELECT * FROM products WHERE id = ?', [it.product_id]);
        if (!product || !product.active) {
          throw Object.assign(new Error(`محصول یافت نشد یا غیرفعال است`), { httpStatus: 400 });
        }
        const quantity = Number(it.quantity);
        if (product.stock < quantity) {
          throw Object.assign(new Error(`موجودی «${product.name}» کافی نیست`), { httpStatus: 400 });
        }
        const totalPrice = Math.round(product.price * quantity);
        subtotal += totalPrice;
        resolvedItems.push({ product, quantity, unitPrice: product.price, totalPrice });
      }

      // 3. minimum order
      const store = tx.get('SELECT * FROM store_settings WHERE id = 1');
      if (store && subtotal < store.min_order_amount) {
        throw Object.assign(
          new Error(`حداقل مبلغ سفارش ${store.min_order_amount} تومان است`),
          { httpStatus: 400 }
        );
      }

      // 10. discount
      let discountAmount = 0;
      let discountRow = null;
      if (b.discount_code) {
        const discountResult = await validateDiscount(String(b.discount_code).trim().toUpperCase(), subtotal, tx);
        if (!discountResult.ok) {
          throw Object.assign(new Error(discountResult.error), { httpStatus: 400 });
        }
        discountAmount = discountResult.amount;
        discountRow = discountResult.discount;
      }

      // 11. delivery
      const deliverySettings = tx.get('SELECT * FROM delivery_settings WHERE id = 1');
      const deliveryFee = computeDeliveryFee(deliverySettings, subtotal);

      // 12. total
      const totalAmount = subtotal - discountAmount + deliveryFee;

      // 14. create order
      const orderNumber = generateOrderNumber();
      const orderInsert = tx.run(
        `INSERT INTO orders (order_number, user_id, address_id, subtotal, discount_amount, delivery_fee, total_amount, payment_method, payment_status, status, delivery_time, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'new', ?, ?)`,
        [orderNumber, req.user.id, address.id, subtotal, discountAmount, deliveryFee, totalAmount,
         paymentMethod, b.delivery_time || null, b.notes || null]
      );
      const orderId = orderInsert.lastInsertId;

      // 15. create order_items + 16. decrease stock
      for (const ri of resolvedItems) {
        tx.run(
          `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, ri.product.id, ri.product.name, ri.product.unit, ri.quantity, ri.unitPrice, ri.totalPrice]
        );
        tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [ri.quantity, ri.product.id]);
      }

      // 17. discount usage
      if (discountRow) {
        tx.run(
          'INSERT INTO discount_usages (discount_code_id, user_id, order_id) VALUES (?, ?, ?)',
          [discountRow.id, req.user.id, orderId]
        );
        tx.run('UPDATE discount_codes SET usage_count = usage_count + 1 WHERE id = ?', [discountRow.id]);
      }

      // 18. payment record
      tx.run(
        `INSERT INTO payments (order_id, method, status, amount) VALUES (?, ?, 'pending', ?)`,
        [orderId, paymentMethod, totalAmount]
      );

      return orderId;
    });

    const order = await loadOrderWithItems(result);
    res.status(201).json({ success: true, order });
  } catch (error) {
    const status = error.httpStatus || 500;
    res.status(status).json({ success: false, error: status === 500 ? 'خطای داخلی سرور' : error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const orders = await all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await loadOrderWithItems(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    if (order.user_id !== req.user.id) return res.status(403).json({ success: false, error: 'دسترسی غیرمجاز' });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    if (order.user_id !== req.user.id) return res.status(403).json({ success: false, error: 'دسترسی غیرمجاز' });
    if (!canCancel(order.status)) {
      return res.status(400).json({ success: false, error: 'این سفارش در وضعیت فعلی قابل لغو نیست' });
    }

    await transaction(async (tx) => {
      const items = tx.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items) {
        if (item.product_id) {
          tx.run('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
        }
      }
      tx.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
    });

    const updated = await loadOrderWithItems(order.id);
    res.json({ success: true, order: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
