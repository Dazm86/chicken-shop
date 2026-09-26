require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db/database');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public/customer/index.html'));
});

app.get('/api/health', async (req, res) => {
  try {
    await getDb();
    res.json({
      success: true,
      message: 'Chicken Shop API is running',
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/store', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM store_settings WHERE id = 1');
    const store = result.length ? result[0].values[0] : null;
    const columns = result.length ? result[0].columns : [];
    const data = store ? Object.fromEntries(columns.map((key, i) => [key, store[i]])) : null;
    res.json({ success: true, store: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
      ORDER BY p.id DESC
    `);
    const products = result.length
      ? result[0].values.map(row => Object.fromEntries(result[0].columns.map((key, i) => [key, row[i]])))
      : [];
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function start() {
  try {
    await getDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Chicken Shop API running on port ${PORT}`);
      console.log('Database: SQLite via sql.js (Android/Termux compatible)');
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

start();
