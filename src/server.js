require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db/database');

const authRoutes = require('./routes/auth');
const adminAuthRoutes = require('./routes/adminAuth');
const storeRoutes = require('./routes/store');
const addressRoutes = require('./routes/addresses');
const discountRoutes = require('./routes/discounts');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// CORS is limited to local origins by default; the site itself is served from the
// same origin so it does not need CORS at all. Extra origins can be added via env.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public/customer/index.html'));
});

app.get('/api/health', async (req, res) => {
  try {
    await getDb();
    res.json({ success: true, message: 'Chicken Shop API is running', database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
  }
});

app.use('/api', storeRoutes);              // /api/store, /api/categories, /api/products
app.use('/api/auth', authRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminAuthRoutes);    // /api/admin/login/*, /logout, /me
app.use('/api/admin', adminRoutes);        // everything else, requireAdmin inside

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'مسیر یافت نشد' });
});

// Central error handler: malformed JSON etc. Never leaks internal error details.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ success: false, error: 'فرمت JSON نامعتبر است' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'حجم درخواست زیاد است' });
  }
  console.error('Unhandled error:', err && err.message);
  res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
});

async function start() {
  try {
    await getDb();
    return app.listen(PORT, '0.0.0.0', () => {
      console.log(`Chicken Shop API running on port ${PORT}`);
      console.log('Database: SQLite via sql.js (Android/Termux compatible)');
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
