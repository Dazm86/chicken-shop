// Normalizes common Iranian mobile phone input formats to the canonical 09XXXXXXXXX form.
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).trim().replace(/[\s-]/g, '');
  if (p.startsWith('+98')) p = '0' + p.slice(3);
  else if (p.startsWith('0098')) p = '0' + p.slice(4);
  else if (p.startsWith('98') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function isValidIranPhone(phone) {
  return typeof phone === 'string' && /^09\d{9}$/.test(phone);
}

module.exports = { normalizePhone, isValidIranPhone };
