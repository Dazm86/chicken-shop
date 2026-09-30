const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// DB_FILE can be overridden (used by the test suite to get an isolated database).
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(process.cwd(), 'data', 'chicken-shop.db');
const DATA_DIR = path.dirname(DB_FILE);

fs.mkdirSync(DATA_DIR, { recursive: true });

let db;
let readyPromise;

// Bump this whenever a table definition changes. Existing databases with an older
// PRAGMA user_version are migrated automatically on startup (see migrate()).
const SCHEMA_VERSION = 2;

const DDL = `
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
      price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0),
      unit TEXT NOT NULL DEFAULT 'kg',
      stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0),
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
      postal_code TEXT,
      plaque TEXT,
      unit TEXT,
      description TEXT,
      latitude REAL CHECK(latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
      longitude REAL CHECK(longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discount_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
      value INTEGER NOT NULL CHECK(value >= 0),
      min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK(min_order_amount >= 0),
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      CHECK(type != 'percent' OR (value BETWEEN 0 AND 100))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      address_id INTEGER,
      subtotal INTEGER NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
      discount_amount INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
      delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK(delivery_fee >= 0),
      total_amount INTEGER NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
      payment_method TEXT NOT NULL DEFAULT 'cod' CHECK(payment_method IN ('online','cod')),
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','preparing','shipped','delivered','cancelled')),
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
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
      total_price INTEGER NOT NULL CHECK(total_price >= 0),
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
      method TEXT NOT NULL CHECK(method IN ('online','cod')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded')),
      amount INTEGER NOT NULL DEFAULT 0 CHECK(amount >= 0),
      reference TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      store_name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      is_open INTEGER NOT NULL DEFAULT 1,
      min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK(min_order_amount >= 0),
      default_delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK(default_delivery_fee >= 0),
      free_delivery_min_amount INTEGER NOT NULL DEFAULT 0 CHECK(free_delivery_min_amount >= 0),
      manual_status INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL UNIQUE CHECK(day_of_week BETWEEN 0 AND 6),
      open_time TEXT,
      close_time TEXT,
      closed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS delivery_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK(delivery_fee >= 0),
      free_delivery_min_amount INTEGER NOT NULL DEFAULT 0 CHECK(free_delivery_min_amount >= 0),
      max_distance_km REAL,
      test_latitude REAL CHECK(test_latitude IS NULL OR (test_latitude BETWEEN -90 AND 90)),
      test_longitude REAL CHECK(test_longitude IS NULL OR (test_longitude BETWEEN -180 AND 180))
    );

    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('customer','admin')),
      code TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_purpose ON otp_codes(phone, purpose);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('user','admin')),
      subject_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
`;

// Individual statements ("CREATE TABLE ..." / "CREATE INDEX ..."), split once.
const STATEMENTS = DDL.split(';').map(s => s.trim()).filter(Boolean);
const TABLE_DDL = {};
for (const stmt of STATEMENTS) {
  const m = stmt.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);
  if (m) TABLE_DDL[m[1]] = stmt;
}

function scalar(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.get()[0] : null;
  stmt.free();
  return row;
}

function columnsOf(table) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  return r.length ? r[0].values.map(row => row[1]) : [];
}

const squash = sql => sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();

