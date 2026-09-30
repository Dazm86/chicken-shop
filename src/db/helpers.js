const { getDb, save } = require('./database');

function lastInsertId(db) {
  const r = db.exec('SELECT last_insert_rowid() AS id');
  return r.length ? r[0].values[0][0] : null;
}

function runStmt(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function all(sql, params = []) {
  const db = await getDb();
  return runStmt(db, sql, params);
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

// Single mutation outside a transaction: run it, then persist to disk immediately.
async function run(sql, params = []) {
  const db = await getDb();
  db.run(sql, params);
  const changes = db.getRowsModified();
  const id = /^\s*insert/i.test(sql) ? lastInsertId(db) : null;
  save();
  return { changes, lastInsertId: id };
}

// Multi-statement atomic operation (e.g. placing an order): all queries inside
// fn share one BEGIN/COMMIT, roll back together on any error, and the exported
// file is only written once, after COMMIT succeeds.
async function transaction(fn) {
  const db = await getDb();
  db.run('BEGIN');
  try {
    const tx = {
      run: (sql, params = []) => {
        db.run(sql, params);
        return { changes: db.getRowsModified(), lastInsertId: /^\s*insert/i.test(sql) ? lastInsertId(db) : null };
      },
      get: (sql, params = []) => runStmt(db, sql, params)[0] || null,
      all: (sql, params = []) => runStmt(db, sql, params)
    };
    const result = await fn(tx);
    db.run('COMMIT');
    save();
    return result;
  } catch (err) {
    try { db.run('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    throw err;
  }
}

module.exports = { all, get, run, transaction };
