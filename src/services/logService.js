const { run } = require('../db/helpers');

async function logAdminAction(adminUserId, action, details) {
  await run(
    `INSERT INTO admin_logs (admin_user_id, action, details) VALUES (?, ?, ?)`,
    [adminUserId || null, action, details ? JSON.stringify(details) : null]
  );
}

module.exports = { logAdminAction };
