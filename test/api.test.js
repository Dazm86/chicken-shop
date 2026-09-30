const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { startServer, client, customerLogin, adminLogin } = require('./helpers');

const OWNER = '09945641186';
const CUST_A = '09121111111';
const CUST_B = '09122222222';
const ADMIN2 = '09123333333';

describe('Chicken Shop API (real server process)', () => {
  let srv, api, ownerToken, tokenA, tokenB, addrA, adminToken2;

  before(async () => {
    srv = await startServer();
    api = client(srv.base);
  });
  after(async () => { await srv.stop(); });

  // ---------- public store ----------
  it('health returns 200', async () => {
    const r = await api.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
  });

  it('store info includes open state, phone and address fields', async () => {
    const r = await api.get('/api/store');
    assert.equal(r.status, 200);
    assert.equal(r.body.store.is_open, 1);
    assert.ok('phone' in r.body.store && 'address' in r.body.store);
  });

  it('categories are listed', async () => {
    const r = await api.get('/api/categories');
    assert.equal(r.status, 200);
    assert.equal(r.body.categories.length, 3);
  });

  it('products list, category filter, single product, invalid ids', async () => {
    const all = await api.get('/api/products');
    assert.equal(all.body.products.length, 5);
    assert.ok(all.body.products.some(p => p.name === 'سینه مرغ'));
    const filtered = await api.get('/api/products?category_id=2');
    assert.equal(filtered.body.products.length, 2);
    assert.ok(filtered.body.products.every(p => p.category_id === 2));
    const one = await api.get('/api/products/1');
    assert.equal(one.status, 200);
    assert.equal((await api.get('/api/products/999')).status, 404);
    assert.equal((await api.get('/api/products/abc')).status, 400);
    assert.equal((await api.get('/api/products?category_id=1%20OR%201=1')).status, 400);
  });

  // ---------- customer auth ----------
  it('rejects invalid phone numbers', async () => {
    for (const phone of ['', '123', '09abc', "' OR 1=1 --", '0912345']) {
      const r = await api.post('/api/auth/request-otp', { phone });
      assert.equal(r.status, 400, 'phone: ' + phone);
    }
  });

  it('OTP: wrong code rejected, correct code works once, reuse rejected', async () => {
    const r = await api.post('/api/auth/request-otp', { phone: CUST_A });
    assert.equal(r.status, 200);
    assert.match(r.body.dev_code, /^\d{6}$/);
    const wrong = await api.post('/api/auth/verify-otp', { phone: CUST_A, code: '000000' === r.body.dev_code ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    const ok = await api.post('/api/auth/verify-otp', { phone: CUST_A, code: r.body.dev_code });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token && ok.body.token.length >= 32);
    tokenA = ok.body.token;
    const reuse = await api.post('/api/auth/verify-otp', { phone: CUST_A, code: r.body.dev_code });
    assert.equal(reuse.status, 400, 'OTP must be single-use');
  });

  it('OTP request is rate limited', async () => {
    const first = await api.post('/api/auth/request-otp', { phone: '09124444444' });
    assert.equal(first.status, 200);
    const second = await api.post('/api/auth/request-otp', { phone: '09124444444' });
    assert.equal(second.status, 429);
  });

  it('OTP locks after too many wrong attempts', async () => {
    const phone = '09125555555';
    const r = await api.post('/api/auth/request-otp', { phone });
    const bad = r.body.dev_code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) {
      assert.equal((await api.post('/api/auth/verify-otp', { phone, code: bad })).status, 400);
    }
    const locked = await api.post('/api/auth/verify-otp', { phone, code: r.body.dev_code });
    assert.notEqual(locked.status, 200, 'correct code must not work after lockout');
  });

  it('/me works with token, session token is stored hashed, logout invalidates', async () => {
    const me = await api.get('/api/auth/me', { token: tokenA });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.phone, CUST_A);

    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(srv.dbFile));
    const rows = db.exec('SELECT token_hash FROM sessions')[0].values.flat();
    assert.ok(rows.length >= 1);
    assert.ok(!rows.includes(tokenA), 'plaintext token must not be stored');
    assert.ok(rows.every(h => /^[0-9a-f]{64}$/.test(h)));

    const tmp = await customerLogin(api, '09126666666');
    assert.equal((await api.post('/api/auth/logout', {}, { token: tmp })).status, 200);
    assert.equal((await api.get('/api/auth/me', { token: tmp })).status, 401);
  });

  it('protected customer APIs reject unauthenticated and bogus tokens', async () => {
    for (const [m, u] of [['get', '/api/auth/me'], ['get', '/api/addresses'], ['get', '/api/orders'], ['post', '/api/orders'], ['post', '/api/payments/mock'], ['post', '/api/discounts/validate']]) {
      const r = m === 'get' ? await api.get(u) : await api.post(u, {});
      assert.equal(r.status, 401, u);
    }
    assert.equal((await api.get('/api/auth/me', { token: 'not-a-real-token' })).status, 401);
  });

  // ---------- admin auth + authorization ----------
  it('admin login: non-admin phone rejected, owner can log in', async () => {
    assert.equal((await api.post('/api/admin/login/request-otp', { phone: CUST_A })).status, 403);
    ownerToken = await adminLogin(api, OWNER);
    const me = await api.get('/api/admin/me', { token: ownerToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.admin.role, 'owner');
  });

  it('customer token cannot access admin APIs and admin token cannot act as customer', async () => {
    assert.equal((await api.get('/api/admin/dashboard', { token: tokenA })).status, 401);
    assert.equal((await api.get('/api/admin/orders', { token: tokenA })).status, 401);
    assert.equal((await api.get('/api/admin/dashboard')).status, 401);
    assert.equal((await api.get('/api/auth/me', { token: ownerToken })).status, 401);
    assert.equal((await api.get('/api/orders', { token: ownerToken })).status, 401);
  });

  it('owner creates an admin; plain admin cannot manage admins; owner cannot delete self', async () => {
    const created = await api.post('/api/admin/users', { phone: '+98 912 333 3333', name: 'ادمین دوم' }, { token: ownerToken });
    assert.equal(created.status, 201);
    assert.equal(created.body.admin.phone, ADMIN2);
    assert.equal(created.body.admin.role, 'admin');
    adminToken2 = await adminLogin(api, ADMIN2);

    assert.equal((await api.get('/api/admin/users', { token: adminToken2 })).status, 403);
    assert.equal((await api.post('/api/admin/users', { phone: '09127777777', name: 'x' }, { token: adminToken2 })).status, 403);
    assert.equal((await api.del('/api/admin/users/1', { token: adminToken2 })).status, 403);
    assert.equal((await api.get('/api/admin/dashboard', { token: adminToken2 })).status, 200);

    const list = await api.get('/api/admin/users', { token: ownerToken });
    const ownerRow = list.body.admins.find(a => a.phone === OWNER);
    assert.equal((await api.del('/api/admin/users/' + ownerRow.id, { token: ownerToken })).status, 400);
    assert.equal((await api.post('/api/admin/users', { phone: 'bad', name: 'x' }, { token: ownerToken })).status, 400);
  });

  // ---------- admin CRUD ----------
  it('admin categories CRUD (including FK protection and validation)', async () => {
    const c = await api.post('/api/admin/categories', { name: 'تخم مرغ', sort_order: 9 }, { token: adminToken2 });
    assert.equal(c.status, 201);
    const id = c.body.category.id;
    assert.equal((await api.put('/api/admin/categories/' + id, { name: 'تخم‌مرغ و لبنیات' }, { token: adminToken2 })).body.category.name, 'تخم‌مرغ و لبنیات');
    assert.equal((await api.post('/api/admin/categories', { name: '   ' }, { token: adminToken2 })).status, 400);
    assert.equal((await api.del('/api/admin/categories/' + id, { token: adminToken2 })).status, 200);
    assert.equal((await api.del('/api/admin/categories/' + id, { token: adminToken2 })).status, 404);
  });

  it('admin products CRUD, validation, inactive hidden from customers', async () => {
    const bad = [{ name: 'x', price: -1, stock: 1 }, { name: 'x', price: 10, stock: -5 }, { price: 10, stock: 1 }, { name: 'x', price: 'abc', stock: 1 }];
    for (const b of bad) assert.equal((await api.post('/api/admin/products', b, { token: ownerToken })).status, 400);
    assert.equal((await api.post('/api/admin/products', { name: 'x', price: 10, stock: 1, category_id: 9999 }, { token: ownerToken })).status, 400, 'FK must be enforced');

    const created = await api.post('/api/admin/products', { name: 'کباب ترکی <script>alert(1)</script>', price: 250000, stock: 10, unit: 'kg', category_id: 3, description: 'تست' }, { token: ownerToken });
    assert.equal(created.status, 201);
    const id = created.body.product.id;
    assert.ok((await api.get('/api/products')).body.products.some(p => p.id === id));

    const upd = await api.put('/api/admin/products/' + id, { price: 260000, active: false }, { token: ownerToken });
    assert.equal(upd.body.product.price, 260000);
    assert.ok(!(await api.get('/api/products')).body.products.some(p => p.id === id), 'inactive hidden from customers');
    assert.equal((await api.get('/api/products/' + id)).status, 404);
    assert.ok((await api.get('/api/admin/products', { token: ownerToken })).body.products.some(p => p.id === id));

    assert.equal((await api.del('/api/admin/products/' + id, { token: ownerToken })).status, 200);
    assert.equal((await api.put('/api/admin/products/' + id, { price: 1 }, { token: ownerToken })).status, 404);
    assert.equal((await api.put('/api/admin/products/abc', { price: 1 }, { token: ownerToken })).status, 400);
  });

  // ---------- addresses ----------
  it('address create/update/delete with validation and ownership', async () => {
    tokenB = await customerLogin(api, CUST_B);
    const create = await api.post('/api/addresses', { province: 'تهران', city: 'تهران', address: 'خیابان آزادی، پلاک ۱۲', plaque: '12', unit: '3', postal_code: '1234567890', latitude: 35.7, longitude: 51.4 }, { token: tokenA });
    assert.equal(create.status, 201);
    addrA = create.body.address.id;

    assert.equal((await api.post('/api/addresses', { address: '' }, { token: tokenA })).status, 400);
    assert.equal((await api.post('/api/addresses', { address: 'x', latitude: 91, longitude: 0 }, { token: tokenA })).status, 400);
    assert.equal((await api.post('/api/addresses', { address: 'x', latitude: 0, longitude: 181 }, { token: tokenA })).status, 400);
    assert.equal((await api.put('/api/addresses/' + addrA, { latitude: -95 }, { token: tokenA })).status, 400);

    const upd = await api.put('/api/addresses/' + addrA, { address: 'خیابان انقلاب', unit: '5' }, { token: tokenA });
    assert.equal(upd.body.address.address, 'خیابان انقلاب');
    assert.equal(upd.body.address.city, 'تهران');

    // user B must not see/modify user A's address
    assert.equal((await api.get('/api/addresses', { token: tokenB })).body.addresses.length, 0);
    assert.equal((await api.put('/api/addresses/' + addrA, { address: 'hack' }, { token: tokenB })).status, 403);
    assert.equal((await api.del('/api/addresses/' + addrA, { token: tokenB })).status, 403);
    assert.equal((await api.get('/api/addresses', { token: tokenA })).body.addresses[0].address, 'خیابان انقلاب');

    const extra = await api.post('/api/addresses', { address: 'موقت' }, { token: tokenA });
    assert.equal((await api.del('/api/addresses/' + extra.body.address.id, { token: tokenA })).status, 200);
    assert.equal((await api.put('/api/addresses/abc', {}, { token: tokenA })).status, 400);
    assert.equal((await api.put('/api/addresses/99999', {}, { token: tokenA })).status, 404);
  });

  // ---------- discounts ----------
  it('admin discount CRUD and customer validation rules', async () => {
    const t = { token: ownerToken };
    assert.equal((await api.post('/api/admin/discounts', { code: 'X', type: 'bogus', value: 5 }, t)).status, 400);
    assert.equal((await api.post('/api/admin/discounts', { code: 'X', type: 'percent', value: 150 }, t)).status, 400);
    assert.equal((await api.post('/api/admin/discounts', { code: 'X', type: 'fixed', value: -5 }, t)).status, 400);

    const d = await api.post('/api/admin/discounts', { code: 'save10', type: 'percent', value: 10, min_order_amount: 100000, usage_limit: 2 }, t);
    assert.equal(d.status, 201);
    assert.equal(d.body.discount.code, 'SAVE10');
    assert.equal((await api.post('/api/admin/discounts', { code: 'SAVE10', type: 'fixed', value: 5 }, t)).status, 400, 'duplicate code');
    const dId = d.body.discount.id;

    const ta = { token: tokenA };
    const okv = await api.post('/api/discounts/validate', { code: 'save10', subtotal: 200000 }, ta);
    assert.equal(okv.status, 200);
    assert.equal(okv.body.discount_amount, 20000);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 50000 }, ta)).status, 400, 'below minimum');
    assert.equal((await api.post('/api/discounts/validate', { code: 'NOPE', subtotal: 200000 }, ta)).status, 400);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 'abc' }, ta)).status, 400);

    await api.put('/api/admin/discounts/' + dId, { active: false }, t);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 200000 }, ta)).status, 400, 'inactive');
    await api.put('/api/admin/discounts/' + dId, { active: true, ends_at: '2000-01-01T00:00:00.000Z' }, t);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 200000 }, ta)).status, 400, 'expired');
    await api.put('/api/admin/discounts/' + dId, { ends_at: null, starts_at: '2999-01-01T00:00:00.000Z' }, t);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 200000 }, ta)).status, 400, 'not started');
    await api.put('/api/admin/discounts/' + dId, { starts_at: null }, t);
    assert.equal((await api.post('/api/discounts/validate', { code: 'SAVE10', subtotal: 200000 }, ta)).status, 200);

    const fixed = await api.post('/api/admin/discounts', { code: 'FIX50', type: 'fixed', value: 50000 }, t);
    assert.equal((await api.post('/api/discounts/validate', { code: 'FIX50', subtotal: 30000 }, ta)).body.discount_amount, 30000, 'fixed discount capped at subtotal');
    assert.equal((await api.del('/api/admin/discounts/' + fixed.body.discount.id, t)).status, 200);
    assert.ok((await api.get('/api/admin/discounts', t)).body.discounts.length >= 1);
  });

  // ---------- order engine ----------
  const ORDER = () => ({ items: [{ product_id: 1, quantity: 2 }], address_id: addrA, payment_method: 'online' });
  let orderId, stockBefore;
  const stockOf = async (id) => (await api.get('/api/products/' + id)).body.product.stock;

  it('order validation: empty cart, bad quantities, foreign address, inactive/missing product', async () => {
    const ta = { token: tokenA };
    assert.equal((await api.post('/api/orders', { items: [], address_id: addrA }, ta)).status, 400);
    for (const q of [0, -1, 'abc', null, 5000]) {
      assert.equal((await api.post('/api/orders', { items: [{ product_id: 1, quantity: q }], address_id: addrA }, ta)).status, 400, 'quantity ' + q);
    }
    assert.equal((await api.post('/api/orders', { items: [{ product_id: 1, quantity: 1 }] }, ta)).status, 400, 'missing address');
    assert.equal((await api.post('/api/orders', { items: [{ product_id: 1, quantity: 1 }], address_id: addrA }, { token: tokenB })).status, 403, 'foreign address');
    assert.equal((await api.post('/api/orders', { items: [{ product_id: 9999, quantity: 1 }], address_id: addrA }, ta)).status, 400);
    assert.equal((await api.post('/api/orders', { items: [{ product_id: 'abc', quantity: 1 }], address_id: addrA }, ta)).status, 400);
  });

  it('insufficient stock is rejected and leaves stock untouched (duplicate lines merged)', async () => {
    const before = await stockOf(1);
    const r = await api.post('/api/orders', { items: [{ product_id: 1, quantity: 30 }, { product_id: 1, quantity: 30 }], address_id: addrA }, { token: tokenA });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /موجودی/);
    assert.equal(await stockOf(1), before);
  });

  it('minimum order amount is enforced', async () => {
    await api.put('/api/admin/settings/store', { min_order_amount: 5000000 }, { token: ownerToken });
    const r = await api.post('/api/orders', ORDER(), { token: tokenA });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /حداقل/);
    await api.put('/api/admin/settings/store', { min_order_amount: 0 }, { token: ownerToken });
  });

  it('closed store blocks orders; reopening allows them', async () => {
    await api.put('/api/admin/settings/store', { manual_status: true, is_open: false }, { token: ownerToken });
    assert.equal((await api.get('/api/store')).body.store.is_open, 0);
    const r = await api.post('/api/orders', ORDER(), { token: tokenA });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /بسته/);
    await api.put('/api/admin/settings/store', { manual_status: true, is_open: true }, { token: ownerToken });
    assert.equal((await api.get('/api/store')).body.store.is_open, 1);
  });

  it('places an order: server-side pricing, delivery fee, discount, stock decrease, usage recorded', async () => {
    await api.put('/api/admin/settings/delivery', { enabled: true, delivery_fee: 30000, free_delivery_min_amount: 1000000 }, { token: ownerToken });
    stockBefore = await stockOf(1);
    const price = (await api.get('/api/products/1')).body.product.price;

    const r = await api.post('/api/orders', { ...ORDER(), discount_code: 'save10', price: 1, total_amount: 1, items: [{ product_id: 1, quantity: 2, price: 1 }] }, { token: tokenA });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const o = r.body.order;
    orderId = o.id;
    assert.equal(o.subtotal, price * 2, 'client price must be ignored');
    assert.equal(o.discount_amount, Math.floor(price * 2 * 0.1));
    assert.equal(o.delivery_fee, 30000);
    assert.equal(o.total_amount, price * 2 - o.discount_amount + 30000);
    assert.equal(o.status, 'new');
    assert.equal(o.payment_status, 'pending');
    assert.equal(o.items.length, 1);
    assert.equal(o.payment.amount, o.total_amount);
    assert.equal(await stockOf(1), stockBefore - 2);

    const disc = (await api.get('/api/admin/discounts', { token: ownerToken })).body.discounts.find(d => d.code === 'SAVE10');
    assert.equal(disc.usage_count, 1);
  });

  it('free delivery applies when subtotal reaches the threshold', async () => {
    await api.put('/api/admin/settings/delivery', { free_delivery_min_amount: 100000 }, { token: ownerToken });
    const r = await api.post('/api/orders', { items: [{ product_id: 2, quantity: 1 }], address_id: addrA, payment_method: 'cod' }, { token: tokenA });
    assert.equal(r.status, 201);
    assert.equal(r.body.order.delivery_fee, 0);
    await api.post('/api/orders/' + r.body.order.id + '/cancel', {}, { token: tokenA });
  });

  it('discount usage limit is enforced at order time', async () => {
    // SAVE10 has usage_limit 2 and one use so far; a second order works, a third must fail.
    const second = await api.post('/api/orders', { ...ORDER(), discount_code: 'SAVE10' }, { token: tokenA });
    assert.equal(second.status, 201);
    const third = await api.post('/api/orders', { ...ORDER(), discount_code: 'SAVE10' }, { token: tokenA });
    assert.equal(third.status, 400);
    await api.post('/api/orders/' + second.body.order.id + '/cancel', {}, { token: tokenA });
  });

  it('mock payment: online becomes paid, COD stays pending, ownership enforced', async () => {
    assert.equal((await api.post('/api/payments/mock', { order_id: orderId }, { token: tokenB })).status, 403);
    assert.equal((await api.post('/api/payments/mock', { order_id: 999999 }, { token: tokenA })).status, 404);
    const pay = await api.post('/api/payments/mock', { order_id: orderId }, { token: tokenA });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.payment_status, 'paid');
    const detail = await api.get('/api/orders/' + orderId, { token: tokenA });
    assert.equal(detail.body.order.payment_status, 'paid');
    assert.equal(detail.body.order.payment.status, 'paid');

    const cod = await api.post('/api/orders', { items: [{ product_id: 3, quantity: 1 }], address_id: addrA, payment_method: 'cod' }, { token: tokenA });
    const codPay = await api.post('/api/payments/mock', { order_id: cod.body.order.id }, { token: tokenA });
    assert.equal(codPay.body.payment_status, 'pending');
    await api.post('/api/orders/' + cod.body.order.id + '/cancel', {}, { token: tokenA });
  });

  it('order history and detail with ownership', async () => {
    const list = await api.get('/api/orders', { token: tokenA });
    assert.ok(list.body.orders.length >= 1);
    assert.ok(list.body.orders.some(o => o.id === orderId));
    assert.equal((await api.get('/api/orders', { token: tokenB })).body.orders.length, 0);
    const detail = await api.get('/api/orders/' + orderId, { token: tokenA });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.order.items[0].product_id, 1);
    assert.equal((await api.get('/api/orders/' + orderId, { token: tokenB })).status, 403);
    assert.equal((await api.get('/api/orders/99999', { token: tokenA })).status, 404);
    assert.equal((await api.get('/api/orders/abc', { token: tokenA })).status, 400);
  });

  // ---------- order state machine ----------
  it('admin order management: details include customer and coordinates; invalid transitions rejected; full chain works', async () => {
    const t = { token: adminToken2 };
    const list = await api.get('/api/admin/orders', t);
    assert.ok(list.body.orders.some(o => o.id === orderId && o.customer_phone === CUST_A));
    const d = await api.get('/api/admin/orders/' + orderId, t);
    assert.equal(d.body.order.customer_phone, CUST_A);
    assert.equal(d.body.order.latitude, 35.7);
    assert.equal(d.body.order.longitude, 51.4);
    assert.ok(d.body.order.address_text);

    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'shipped' }, t)).status, 400, 'new -> shipped invalid');
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'delivered' }, t)).status, 400);
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'bogus' }, t)).status, 400);
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'new' }, t)).status, 400);
    for (const s of ['confirmed', 'preparing', 'shipped']) {
      const r = await api.put(`/api/admin/orders/${orderId}/status`, { status: s }, t);
      assert.equal(r.status, 200, s);
      assert.equal(r.body.order.status, s);
    }
    assert.equal((await api.post(`/api/admin/orders/${orderId}/cancel`, {}, t)).status, 400, 'shipped cannot be cancelled');
    assert.equal((await api.post(`/api/orders/${orderId}/cancel`, {}, { token: tokenA })).status, 400);
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'confirmed' }, t)).status, 400, 'no going backwards');
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'delivered' }, t)).body.order.status, 'delivered');
    assert.equal((await api.put(`/api/admin/orders/${orderId}/status`, { status: 'cancelled' }, t)).status, 400);
  });

  it('customer cancellation restores stock, cannot be repeated, ownership enforced', async () => {
    const before = await stockOf(4);
    const o = await api.post('/api/orders', { items: [{ product_id: 4, quantity: 3 }], address_id: addrA, payment_method: 'cod' }, { token: tokenA });
    assert.equal(o.status, 201);
    assert.equal(await stockOf(4), before - 3);
    assert.equal((await api.post(`/api/orders/${o.body.order.id}/cancel`, {}, { token: tokenB })).status, 403);
    const c = await api.post(`/api/orders/${o.body.order.id}/cancel`, {}, { token: tokenA });
    assert.equal(c.status, 200);
    assert.equal(c.body.order.status, 'cancelled');
    assert.equal(await stockOf(4), before, 'stock restored');
    assert.equal((await api.post(`/api/orders/${o.body.order.id}/cancel`, {}, { token: tokenA })).status, 400);
  });

  it('admin cancellation also restores stock', async () => {
    const before = await stockOf(5);
    const o = await api.post('/api/orders', { items: [{ product_id: 5, quantity: 2 }], address_id: addrA }, { token: tokenA });
    assert.equal(await stockOf(5), before - 2);
    const c = await api.post(`/api/admin/orders/${o.body.order.id}/cancel`, {}, { token: adminToken2 });
    assert.equal(c.status, 200);
    assert.equal(await stockOf(5), before);
  });

  // ---------- admin dashboard/customers/settings/logs ----------
  it('admin dashboard shows live numbers', async () => {
    const r = await api.get('/api/admin/dashboard', { token: ownerToken });
    assert.equal(r.status, 200);
    const d = r.body.dashboard;
    assert.equal(typeof d.new_orders, 'number');
    assert.ok(d.today_orders >= 1);
    assert.ok(d.today_sales > 0);
    assert.equal(typeof d.shipping_orders, 'number');
    assert.ok(Array.isArray(d.recent_orders) && d.recent_orders.length >= 1);
  });

  it('admin customers list exposes only necessary fields', async () => {
    const r = await api.get('/api/admin/customers', { token: adminToken2 });
    assert.equal(r.status, 200);
    const a = r.body.customers.find(c => c.phone === CUST_A);
    assert.ok(a && a.order_count >= 1 && a.total_spent > 0);
    assert.deepEqual(Object.keys(a).sort(), ['created_at', 'id', 'name', 'order_count', 'phone', 'total_spent']);
  });

  it('settings: store info, business hours automatic mode vs manual override', async () => {
    const t = { token: ownerToken };
    const upd = await api.put('/api/admin/settings/store', { store_name: 'مرغ‌فروشی آزمایشی', phone: '02112345678', address: 'تهران، خیابان نمونه' }, t);
    assert.equal(upd.status, 200);
    const pub = (await api.get('/api/store')).body.store;
    assert.equal(pub.store_name, 'مرغ‌فروشی آزمایشی');
    assert.equal(pub.phone, '02112345678');

    // automatic mode: close every day -> closed even though is_open flag is 1
    const closedAll = [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, open_time: null, close_time: null, closed: true }));
    assert.equal((await api.put('/api/admin/settings/business-hours', { hours: closedAll }, t)).status, 200);
    await api.put('/api/admin/settings/store', { manual_status: false, is_open: true }, t);
    assert.equal((await api.get('/api/store')).body.store.is_open, 0, 'business hours decide when manual is off');
    // manual override on -> manual flag wins
    await api.put('/api/admin/settings/store', { manual_status: true, is_open: true }, t);
    assert.equal((await api.get('/api/store')).body.store.is_open, 1, 'manual override wins');
    // open every day all day -> automatic open
    const openAll = [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, open_time: '00:00', close_time: '23:59', closed: false }));
    await api.put('/api/admin/settings/business-hours', { hours: openAll }, t);
    await api.put('/api/admin/settings/store', { manual_status: false }, t);
    assert.equal((await api.get('/api/store')).body.store.is_open, 1);

    assert.equal((await api.put('/api/admin/settings/business-hours', { hours: [{ day_of_week: 9 }] }, t)).status, 400);
    const s = await api.get('/api/admin/settings', t);
    assert.equal(s.body.business_hours.length, 7);
    assert.equal(s.body.delivery.delivery_fee, 30000);
  });

  it('admin logs record sensitive operations', async () => {
    const r = await api.get('/api/admin/logs', { token: ownerToken });
    assert.equal(r.status, 200);
    const actions = new Set(r.body.logs.map(l => l.action));
    for (const a of ['login', 'product_create', 'product_update', 'product_delete', 'category_create', 'category_update', 'category_delete', 'order_status_change', 'order_cancel', 'discount_create', 'discount_update', 'discount_delete', 'settings_update', 'admin_create']) {
      assert.ok(actions.has(a), 'missing log action: ' + a);
    }
    const created = await api.post('/api/admin/users', { phone: '09128888888', name: 'موقت' }, { token: ownerToken });
    const del = await api.del('/api/admin/users/' + created.body.admin.id, { token: ownerToken });
    assert.equal(del.status, 200);
    const again = await api.get('/api/admin/logs', { token: ownerToken });
    assert.ok(again.body.logs.some(l => l.action === 'admin_delete'));
    // a deleted admin's existing/new sessions must stop working
    assert.equal((await api.post('/api/admin/login/request-otp', { phone: '09128888888' })).status, 403);
  });

  // ---------- robustness / security ----------
  it('malformed JSON and oversized bodies return clean errors without leaking internals', async () => {
    const bad = await api.raw('POST', '/api/auth/request-otp', '{"phone": ');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.success, false);
    assert.ok(!JSON.stringify(bad.body).includes('SyntaxError'));
    assert.ok(!JSON.stringify(bad.body).includes('node_modules'));
    const big = await api.raw('POST', '/api/auth/request-otp', JSON.stringify({ phone: 'x'.repeat(200000) }));
    assert.equal(big.status, 413);
    assert.equal((await api.get('/api/does-not-exist')).status, 404);
  });

  it('SQL injection attempts do not bypass auth or alter data', async () => {
    const inj = ["' OR '1'='1", "'; DROP TABLE products; --", '" OR ""="'];
    for (const s of inj) {
      assert.equal((await api.post('/api/auth/verify-otp', { phone: s, code: s })).status, 400);
      assert.equal((await api.get('/api/auth/me', { token: s })).status, 401);
      assert.equal((await api.get('/api/admin/me', { token: s })).status, 401);
      assert.equal((await api.post('/api/discounts/validate', { code: s, subtotal: 100000 }, { token: tokenA })).status, 400);
    }
    const evil = await api.post('/api/admin/categories', { name: "x'); DROP TABLE users; --" }, { token: ownerToken });
    assert.equal(evil.status, 201);
    assert.equal(evil.body.category.name, "x'); DROP TABLE users; --");
    assert.equal((await api.get('/api/products')).status, 200);
    assert.equal((await api.get('/api/admin/customers', { token: ownerToken })).status, 200);
  });

  it('CORS does not allow arbitrary origins', async () => {
    const res = await fetch(srv.base + '/api/store', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const ok = await fetch(srv.base + '/api/store', { headers: { Origin: 'http://localhost:3000' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  });

  it('static pages are served', async () => {
    for (const p of ['/', '/admin/']) {
      const res = await fetch(srv.base + p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('content-type'), /text\/html/);
    }
  });
});

describe('OTP expiration (server with short OTP lifetime)', () => {
  let srv, api;
  before(async () => { srv = await startServer({ env: { OTP_TTL_MS: '400', OTP_RATE_LIMIT_MS: '0' } }); api = client(srv.base); });
  after(async () => { await srv.stop(); });

  it('expired OTP is rejected, and a fresh one works', async () => {
    const r = await api.post('/api/auth/request-otp', { phone: '09121010101' });
    await new Promise(res => setTimeout(res, 700));
    const late = await api.post('/api/auth/verify-otp', { phone: '09121010101', code: r.body.dev_code });
    assert.equal(late.status, 400);
    assert.match(late.body.error, /منقضی/);
    const fresh = await api.post('/api/auth/request-otp', { phone: '09121010101' });
    const ok = await api.post('/api/auth/verify-otp', { phone: '09121010101', code: fresh.body.dev_code });
    assert.equal(ok.status, 200);
  });

  it('admin OTP expires too', async () => {
    const r = await api.post('/api/admin/login/request-otp', { phone: '09945641186' });
    await new Promise(res => setTimeout(res, 700));
    const late = await api.post('/api/admin/login/verify-otp', { phone: '09945641186', code: r.body.dev_code });
    assert.equal(late.status, 400);
  });
});
