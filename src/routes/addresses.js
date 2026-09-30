const express = require('express');
const { all, get, run } = require('../db/helpers');
const { requireAuth } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');

const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);

function isValidLat(v) { return v === undefined || v === null || v === '' || (Number(v) >= -90 && Number(v) <= 90); }
function isValidLng(v) { return v === undefined || v === null || v === '' || (Number(v) >= -180 && Number(v) <= 180); }

router.get('/', async (req, res) => {
  try {
    const addresses = await all('SELECT * FROM addresses WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.json({ success: true, addresses });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.address || !String(b.address).trim()) {
      return res.status(400).json({ success: false, error: 'متن آدرس الزامی است' });
    }
    if (!isValidLat(b.latitude) || !isValidLng(b.longitude)) {
      return res.status(400).json({ success: false, error: 'مختصات نامعتبر است' });
    }
    const inserted = await run(
      `INSERT INTO addresses (user_id, province, city, address, postal_code, plaque, unit, description, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, b.province || null, b.city || null, String(b.address).trim(), b.postal_code || null,
       b.plaque || null, b.unit || null, b.description || null,
       b.latitude === undefined || b.latitude === '' ? null : Number(b.latitude),
       b.longitude === undefined || b.longitude === '' ? null : Number(b.longitude)]
    );
    const address = await get('SELECT * FROM addresses WHERE id = ?', [inserted.lastInsertId]);
    res.status(201).json({ success: true, address });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ثبت آدرس ناموفق بود' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM addresses WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'آدرس یافت نشد' });
    if (existing.user_id !== req.user.id) return res.status(403).json({ success: false, error: 'دسترسی غیرمجاز' });

    const b = req.body || {};
    if (b.latitude !== undefined && !isValidLat(b.latitude)) {
      return res.status(400).json({ success: false, error: 'مختصات نامعتبر است' });
    }
    if (b.longitude !== undefined && !isValidLng(b.longitude)) {
      return res.status(400).json({ success: false, error: 'مختصات نامعتبر است' });
    }

    const merged = {
      province: b.province !== undefined ? b.province : existing.province,
      city: b.city !== undefined ? b.city : existing.city,
      address: b.address !== undefined ? String(b.address).trim() : existing.address,
      postal_code: b.postal_code !== undefined ? b.postal_code : existing.postal_code,
      plaque: b.plaque !== undefined ? b.plaque : existing.plaque,
      unit: b.unit !== undefined ? b.unit : existing.unit,
      description: b.description !== undefined ? b.description : existing.description,
      latitude: b.latitude !== undefined ? (b.latitude === '' ? null : Number(b.latitude)) : existing.latitude,
      longitude: b.longitude !== undefined ? (b.longitude === '' ? null : Number(b.longitude)) : existing.longitude
    };
    await run(
      `UPDATE addresses SET province=?, city=?, address=?, postal_code=?, plaque=?, unit=?, description=?, latitude=?, longitude=? WHERE id = ?`,
      [merged.province, merged.city, merged.address, merged.postal_code, merged.plaque, merged.unit,
       merged.description, merged.latitude, merged.longitude, req.params.id]
    );
    const address = await get('SELECT * FROM addresses WHERE id = ?', [req.params.id]);
    res.json({ success: true, address });
  } catch (error) {
    console.error('[' + req.method + ' ' + req.originalUrl + '] ' + (error && error.message));
res.status(400).json({ success: false, error: 'ویرایش آدرس ناموفق بود' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM addresses WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'آدرس یافت نشد' });
    if (existing.user_id !== req.user.id) return res.status(403).json({ success: false, error: 'دسترسی غیرمجاز' });
    await run('DELETE FROM addresses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

module.exports = router;
