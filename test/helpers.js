const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function tempDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chicken-test-'));
  return path.join(dir, 'chicken-shop.db');
}

async function waitForHealth(base, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.status === 200) return;
    } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

// Starts a REAL server process (node src/server.js) so tests exercise the actual runtime.
async function startServer({ dbFile, env = {} } = {}) {
  const port = await freePort();
  const file = dbFile || tempDbFile();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: file,
      OWNER_PHONE: '09945641186',
      OTP_RATE_LIMIT_MS: '1500',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);
  return {
    base, port, dbFile: file, child,
    output: () => output,
    stop() {
      return new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
    }
  };
}

// Small fetch wrapper: returns { status, body }.
function client(base) {
  async function call(method, url, { token, body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (raw !== undefined) { headers['Content-Type'] = 'application/json'; payload = raw; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-json */ }
    return { status: res.status, body: json };
  }
  return {
    get: (u, o) => call('GET', u, o),
    post: (u, body, o) => call('POST', u, { ...o, body }),
    put: (u, body, o) => call('PUT', u, { ...o, body }),
    del: (u, o) => call('DELETE', u, o),
    raw: (method, u, raw, o) => call(method, u, { ...o, raw })
  };
}

async function customerLogin(api, phone) {
  const r = await api.post('/api/auth/request-otp', { phone });
  if (r.status !== 200) throw new Error('request-otp failed: ' + JSON.stringify(r.body));
  const v = await api.post('/api/auth/verify-otp', { phone, code: r.body.dev_code });
  if (v.status !== 200) throw new Error('verify-otp failed: ' + JSON.stringify(v.body));
  return v.body.token;
}

async function adminLogin(api, phone) {
  const r = await api.post('/api/admin/login/request-otp', { phone });
  if (r.status !== 200) throw new Error('admin request-otp failed: ' + JSON.stringify(r.body));
  const v = await api.post('/api/admin/login/verify-otp', { phone, code: r.body.dev_code });
  if (v.status !== 200) throw new Error('admin verify-otp failed: ' + JSON.stringify(v.body));
  return v.body.token;
}

module.exports = { startServer, client, customerLogin, adminLogin, tempDbFile, ROOT };
