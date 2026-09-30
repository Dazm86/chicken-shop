const { get } = require('../db/helpers');

// Returns { ok:true, discount, amount } or { ok:false, error }
async function validateDiscount(code, subtotal, tx) {
  const runner = tx || { get };
  const discount = await runner.get('SELECT * FROM discount_codes WHERE code = ?', [code]);
  if (!discount) return { ok: false, error: 'کد تخفیف یافت نشد' };
  if (!discount.active) return { ok: false, error: 'کد تخفیف غیرفعال است' };

  const now = new Date();
  if (discount.starts_at && now < new Date(discount.starts_at)) {
    return { ok: false, error: 'کد تخفیف هنوز فعال نشده است' };
  }
  if (discount.ends_at && now > new Date(discount.ends_at)) {
    return { ok: false, error: 'کد تخفیف منقضی شده است' };
  }
  if (subtotal < discount.min_order_amount) {
    return { ok: false, error: `حداقل مبلغ سفارش برای این کد ${discount.min_order_amount} است` };
  }
  if (discount.usage_limit !== null && discount.usage_limit !== undefined && discount.usage_count >= discount.usage_limit) {
    return { ok: false, error: 'سقف استفاده از این کد تخفیف پر شده است' };
  }

  const amount = discount.type === 'percent'
    ? Math.floor((subtotal * discount.value) / 100)
    : Math.min(discount.value, subtotal);

  return { ok: true, discount, amount };
}

module.exports = { validateDiscount };
