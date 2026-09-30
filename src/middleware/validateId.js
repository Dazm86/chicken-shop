// Rejects non-numeric :id path params with a clean 400 before they reach any query.
function validateId(req, res, next, value) {
  if (!/^\d{1,12}$/.test(String(value))) {
    return res.status(400).json({ success: false, error: 'شناسه نامعتبر است' });
  }
  next();
}

module.exports = { validateId };
