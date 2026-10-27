/* Máy chủ giả lập Apps Script cho kiểm thử cục bộ (KHÔNG triển khai).
 * Chạy:  node tools/mock-gas.js [port=5174]
 * Giống Apps Script: không hỗ trợ OPTIONS (preflight) → nếu giao diện gửi yêu cầu "không đơn giản" sẽ bị lỗi. */
const http = require('http');
const PORT = +(process.argv[2] || 5174);
const TOKEN = 'tok-test-1';
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const ok = (data) => ({ success: true, data });
const fail = (message, code) => ({ success: false, message, ...(code ? { code } : {}) });
const MAPSO = [
  ['A1', 'BANH', 'BÁNH SẦU RIÊNG — Truyền thống 12cm', 1, ['BO2001'], 'CH Test', true],
  ['A2', 'BANH', 'BÁNH SẦU RIÊNG — Truyền thống 16cm', 2, ['BO2002'], 'CH Test', true]
];
const log = [];
const H = {
  nvLogin: (u, p) => (u === 'nv1' && p === 'pass1') ? ok({ token: TOKEN, username: 'nv1', role: 'NhanVien', store: 'CH Test', readOnly: false }) : fail('Sai tài khoản hoặc mật khẩu.'),
  nvLogout: () => ok({}),
  nvBootstrap: (t) => t !== TOKEN ? fail('Phiên đăng nhập đã hết hạn.', 'EXPIRED') :
    ok({ username: 'nv1', role: 'NhanVien', readOnly: false, store: 'CH Test', stores: [], today, minNgay: today, build: 'MOCK', mapso: MAPSO, statuses: {}, days: {} }),
  nvGetCatalog: (t) => t !== TOKEN ? fail('Phiên đăng nhập đã hết hạn.', 'EXPIRED') : ok({ items: [['BO2001', 'Bánh sầu riêng truyền thống 12cm', 'Bánh', 'Bánh', 150000, ''], ['BO2002', 'Bánh sầu riêng truyền thống 16cm', 'Bánh', 'Bánh', 250000, '']] }),
  nvGetImages: () => ok({ items: [] }),
  nvGetStatuses: () => ok({ statuses: {} })
};
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(405, cors); return res.end(); }   // như Apps Script: không có preflight
  if (req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ok({ build: 'MOCK', api: 'mock' }))); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try {
      const ct = String(req.headers['content-type'] || '');
      if (!/^text\/plain/.test(ct)) throw new Error('Content-Type phải là text/plain để khỏi preflight, nhận: ' + ct);
      const r = JSON.parse(body);
      log.push(r.fn);
      out = H[r.fn] ? H[r.fn].apply(null, r.args || []) : fail('Hàm không tồn tại: ' + r.fn, 'NOFN');
    } catch (e) { out = fail('Yêu cầu không hợp lệ: ' + e.message, 'BADREQ'); }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log('mock-gas :' + PORT));
module.exports = { log };
