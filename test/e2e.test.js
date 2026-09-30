const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

// End-to-end workflows over real HTTP against a real server process, in the order a person would do them.
describe('E2E: customer journey', () => {
  let srv, api;
  before(async () => { srv = await startServer(); api = client(srv.base); });
  after(async () => { await srv.stop(); });

  it('OTP -> login -> categories -> products -> address -> cart -> discount -> order -> payment -> history -> logout', async () => {
    const phone = '+98 913 555 0101';

    // owner prepares a discount (the customer can't create one)
    const ownerReq = await api.post('/api/admin/login/request-otp', { phone: '09945641186' });
    const ownerLogin = await api.post('/api/admin/login/verify-otp', { phone: '09945641186', code: ownerReq.body.dev_code });
    await api.post('/api/admin/discounts', { code: 'WELCOME', type: 'percent', value: 15, min_order_amount: 100000 }, { token: ownerLogin.body.token });

    // 1-3 OTP + login
    const otp = await api.post('/api/auth/request-otp', { phone });
    assert.equal(otp.status, 200);
    const login = await api.post('/api/auth/verify-otp', { phone, code: otp.body.dev_code });
    assert.equal(login.status, 200);
    const token = login.body.token;
    assert.equal(login.body.user.phone, '09135550101');

    // 4-6 browse
    const store = (await api.get('/api/store')).body.store;
    assert.equal(store.is_open, 1);
    const cats = (await api.get('/api/categories')).body.categories;
    const products = (await api.get('/api/products?category_id=' + cats[0].id)).body.products;
    assert.ok(products.length >= 1);
    const detail = (await api.get('/api/products/' + products[0].id)).body.product;
    assert.ok(detail.price > 0);

    // 10 address
    const addr = await api.post('/api/addresses', { province: 'اصفهان', city: 'اصفهان', address: 'چهارباغ، کوچه ۴', latitude: 32.65, longitude: 51.67 }, { token });
    assert.equal(addr.status, 201);

    // 7-9 cart (client-side) -> totals as the checkout would compute
    const cart = [{ product_id: products[0].id, quantity: 2 }, { product_id: products[1].id, quantity: 1.5 }];
    const expectedSubtotal = Math.round(products[0].price * 2) + Math.round(products[1].price * 1.5);

    // 11 discount, 12 delivery
    const dv = await api.post('/api/discounts/validate', { code: 'welcome', subtotal: expectedSubtotal }, { token });
    assert.equal(dv.status, 200);

    // 13 order
    const order = await api.post('/api/orders', { items: cart, address_id: addr.body.address.id, discount_code: 'welcome', payment_method: 'online', delivery_time: 'امروز ۱۸ تا ۲۰', notes: 'زنگ نزنید' }, { token });
    assert.equal(order.status, 201);
    assert.equal(order.body.order.subtotal, expectedSubtotal);
    assert.equal(order.body.order.discount_amount, dv.body.discount_amount);
    assert.equal(order.body.order.items.length, 2);
    assert.equal(order.body.order.items[1].quantity, 1.5);

    // 14 payment (mock)
    const pay = await api.post('/api/payments/mock', { order_id: order.body.order.id }, { token });
    assert.equal(pay.body.payment_status, 'paid');

    // 15-16 tracking + history
    const hist = await api.get('/api/orders', { token });
    assert.equal(hist.body.orders.length, 1);
    assert.equal(hist.body.orders[0].payment_status, 'paid');
    assert.equal(hist.body.orders[0].status, 'new');

    // 17 reorder = same items again (prices re-read from DB)
    const again = await api.post('/api/orders', { items: cart, address_id: addr.body.address.id, payment_method: 'cod' }, { token });
    assert.equal(again.status, 201);
    assert.equal(again.body.order.payment_method, 'cod');

    // 18 logout
    assert.equal((await api.post('/api/auth/logout', {}, { token })).status, 200);
    assert.equal((await api.get('/api/orders', { token })).status, 401);
  });
});

describe('E2E: admin journey', () => {
  let srv, api;
  before(async () => { srv = await startServer(); api = client(srv.base); });
  after(async () => { await srv.stop(); });

  it('OTP -> login -> dashboard -> products -> categories -> orders -> customers -> discounts -> settings -> logs -> logout', async () => {
    // seed a customer order so the admin has something to manage
    const cphone = '09136660202';
    const co = await api.post('/api/auth/request-otp', { phone: cphone });
    const ct = (await api.post('/api/auth/verify-otp', { phone: cphone, code: co.body.dev_code })).body.token;
    const addr = (await api.post('/api/addresses', { address: 'مشهد، امام رضا ۱۰', latitude: 36.29, longitude: 59.6 }, { token: ct })).body.address;

    const req = await api.post('/api/admin/login/request-otp', { phone: '09945641186' });
    const login = await api.post('/api/admin/login/verify-otp', { phone: '09945641186', code: req.body.dev_code });
    assert.equal(login.status, 200);
    const t = { token: login.body.token };
    assert.equal((await api.get('/api/admin/me', t)).body.admin.role, 'owner');

    const order = await api.post('/api/orders', { items: [{ product_id: 1, quantity: 1 }], address_id: addr.id }, { token: ct });
    assert.equal(order.status, 201);

    const dash = (await api.get('/api/admin/dashboard', t)).body.dashboard;
    assert.equal(dash.new_orders, 1);
    assert.equal(dash.today_orders, 1);
    assert.equal(dash.today_sales, order.body.order.total_amount);

    // products + categories
    const cat = (await api.post('/api/admin/categories', { name: 'دسته آزمایشی' }, t)).body.category;
    const prod = (await api.post('/api/admin/products', { name: 'محصول آزمایشی', price: 50000, stock: 5, category_id: cat.id }, t)).body.product;
    assert.equal((await api.put('/api/admin/products/' + prod.id, { stock: 8 }, t)).body.product.stock, 8);
    assert.ok((await api.get('/api/products?category_id=' + cat.id)).body.products.some(p => p.id === prod.id));

    // orders
    const orders = (await api.get('/api/admin/orders?status=new', t)).body.orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].customer_phone, cphone);
    assert.equal((await api.put(`/api/admin/orders/${order.body.order.id}/status`, { status: 'confirmed' }, t)).status, 200);
    assert.equal((await api.get('/api/admin/dashboard', t)).body.dashboard.new_orders, 0);

    // customers
    const customers = (await api.get('/api/admin/customers', t)).body.customers;
    assert.equal(customers.length, 1);
    assert.equal(customers[0].order_count, 1);

    // discounts + settings
    const disc = (await api.post('/api/admin/discounts', { code: 'E2E', type: 'fixed', value: 1000 }, t)).body.discount;
    assert.equal((await api.put('/api/admin/discounts/' + disc.id, { value: 2000 }, t)).body.discount.value, 2000);
    assert.equal((await api.put('/api/admin/settings/store', { manual_status: true, is_open: false }, t)).status, 200);
    assert.equal((await api.get('/api/store')).body.store.is_open, 0);
    assert.equal((await api.get('/api/admin/dashboard', t)).body.dashboard.store_open, false);
    await api.put('/api/admin/settings/store', { manual_status: true, is_open: true }, t);
    assert.equal((await api.get('/api/store')).body.store.is_open, 1);

    // logs
    const logs = (await api.get('/api/admin/logs', t)).body.logs;
    assert.ok(logs.length >= 6);
    assert.equal(logs[0].admin_phone, '09945641186');

    // logout
    assert.equal((await api.post('/api/admin/logout', {}, t)).status, 200);
    assert.equal((await api.get('/api/admin/dashboard', t)).status, 401);
  });
});
