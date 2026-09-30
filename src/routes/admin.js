const express = require('express');
const { all, get, run, transaction } = require('../db/helpers');
const { requireAdmin, requireOwner } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { logAdminAction } = require('../services/logService');
const { canTransition, canCancel } = require('../services/orderStateMachine');
const { normalizePhone, isValidIranPhone } = require('../utils/phone');

const router = express.Router();
router.use(requireAdmin);
router.param('id', validateId);

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  try {
    const store = await get('SELECT * FROM store_settings WHERE id = 1');
    const newOrders = await get("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'");
    const todayOrders = await get("SELECT COUNT(*) AS n FROM orders WHERE date(created_at) = date('now')");
    const todaySales = await get(
      "SELECT COALESCE(SUM(total_amount),0) AS s FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled'"
    );
    const shipping = await get("SELECT COUNT(*) AS n FROM orders WHERE status = 'shipped'");
    const recentOrders = await all('SELECT * FROM orders ORDER BY id DESC LIMIT 10');
    res.json({
      success: true,
      dashboard: {
        store_open: !!store && !!store.is_open,
        new_orders: newOrders.n,
        today_orders: todayOrders.n,
        today_sales: todaySales.s,
        shipping_orders: shipping.n,
        recent_orders: recentOrders
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Products ----------
router.get('/products', async (req, res) => {
  try {
    const products = await all(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id DESC`
    );
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/products', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, error: 'نام محصول الزامی است' });
    if (!(Number(b.price) >= 0)) return res.status(400).json({ success: false, error: 'قیمت نامعتبر است' });
    if (!(Number(b.stock) >= 0)) return res.status(400).json({ success: false, error: 'موجودی نامعتبر است' });

    const inserted = await run(
      `INSERT INTO products (category_id, name, description, price, unit, stock, image_url, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.category_id || null, String(b.name).trim(), b.description || null, Number(b.price),
       b.unit || 'kg', Number(b.stock), b.image_url || null, b.active === undefined ? 1 : (b.active ? 1 : 0)]
    );
    const product = await get('SELECT * FROM products WHERE id = ?', [inserted.lastInsertId]);
    await logAdminAction(req.admin.id, 'product_create', { id: product.id, name: product.name });
    res.status(201).json({ success: true, product });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ثبت محصول ناموفق بود' });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'محصول یافت نشد' });
    const b = req.body || {};
    if (b.price !== undefined && !(Number(b.price) >= 0)) return res.status(400).json({ success: false, error: 'قیمت نامعتبر است' });
    if (b.stock !== undefined && !(Number(b.stock) >= 0)) return res.status(400).json({ success: false, error: 'موجودی نامعتبر است' });

    const merged = {
      category_id: b.category_id !== undefined ? b.category_id : existing.category_id,
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      description: b.description !== undefined ? b.description : existing.description,
      price: b.price !== undefined ? Number(b.price) : existing.price,
      unit: b.unit !== undefined ? b.unit : existing.unit,
      stock: b.stock !== undefined ? Number(b.stock) : existing.stock,
      image_url: b.image_url !== undefined ? b.image_url : existing.image_url,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active
    };
    await run(
      `UPDATE products SET category_id=?, name=?, description=?, price=?, unit=?, stock=?, image_url=?, active=? WHERE id = ?`,
      [merged.category_id, merged.name, merged.description, merged.price, merged.unit, merged.stock,
       merged.image_url, merged.active, req.params.id]
    );
    const product = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'product_update', { id: product.id });
    res.json({ success: true, product });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ویرایش محصول ناموفق بود' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'محصول یافت نشد' });
    await run('DELETE FROM products WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'product_delete', { id: req.params.id, name: existing.name });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Categories ----------
router.get('/categories', async (req, res) => {
  try {
    const categories = await all('SELECT * FROM categories ORDER BY sort_order, id');
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, error: 'نام دسته الزامی است' });
    const inserted = await run(
      'INSERT INTO categories (name, sort_order, active) VALUES (?, ?, ?)',
      [String(b.name).trim(), Number(b.sort_order) || 0, b.active === undefined ? 1 : (b.active ? 1 : 0)]
    );
    const category = await get('SELECT * FROM categories WHERE id = ?', [inserted.lastInsertId]);
    await logAdminAction(req.admin.id, 'category_create', { id: category.id, name: category.name });
    res.status(201).json({ success: true, category });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ثبت دسته ناموفق بود' });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'دسته یافت نشد' });
    const b = req.body || {};
    const merged = {
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      sort_order: b.sort_order !== undefined ? Number(b.sort_order) : existing.sort_order,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active
    };
    await run('UPDATE categories SET name=?, sort_order=?, active=? WHERE id = ?',
      [merged.name, merged.sort_order, merged.active, req.params.id]);
    const category = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'category_update', { id: category.id });
    res.json({ success: true, category });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ویرایش دسته ناموفق بود' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'دسته یافت نشد' });
    await run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'category_delete', { id: req.params.id, name: existing.name });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Orders ----------
router.get('/orders', async (req, res) => {
  try {
    const status = req.query.status;
    const params = [];
    let sql = `
      SELECT o.*, u.phone AS customer_phone, u.name AS customer_name,
             a.address AS address_text, a.latitude, a.longitude
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN addresses a ON a.id = o.address_id
    `;
    if (status) { sql += ' WHERE o.status = ?'; params.push(status); }
    sql += ' ORDER BY o.id DESC';
    const orders = await all(sql, params);
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await get(
      `SELECT o.*, u.phone AS customer_phone, u.name AS customer_name,
              a.address AS address_text, a.latitude, a.longitude
       FROM orders o JOIN users u ON u.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.id = ?`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    const items = await all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    const payment = await get('SELECT * FROM payments WHERE order_id = ?', [order.id]);
    res.json({ success: true, order: { ...order, items, payment } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.put('/orders/:id/status', async (req, res) => {
  try {
    const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    const to = req.body && req.body.status;
    if (!canTransition(order.status, to)) {
      return res.status(400).json({ success: false, error: `تغییر وضعیت از ${order.status} به ${to} مجاز نیست` });
    }
    await run('UPDATE orders SET status = ? WHERE id = ?', [to, req.params.id]);
    await logAdminAction(req.admin.id, 'order_status_change', { id: order.id, from: order.status, to });
    const updated = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.json({ success: true, order: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/orders/:id/cancel', async (req, res) => {
  try {
    const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'سفارش یافت نشد' });
    if (!canCancel(order.status)) {
      return res.status(400).json({ success: false, error: 'این سفارش در وضعیت فعلی قابل لغو نیست' });
    }
    await transaction(async (tx) => {
      const items = tx.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items) {
        if (item.product_id) tx.run('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      tx.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
    });
    await logAdminAction(req.admin.id, 'order_cancel', { id: order.id });
    const updated = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.json({ success: true, order: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Customers ----------
router.get('/customers', async (req, res) => {
  try {
    const customers = await all(`
      SELECT u.id, u.phone, u.name, u.created_at,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      GROUP BY u.id
      ORDER BY u.id DESC
    `);
    res.json({ success: true, customers });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Discounts ----------
router.get('/discounts', async (req, res) => {
  try {
    const discounts = await all('SELECT * FROM discount_codes ORDER BY id DESC');
    res.json({ success: true, discounts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/discounts', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.code || !String(b.code).trim()) return res.status(400).json({ success: false, error: 'کد تخفیف الزامی است' });
    if (!['percent', 'fixed'].includes(b.type)) return res.status(400).json({ success: false, error: 'نوع تخفیف نامعتبر است' });
    if (!(Number(b.value) >= 0) || (b.type === 'percent' && Number(b.value) > 100)) {
      return res.status(400).json({ success: false, error: 'مقدار تخفیف نامعتبر است' });
    }
    const inserted = await run(
      `INSERT INTO discount_codes (code, type, value, min_order_amount, starts_at, ends_at, usage_limit, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(b.code).trim().toUpperCase(), b.type, Number(b.value), Number(b.min_order_amount) || 0,
       b.starts_at || null, b.ends_at || null, b.usage_limit || null, b.active === undefined ? 1 : (b.active ? 1 : 0)]
    );
    const discount = await get('SELECT * FROM discount_codes WHERE id = ?', [inserted.lastInsertId]);
    await logAdminAction(req.admin.id, 'discount_create', { id: discount.id, code: discount.code });
    res.status(201).json({ success: true, discount });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'کد تخفیف تکراری یا نامعتبر است' });
  }
});

router.put('/discounts/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM discount_codes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'کد تخفیف یافت نشد' });
    const b = req.body || {};
    const merged = {
      type: b.type !== undefined ? b.type : existing.type,
      value: b.value !== undefined ? Number(b.value) : existing.value,
      min_order_amount: b.min_order_amount !== undefined ? Number(b.min_order_amount) : existing.min_order_amount,
      starts_at: b.starts_at !== undefined ? b.starts_at : existing.starts_at,
      ends_at: b.ends_at !== undefined ? b.ends_at : existing.ends_at,
      usage_limit: b.usage_limit !== undefined ? b.usage_limit : existing.usage_limit,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active
    };
    await run(
      `UPDATE discount_codes SET type=?, value=?, min_order_amount=?, starts_at=?, ends_at=?, usage_limit=?, active=? WHERE id = ?`,
      [merged.type, merged.value, merged.min_order_amount, merged.starts_at, merged.ends_at,
       merged.usage_limit, merged.active, req.params.id]
    );
    const discount = await get('SELECT * FROM discount_codes WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'discount_update', { id: discount.id });
    res.json({ success: true, discount });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ویرایش کد تخفیف ناموفق بود' });
  }
});

router.delete('/discounts/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM discount_codes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'کد تخفیف یافت نشد' });
    await run('DELETE FROM discount_codes WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'discount_delete', { id: req.params.id, code: existing.code });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Settings ----------
router.get('/settings', async (req, res) => {
  try {
    const store = await get('SELECT * FROM store_settings WHERE id = 1');
    const delivery = await get('SELECT * FROM delivery_settings WHERE id = 1');
    const businessHours = await all('SELECT * FROM business_hours ORDER BY day_of_week');
    res.json({ success: true, store, delivery, business_hours: businessHours });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.put('/settings/store', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM store_settings WHERE id = 1');
    const b = req.body || {};
    const merged = {
      store_name: b.store_name !== undefined ? String(b.store_name).trim() : existing.store_name,
      phone: b.phone !== undefined ? b.phone : existing.phone,
      address: b.address !== undefined ? b.address : existing.address,
      is_open: b.is_open !== undefined ? (b.is_open ? 1 : 0) : existing.is_open,
      manual_status: b.manual_status !== undefined ? (b.manual_status ? 1 : 0) : existing.manual_status,
      min_order_amount: b.min_order_amount !== undefined ? Number(b.min_order_amount) : existing.min_order_amount,
      default_delivery_fee: b.default_delivery_fee !== undefined ? Number(b.default_delivery_fee) : existing.default_delivery_fee,
      free_delivery_min_amount: b.free_delivery_min_amount !== undefined ? Number(b.free_delivery_min_amount) : existing.free_delivery_min_amount
    };
    await run(
      `UPDATE store_settings SET store_name=?, phone=?, address=?, is_open=?, manual_status=?, min_order_amount=?, default_delivery_fee=?, free_delivery_min_amount=? WHERE id = 1`,
      [merged.store_name, merged.phone, merged.address, merged.is_open, merged.manual_status,
       merged.min_order_amount, merged.default_delivery_fee, merged.free_delivery_min_amount]
    );
    await logAdminAction(req.admin.id, 'settings_update', { section: 'store' });
    const store = await get('SELECT * FROM store_settings WHERE id = 1');
    res.json({ success: true, store });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ذخیره تنظیمات ناموفق بود' });
  }
});

router.put('/settings/delivery', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM delivery_settings WHERE id = 1');
    const b = req.body || {};
    const merged = {
      enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled,
      delivery_fee: b.delivery_fee !== undefined ? Number(b.delivery_fee) : existing.delivery_fee,
      free_delivery_min_amount: b.free_delivery_min_amount !== undefined ? Number(b.free_delivery_min_amount) : existing.free_delivery_min_amount,
      max_distance_km: b.max_distance_km !== undefined ? Number(b.max_distance_km) : existing.max_distance_km
    };
    await run(
      `UPDATE delivery_settings SET enabled=?, delivery_fee=?, free_delivery_min_amount=?, max_distance_km=? WHERE id = 1`,
      [merged.enabled, merged.delivery_fee, merged.free_delivery_min_amount, merged.max_distance_km]
    );
    await logAdminAction(req.admin.id, 'settings_update', { section: 'delivery' });
    const delivery = await get('SELECT * FROM delivery_settings WHERE id = 1');
    res.json({ success: true, delivery });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ذخیره تنظیمات ناموفق بود' });
  }
});

router.put('/settings/business-hours', async (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.hours) ? req.body.hours : [];
    for (const h of rows) {
      if (!(Number(h.day_of_week) >= 0 && Number(h.day_of_week) <= 6)) {
        return res.status(400).json({ success: false, error: 'روز هفته نامعتبر است' });
      }
    }
    await transaction(async (tx) => {
      for (const h of rows) {
        tx.run(
          `INSERT INTO business_hours (day_of_week, open_time, close_time, closed) VALUES (?, ?, ?, ?)
           ON CONFLICT(day_of_week) DO UPDATE SET open_time=excluded.open_time, close_time=excluded.close_time, closed=excluded.closed`,
          [h.day_of_week, h.open_time || null, h.close_time || null, h.closed ? 1 : 0]
        );
      }
    });
    await logAdminAction(req.admin.id, 'settings_update', { section: 'business_hours' });
    const businessHours = await all('SELECT * FROM business_hours ORDER BY day_of_week');
    res.json({ success: true, business_hours: businessHours });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ذخیره ساعات کاری ناموفق بود' });
  }
});

// ---------- Owner-only: admin user management ----------
router.get('/users', requireOwner, async (req, res) => {
  try {
    const users = await all('SELECT id, phone, name, role, active, created_at FROM admin_users ORDER BY id DESC');
    res.json({ success: true, admins: users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/users', requireOwner, async (req, res) => {
  try {
    const b = req.body || {};
    const phone = normalizePhone(b.phone);
    if (!isValidIranPhone(phone)) return res.status(400).json({ success: false, error: 'شماره موبایل معتبر نیست' });
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, error: 'نام الزامی است' });
    const role = b.role === 'owner' ? 'owner' : 'admin';

    const inserted = await run(
      'INSERT INTO admin_users (phone, name, role, active) VALUES (?, ?, ?, 1)',
      [phone, String(b.name).trim(), role]
    );
    const admin = await get('SELECT id, phone, name, role, active FROM admin_users WHERE id = ?', [inserted.lastInsertId]);
    await logAdminAction(req.admin.id, 'admin_create', { id: admin.id, phone: admin.phone });
    res.status(201).json({ success: true, admin });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'این شماره قبلاً به‌عنوان مدیر ثبت شده است' });
  }
});

router.delete('/users/:id', requireOwner, async (req, res) => {
  try {
    const existing = await get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'مدیر یافت نشد' });
    if (Number(req.params.id) === req.admin.id) {
      return res.status(400).json({ success: false, error: 'نمی‌توانید خودتان را حذف کنید' });
    }
    await run('DELETE FROM admin_users WHERE id = ?', [req.params.id]);
    await logAdminAction(req.admin.id, 'admin_delete', { id: req.params.id, phone: existing.phone });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

// ---------- Logs ----------
router.get('/logs', async (req, res) => {
  try {
    const logs = await all(`
      SELECT l.*, a.name AS admin_name, a.phone AS admin_phone
      FROM admin_logs l LEFT JOIN admin_users a ON a.id = l.admin_user_id
      ORDER BY l.id DESC LIMIT 200
    `);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
