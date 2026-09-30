const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, customerLogin, adminLogin, tempDbFile } = require('./helpers');

// Two REAL server processes share one database file. Process A is killed hard
// (SIGKILL, no graceful shutdown hook) and process B must still see everything.
describe('persistence across real process restarts', () => {
  const dbFile = tempDbFile();
  const PHONE = '09131234567';
  const state = {};

  it('process A: create customer, address, order, admin data, settings', async () => {
    const a = await startServer({ dbFile });
    try {
      const api = client(a.base);
      state.customerToken = await customerLogin(api, PHONE);
      const addr = await api.post('/api/addresses', { address: 'تهران، خیابان ولیعصر', latitude: 35.72, longitude: 51.41, city: 'تهران' }, { token: state.customerToken });
      assert.equal(addr.status, 201);
      state.addressId = addr.body.address.id;

      const owner = await adminLogin(api, '09945641186');
      state.adminToken = owner;
      const prod = await api.post('/api/admin/products', { name: 'ماندگاری تست', price: 12345, stock: 7, category_id: 1 }, { token: owner });
      state.productId = prod.body.product.id;
      await api.put('/api/admin/settings/store', { store_name: 'فروشگاه ماندگار', phone: '02100000000' }, { token: owner });
      await api.post('/api/admin/discounts', { code: 'STAY5', type: 'fixed', value: 5000 }, { token: owner });

      const order = await api.post('/api/orders', { items: [{ product_id: state.productId, quantity: 3 }], address_id: state.addressId, payment_method: 'online', discount_code: 'STAY5' }, { token: state.customerToken });
      assert.equal(order.status, 201, JSON.stringify(order.body));
      state.order = order.body.order;
      await api.post('/api/payments/mock', { order_id: state.order.id }, { token: state.customerToken });
      await api.put(`/api/admin/orders/${state.order.id}/status`, { status: 'confirmed' }, { token: owner });
    } finally {
      a.child.kill('SIGKILL');
      await new Promise(r => a.child.once('exit', r));
    }
  });

  it('process B (fresh process, same file): everything is still there', async () => {
    const b = await startServer({ dbFile });
    try {
      const api = client(b.base);
      // sessions survive the restart (stored hashed in the DB)
      const me = await api.get('/api/auth/me', { token: state.customerToken });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.phone, PHONE);
      assert.equal((await api.get('/api/admin/me', { token: state.adminToken })).status, 200);

      const orders = await api.get('/api/orders', { token: state.customerToken });
      assert.equal(orders.body.orders.length, 1);
      const o = (await api.get('/api/orders/' + state.order.id, { token: state.customerToken })).body.order;
      assert.equal(o.total_amount, state.order.total_amount);
      assert.equal(o.total_amount, 12345 * 3 - 5000);
      assert.equal(o.status, 'confirmed');
      assert.equal(o.payment_status, 'paid');
      assert.equal(o.items[0].product_name, 'ماندگاری تست');

      const addresses = await api.get('/api/addresses', { token: state.customerToken });
      assert.equal(addresses.body.addresses[0].address, 'تهران، خیابان ولیعصر');
      assert.equal(addresses.body.addresses[0].latitude, 35.72);

      const prod = await api.get('/api/products/' + state.productId);
      assert.equal(prod.body.product.stock, 4, 'stock decrease persisted');
      const store = (await api.get('/api/store')).body.store;
      assert.equal(store.store_name, 'فروشگاه ماندگار');
      assert.equal(store.phone, '02100000000');
      const disc = (await api.get('/api/admin/discounts', { token: state.adminToken })).body.discounts.find(d => d.code === 'STAY5');
      assert.equal(disc.usage_count, 1, 'discount usage persisted');
      const logs = (await api.get('/api/admin/logs', { token: state.adminToken })).body.logs;
      assert.ok(logs.some(l => l.action === 'order_status_change'));

      // seed must not duplicate on restart
      assert.equal((await api.get('/api/categories')).body.categories.length, 3);
      assert.equal((await api.get('/api/admin/users', { token: state.adminToken })).body.admins.length, 1);

      // and the restarted process keeps working for new writes
      const cancel = await api.post(`/api/orders/${state.order.id}/cancel`, {}, { token: state.customerToken });
      assert.equal(cancel.status, 200);
      assert.equal((await api.get('/api/products/' + state.productId)).body.product.stock, 7);
    } finally {
      b.child.kill('SIGKILL');
      await new Promise(r => b.child.once('exit', r));
    }
  });

  it('process C: writes made after the second restart are persisted too', async () => {
    const c = await startServer({ dbFile });
    try {
      const api = client(c.base);
      const o = (await api.get('/api/orders/' + state.order.id, { token: state.customerToken })).body.order;
      assert.equal(o.status, 'cancelled');
      assert.equal((await api.get('/api/products/' + state.productId)).body.product.stock, 7);
    } finally {
      await c.stop();
    }
  });
});

