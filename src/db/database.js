const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'chicken-shop.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db;
let readyPromise;

function schema() {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg',
      stock REAL NOT NULL DEFAULT 0,
      image_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      province TEXT,
      city TEXT,
      address TEXT NOT NULL,
      plaque TEXT,
      unit TEXT,
      description TEXT,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discount_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
      value INTEGER NOT NULL,
      min_order_amount INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      address_id INTEGER,
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cod',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'new',
      delivery_time TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(address_id) REFERENCES addresses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS discount_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discount_code_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(discount_code_id) REFERENCES discount_codes(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount INTEGER NOT NULL DEFAULT 0,
      reference TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      store_name TEXT NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      min_order_amount INTEGER NOT NULL DEFAULT 0,
      default_delivery_fee INTEGER NOT NULL DEFAULT 0,
      free_delivery_min_amount INTEGER NOT NULL DEFAULT 0,
      manual_status INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL UNIQUE,
      open_time TEXT,
      close_time TEXT,
      closed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS delivery_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      free_delivery_min_amount INTEGER NOT NULL DEFAULT 0,
      max_distance_km REAL,
      test_latitude REAL,
      test_longitude REAL
    );

    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );
  `);

  db.run(`INSERT OR IGNORE INTO store_settings
    (id, store_name, is_open, min_order_amount, default_delivery_fee, free_delivery_min_amount, manual_status)
    VALUES (1, 'مرغ فروشی', 1, 0, 0, 0, 0)`);

  db.run(`INSERT OR IGNORE INTO delivery_settings
    (id, enabled, delivery_fee, free_delivery_min_amount)
    VALUES (1, 1, 0, 0)`);

  db.run(`INSERT OR IGNORE INTO admin_users (phone, name, role, active)
    VALUES ('09120000000', 'مدیر اصلی', 'owner', 1)`);

  save();
}

function save() {
  const data = Buffer.from(db.export());
  fs.writeFileSync(DB_FILE, data);
}

async function initDatabase() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const SQL = await initSqlJs();
      if (fs.existsSync(DB_FILE)) {
        const file = fs.readFileSync(DB_FILE);
        db = new SQL.Database(file);
      } else {
        db = new SQL.Database();
      }
      schema();
      return db;
    })();
  }
  return readyPromise;
}

async function getDb() {
  return initDatabase();
}

module.exports = {
  getDb,
  save,
  get DB_FILE() { return DB_FILE; }
};
