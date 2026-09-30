const { get } = require('../db/helpers');

// If manual override is on, the admin's manual is_open flag wins.
// Otherwise, whether the store is open is derived from today's business_hours row.
async function isStoreOpen() {
  const store = await get('SELECT * FROM store_settings WHERE id = 1');
  if (!store) return false;
  if (store.manual_status) return !!store.is_open;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday..6=Saturday
  const hours = await get('SELECT * FROM business_hours WHERE day_of_week = ?', [dayOfWeek]);
  if (!hours || hours.closed || !hours.open_time || !hours.close_time) return false;

  const hhmm = now.toTimeString().slice(0, 5);
  return hhmm >= hours.open_time && hhmm <= hours.close_time;
}

module.exports = { isStoreOpen };
