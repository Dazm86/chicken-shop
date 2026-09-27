const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chicken-shop.db');
let db; let readyPromise;
function run(sql, params = []) { db.run(sql, params); const id = all('SELECT last_insert_rowid() AS id')[0].id; save(); return id; }
function all(sql, params = []) { const s = db.prepare(sql, params); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
function one(sql, params = []) { return all(sql, params)[0] || null; }
function save() { if (db) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, Buffer.from(db.export())); } }
function schema() {
  db.run(`PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,phone TEXT UNIQUE NOT NULL,name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS admin_users(id INTEGER PRIMARY KEY,phone TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','admin')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sort_order INTEGER DEFAULT 0,active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,name TEXT NOT NULL,description TEXT,price INTEGER NOT NULL CHECK(price>=0),unit TEXT NOT NULL CHECK(unit IN('kg','piece','pack')),stock REAL NOT NULL DEFAULT 0 CHECK(stock>=0),image_url TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS addresses(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,province TEXT NOT NULL,city TEXT NOT NULL,address TEXT NOT NULL,plaque TEXT,unit TEXT,description TEXT,latitude REAL,longitude REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS discount_codes(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,type TEXT NOT NULL CHECK(type IN('percent','fixed')),value INTEGER NOT NULL CHECK(value>=0),min_order_amount INTEGER DEFAULT 0,starts_at TEXT,ends_at TEXT,usage_limit INTEGER,usage_count INTEGER DEFAULT 0,active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,order_number TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),address_id INTEGER REFERENCES addresses(id),subtotal INTEGER NOT NULL,discount_amount INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,total_amount INTEGER NOT NULL,payment_method TEXT NOT NULL CHECK(payment_method IN('mock_online','cod')),payment_status TEXT NOT NULL DEFAULT 'pending',status TEXT NOT NULL DEFAULT 'new' CHECK(status IN('new','confirmed','preparing','shipped','delivered','cancelled')),delivery_time TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER REFERENCES products(id),product_name TEXT NOT NULL,unit TEXT NOT NULL,quantity REAL NOT NULL,unit_price INTEGER NOT NULL,total_price INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS discount_usages(id INTEGER PRIMARY KEY,discount_code_id INTEGER NOT NULL REFERENCES discount_codes(id),user_id INTEGER NOT NULL REFERENCES users(id),order_id INTEGER NOT NULL REFERENCES orders(id),used_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,method TEXT NOT NULL,status TEXT DEFAULT 'pending',amount INTEGER NOT NULL,reference TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS store_settings(id INTEGER PRIMARY KEY CHECK(id=1),store_name TEXT NOT NULL,logo_url TEXT,is_open INTEGER DEFAULT 1,min_order_amount INTEGER DEFAULT 100000,default_delivery_fee INTEGER DEFAULT 30000,free_delivery_min_amount INTEGER DEFAULT 500000,manual_status INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS business_hours(id INTEGER PRIMARY KEY,day_of_week INTEGER UNIQUE NOT NULL,open_time TEXT,close_time TEXT,closed INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS delivery_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER DEFAULT 1,delivery_fee INTEGER DEFAULT 30000,free_delivery_min_amount INTEGER DEFAULT 500000,max_distance_km REAL DEFAULT 20,test_latitude REAL,test_longitude REAL);
  CREATE TABLE IF NOT EXISTS admin_logs(id INTEGER PRIMARY KEY,admin_user_id INTEGER REFERENCES admin_users(id),action TEXT NOT NULL,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS otp_codes(id INTEGER PRIMARY KEY,phone TEXT NOT NULL,code TEXT NOT NULL,expires_at TEXT NOT NULL,used INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY,token TEXT UNIQUE NOT NULL,user_id INTEGER REFERENCES users(id),admin_user_id INTEGER REFERENCES admin_users(id),expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP, CHECK(user_id IS NOT NULL OR admin_user_id IS NOT NULL));`);
  run(`INSERT OR IGNORE INTO store_settings(id,store_name,logo_url,is_open,min_order_amount,default_delivery_fee,free_delivery_min_amount,manual_status) VALUES(1,'مرغ فروشی بهار','🐔',1,100000,30000,500000,1)`);
  run(`INSERT OR IGNORE INTO delivery_settings(id,enabled,delivery_fee,free_delivery_min_amount,max_distance_km) VALUES(1,1,30000,500000,20)`);
  run(`INSERT OR IGNORE INTO admin_users(phone,name,role,active) VALUES('09120000000','مدیر اصلی','owner',1)`);
  for (let d=0;d<7;d++) run('INSERT OR IGNORE INTO business_hours(day_of_week,open_time,close_time,closed) VALUES(?,?,?,0)',[d,'09:00','22:00']);
  if (!one('SELECT id FROM categories LIMIT 1')) {
    [['مرغ تازه',1],['محصولات مزه‌دار',2],['تخم مرغ',3]].forEach(x=>run('INSERT INTO categories(name,sort_order) VALUES(?,?)',x));
    const cats=all('SELECT id FROM categories ORDER BY id');
    [['مرغ کامل تازه','مرغ پاک‌شده روزانه',185000,'kg',20,'🐔',cats[0].id],['سینه مرغ بدون استخوان','مناسب گریل و رژیمی',320000,'kg',15,'🍗',cats[0].id],['ران مرغ','ران تازه و پاک‌شده',195000,'kg',25,'🍗',cats[0].id],['بال کبابی مزه‌دار','آماده طبخ با ادویه مخصوص',245000,'pack',12,'🔥',cats[1].id],['تخم مرغ محلی','شانه ۲۰ عددی',165000,'pack',30,'🥚',cats[2].id]].forEach(p=>run('INSERT INTO products(name,description,price,unit,stock,image_url,category_id) VALUES(?,?,?,?,?,?,?)',p));
  }
}
async function initDatabase() { if (!readyPromise) readyPromise=(async()=>{const SQL=await initSqlJs(); db=fs.existsSync(DB_FILE)?new SQL.Database(fs.readFileSync(DB_FILE)):new SQL.Database(); schema(); return db;})(); return readyPromise; }
async function getDb(){ return initDatabase(); }
function resetForTests(){ db=undefined; readyPromise=undefined; }
module.exports={getDb,run,all,one,save,resetForTests,get DB_FILE(){return DB_FILE;}};