// A database file created by the very first version (no postal_code column, no CHECK
// constraints) must be upgraded automatically without losing rows.
describe('automatic upgrade of an old-schema database', () => {
  const fs = require('fs');
  const path = require('path');
  const initSqlJs = require('sql.js');
  const dbFile = tempDbFile();

  it('old file is migrated, keeps its data, and addresses with postal_code work', async () => {
    const SQL = await initSqlJs();
    const old = new SQL.Database();
    old.run(fs.readFileSync(path.join(__dirname, 'fixtures', 'old-schema.sql'), 'utf8'));
    old.run("INSERT INTO categories (name) VALUES ('قدیمی')");
    old.run("INSERT INTO products (category_id, name, price, stock) VALUES (1, 'محصول قدیمی', 1000, 5)");
    old.run("INSERT INTO users (phone) VALUES ('09140000000')");
    old.run("INSERT INTO addresses (user_id, address) VALUES (1, 'آدرس قدیمی')");
    old.run("INSERT INTO orders (order_number, user_id, address_id, subtotal, total_amount) VALUES ('OLD-1', 1, 1, 1000, 1000)");
    old.run("INSERT INTO store_settings (id, store_name, is_open, manual_status) VALUES (1, 'فروشگاه قدیمی', 1, 0)");
    fs.writeFileSync(dbFile, Buffer.from(old.export()));

    const s = await startServer({ dbFile, env: { OTP_RATE_LIMIT_MS: '0' } });
    try {
      assert.match(s.output(), /Upgrading database schema/);
      const api = client(s.base);
      const store = (await api.get('/api/store')).body.store;
      assert.equal(store.store_name, 'فروشگاه قدیمی');
      assert.ok('phone' in store);
      assert.ok((await api.get('/api/products')).body.products.some(p => p.name === 'محصول قدیمی'));

      const token = await customerLogin(api, '09140000000');
      const addrs = (await api.get('/api/addresses', { token })).body.addresses;
      assert.equal(addrs[0].address, 'آدرس قدیمی');
      assert.equal((await api.get('/api/orders', { token })).body.orders[0].order_number, 'OLD-1', 'old order is kept');
    } finally { await s.stop(); }
  });

  it('after upgrade: postal_code saves, DB-level constraints exist, second start does not migrate again', async () => {
    const s = await startServer({ dbFile, env: { OTP_RATE_LIMIT_MS: '0' } });
    try {
      assert.doesNotMatch(s.output(), /Upgrading database schema/);
      const api = client(s.base);
      const token = await customerLogin(api, '09140000000');
      const r = await api.post('/api/addresses', { province: 'هرمزگان', city: 'لمزان', address: 'بندرلنگه', plaque: '53', unit: '1', postal_code: '2453197542', description: 'سلام', latitude: '27.046222', longitude: '54.893068' }, { token });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.address.postal_code, '2453197542');
      assert.equal(r.body.address.latitude, 27.046222);
      const orders = (await api.get('/api/orders', { token })).body.orders;
      assert.equal(orders.length, 1);
      assert.equal(orders[0].order_number, 'OLD-1');
    } finally { await s.stop(); }

    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbFile));
    db.run('PRAGMA foreign_keys = ON');
    assert.throws(() => db.run("INSERT INTO products (name, price, stock) VALUES ('x', -1, 1)"), /CHECK constraint/);
    assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], 2);
  });
});
