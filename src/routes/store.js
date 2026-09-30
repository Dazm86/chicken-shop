const express = require('express');
const { all, get } = require('../db/helpers');
const { isStoreOpen } = require('../services/storeService');

const { validateId } = require('../middleware/validateId');

const router = express.Router();
router.param('id', validateId);

router.get('/store', async (req, res) => {
  try {
    const store = await get('SELECT * FROM store_settings WHERE id = 1');
    const open = await isStoreOpen();
    const delivery = await get('SELECT enabled, delivery_fee, free_delivery_min_amount FROM delivery_settings WHERE id = 1');
    res.json({ success: true, store: { ...store, is_open: open ? 1 : 0 }, delivery });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = await all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, id');
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/products', async (req, res) => {
  try {
    let categoryId = null;
    if (req.query.category_id !== undefined) {
      if (!/^\d{1,12}$/.test(String(req.query.category_id))) {
        return res.status(400).json({ success: false, error: 'شناسه دسته نامعتبر است' });
      }
      categoryId = Number(req.query.category_id);
    }
    const params = [];
    let sql = `
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
    `;
    if (categoryId) {
      sql += ' AND p.category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY p.id DESC';
    const products = await all(sql, params);
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const product = await get(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND p.active = 1`,
      [req.params.id]
    );
    if (!product) return res.status(404).json({ success: false, error: 'محصول یافت نشد' });
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
