/* Kiểm thử khói trong trình duyệt thật (Chromium): giao diện ở cổng 5173, "Apps Script" giả ở cổng 5174 (khác nguồn gốc → kiểm cả CORS).
 * Chạy:  node tools/smoke.js        (cần: playwright có sẵn) */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'public'), OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', 'tools', 'out');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  if (p === '/index.html') r.end(fs.readFileSync(f, 'utf8').replace('DIEN_URL_EXEC_O_DAY', 'http://localhost:5174/')); else fs.createReadStream(f).pipe(r);   // thay apiUrl bằng mock
}).listen(5173);
const mock = spawn('node', [path.join(__dirname, 'mock-gas.js'), '5174'], { stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (name, cond, extra) => { console.log((cond ? '  ok - ' : '  LỖI - ') + name + (extra ? ' ' + extra : '')); if (!cond) fails++; };
(async () => {
  await sleep(500);
  const browser = await chromium.launch();
  const sizes = [[320, 568], [390, 844], [768, 1024], [1280, 800]];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (q) => console.log('REQFAIL', q.url(), q.failure() && q.failure().errorText)); page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // chặn CDN (sandbox không ra mạng) để không chờ 7 giây/lần
  await page.route(/cdnjs\.cloudflare|fonts\.g|jsdelivr|unpkg/, (r) => r.abort());
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#login:not(.hide)', { timeout: 15000 });
  check('hiện màn đăng nhập khi chưa có phiên', true);
  await page.fill('#lUser', 'nv1'); await page.fill('#lPass', 'saimatkhau'); await page.click('#lBtn');
  await page.waitForFunction(() => document.getElementById('lErr').textContent.length > 0, null, { timeout: 8000 });
  const le = await page.textContent('#lErr'); check('sai mật khẩu → báo lỗi tiếng Việt từ máy chủ', /Sai tài khoản/.test(le), le);
  await page.fill('#lPass', 'pass1'); await page.click('#lBtn');
  await page.waitForSelector('#v-home .shift', { timeout: 10000 });
  check('đăng nhập đúng → trang chủ có 2 thẻ ca', (await page.$$('#v-home .shift')).length === 2);
  check('tiêu đề hiện đúng cửa hàng từ nvBootstrap', (await page.textContent('#tStore')).includes('CH Test'));
  const auth = await page.evaluate(() => localStorage.getItem('nv9s_auth_v1'));
  check('lưu phiên vào localStorage (nv9s_auth_v1)', !!auth && JSON.parse(auth).token === 'tok-test-1');
  await sleep(600);
  check('danh mục sản phẩm tải được qua nvGetCatalog', await page.evaluate(() => !!(window.S && S.catalog && S.catalog.length === 2)));
  // tải lại trang → vào thẳng không cần đăng nhập
  await page.reload(); await page.waitForSelector('#v-home .shift', { timeout: 10000 });
  check('tải lại trang vẫn giữ phiên', true);
  // phiên hết hạn → quay về đăng nhập
  await page.evaluate(() => { S.token = 'het-han'; }); await page.evaluate(() => reloadAll());
  await page.waitForSelector('#login:not(.hide)', { timeout: 8000 });
  check('token hết hạn (EXPIRED) → về màn đăng nhập', true);
  // mạng chết → không treo
  await page.route('http://localhost:5174/**', (r) => r.abort('internetdisconnected'));
  const res = await page.evaluate(() => new Promise((ok) => google.script.run.withSuccessHandler(() => ok('S')).withFailureHandler((e) => ok('F:' + e.message)).nvGetStatuses('x', 'y')));
  check('mất kết nối → withFailureHandler nhận thông báo', /^F:/.test(res), res);
  check('không có lỗi JS trên trang', errors.length === 0, errors.join(' | '));
  for (const [w, h] of sizes) { await page.setViewportSize({ width: w, height: h }); await sleep(150); const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check('không cuộn ngang ở ' + w + '×' + h, sw <= 1, 'dư ' + sw + 'px'); await page.screenshot({ path: path.join(OUT, 'login_' + w + 'x' + h + '.png') }); }
  await browser.close(); mock.kill(); srv.close();
  console.log(fails ? 'CÓ ' + fails + ' LỖI' : 'TẤT CẢ ĐẠT'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); mock.kill(); process.exit(2); });
