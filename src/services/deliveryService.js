const crypto = require('crypto');

function computeDeliveryFee(deliverySettings, subtotal) {
  if (!deliverySettings || !deliverySettings.enabled) return 0;
  if (subtotal >= deliverySettings.free_delivery_min_amount) return 0;
  return deliverySettings.delivery_fee;
}

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${ts}-${rand}`;
}

module.exports = { computeDeliveryFee, generateOrderNumber };