// Older database files were created before some columns/CHECK constraints existed
// (for example addresses.postal_code). "CREATE TABLE IF NOT EXISTS" never upgrades an
// existing table, so every table whose stored definition differs from the current one
// is rebuilt (SQLite's documented create-new / copy / drop / rename procedure), keeping
// all existing rows and the AUTOINCREMENT counters.
function migrate() {
  const version = scalar('PRAGMA user_version') || 0;
  if (version >= SCHEMA_VERSION) return;

  const existing = new Set(db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.flat() || []);
  const toRebuild = Object.keys(TABLE_DDL).filter(name => {
    if (!existing.has(name)) return false;
    const current = scalar("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", [name]) || '';
    const wanted = TABLE_DDL[name].replace('IF NOT EXISTS ', '');
    return squash(current) !== squash(wanted);
  });

  if (toRebuild.length) {
    console.log('Upgrading database schema, rebuilding tables: ' + toRebuild.join(', '));
    db.run('PRAGMA foreign_keys = OFF;');
    db.run('BEGIN');
    try {
      for (const name of toRebuild) {
        const tmp = name + '__new';
        const oldCols = columnsOf(name);
        db.run(TABLE_DDL[name].replace(`CREATE TABLE IF NOT EXISTS ${name}`, `CREATE TABLE ${tmp}`));
        const common = columnsOf(tmp).filter(c => oldCols.includes(c));
        const seq = scalar('SELECT seq FROM sqlite_sequence WHERE name = ?', [name]);
        db.run(`INSERT INTO ${tmp} (${common.join(', ')}) SELECT ${common.join(', ')} FROM ${name}`);
        db.run(`DROP TABLE ${name}`);
        db.run(`ALTER TABLE ${tmp} RENAME TO ${name}`);
        if (seq !== null) {
          db.run('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?', [seq, name]);
        }
      }
      const violations = db.exec('PRAGMA foreign_key_check');
      if (violations.length) throw new Error('foreign key check failed after migration');
      db.run('COMMIT');
    } catch (err) {
      try { db.run('ROLLBACK'); } catch (_) { /* nothing open */ }
      db.run('PRAGMA foreign_keys = ON;');
      throw new Error('Database migration failed: ' + err.message);
    }
  }
  db.run('PRAGMA foreign_keys = ON;');
}

function schema() {
  migrate();
  db.run('PRAGMA foreign_keys = ON;');
  db.run(DDL);
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);


  db.run(`INSERT OR IGNORE INTO store_settings
    (id, store_name, phone, address, is_open, min_order_amount, default_delivery_fee, free_delivery_min_amount, manual_status)
    VALUES (1, 'مرغ فروشی', NULL, NULL, 1, 0, 0, 0, 1)`);

  db.run(`INSERT OR IGNORE INTO delivery_settings
    (id, enabled, delivery_fee, free_delivery_min_amount)
    VALUES (1, 1, 0, 0)`);

  seedCategoriesAndProducts();
  seedBusinessHours();
  seedOwner();

  save();
}

function seedCategoriesAndProducts() {
  const existing = db.exec(`SELECT COUNT(*) FROM categories`);
  const count = existing.length ? existing[0].values[0][0] : 0;
  if (count > 0) return;

  db.run(`INSERT INTO categories (name, sort_order, active) VALUES
    ('مرغ کامل و قطعات', 1, 1),
    ('فیله و بی‌استخوان', 2, 1),
    ('محصولات فرآوری‌شده', 3, 1)`);

  db.run(`INSERT INTO products (category_id, name, description, price, unit, stock, active) VALUES
    (1, 'مرغ کامل', 'مرغ تازه کامل، پاک‌شده', 185000, 'kg', 50, 1),
    (1, 'ران مرغ', 'ران مرغ تازه با پوست', 165000, 'kg', 40, 1),
    (1, 'بال مرغ', 'بال مرغ تازه', 140000, 'kg', 30, 1),
    (2, 'سینه مرغ', 'سینه مرغ بدون استخوان', 210000, 'kg', 35, 1),
    (2, 'فیله مرغ', 'فیله مرغ تمیز شده', 230000, 'kg', 25, 1)`);
}

function seedOwner() {
  const ownerPhone = process.env.OWNER_PHONE || '09945641186';
  db.run(
    `INSERT OR IGNORE INTO admin_users (phone, name, role, active) VALUES (?, 'مدیر اصلی', 'owner', 1)`,
    [ownerPhone]
  );
}

// Without business hours, automatic mode would treat the shop as permanently closed,
// so seed a sensible default (every day 00:00-23:59) only when the table is empty.
function seedBusinessHours() {
  const existing = db.exec(`SELECT COUNT(*) FROM business_hours`);
  const count = existing.length ? existing[0].values[0][0] : 0;
  if (count > 0) return;
  for (let day = 0; day <= 6; day++) {
    db.run(
      `INSERT INTO business_hours (day_of_week, open_time, close_time, closed) VALUES (?, '00:00', '23:59', 0)`,
      [day]
    );
  }
}

function save() {
  const data = Buffer.from(db.export());
  fs.writeFileSync(DB_FILE, data);
  // sql.js resets connection PRAGMAs when exporting, so foreign key enforcement
  // must be switched back on after every save (otherwise FKs silently stop working).
  db.run('PRAGMA foreign_keys = ON;');
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
