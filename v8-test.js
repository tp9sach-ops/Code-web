/* Kiểm thử phần dán (glue) của tủ 3D bước ① — KHÔNG kiểm được WebGL thật (sandbox không có Three.js/mạng).
 * Ca A: Three.js tải lỗi → phải tự quay về tủ 2.5D (V7), không lỗi JS.
 * Ca B: module 3D "giả" → kiểm cuộn→tiến độ, chọn bánh, phím T/C/S bán +1, phím ←/→, đổi nhóm.   Chạy: node tools/v8-test.js */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'public'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(p === '/index.html' ? fs.readFileSync(f, 'utf8').replace(/apiUrl: '[^']*'/, "apiUrl: 'http://localhost:5174/'") : fs.readFileSync(f)); }).listen(5173);
const mock = spawn('node', [path.join(__dirname, 'mock-gas.js'), '5174'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const check = (n, c, x) => { console.log((c ? '  ok - ' : '  LỖI - ') + n + (x ? ' ' + x : '')); if (!c) fails++; };
const FAKE3D = `export function mount(T,cv,H){window.__f={calls:[],H:H,items:null};const o={setItems(l){window.__f.items=l},setProgress(p){window.__f.p=p},setIndex(){},step(d){window.__f.calls.push('step'+d);const l=window.__f.items,i=l.findIndex(x=>x.k===window.V7.idx),n=l[Math.max(0,Math.min(l.length-1,i+d))];H.onFocus(n.k)},pulse(){window.__f.calls.push('pulse')},setTint(){},resize(){},dispose(){window.__f.calls.push('dispose')}};return o}`;
async function setup(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.route(/cdnjs\.cloudflare|fonts\.g|jsdelivr|unpkg/, (r) => r.abort());
  if (mode === 'fake') { await page.route('**/js/vendor/three.module.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const x=1' })); await page.route('**/js/v8-3d.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE3D })); }
  await page.goto('http://localhost:5173/'); if (mode === 'fake') await page.evaluate(() => { delete window.V8MOD; }); await page.waitForSelector('#login:not(.hide)'); await page.fill('#lUser', 'nv1'); await page.fill('#lPass', 'pass1'); await page.click('#lBtn'); await page.waitForSelector('#v-home .shift');
  await page.evaluate(() => {
    S.prices = S.prices || {}; const mk = (g, n, td) => { S.prices['SKU' + n] = 50000; return { muc: g + n, nhom: 'BANH', ten: g + ' — ' + n, items: ['SKU' + n], auto: null, src: '', tonDau: td, nhap: 0, ban: 0, xuat: 0, tang: 0, kiem: '', ghiChu: '', tdLyDo: '', show: true, open: false, bl: [] }; };
    S.cur = { ngay: S.today, ca: 'Sang', status: 'Nhap', version: 1, locked: false, exists: true, m2: true, dirty: false, rev: 0, chain: Promise.resolve(), thuchi: [], tien: {}, giamGia: '', giaiTrinh: '', khachDat: [],
      rows: [mk('BÁNH CREPE', 'Xoài', 10), mk('BÁNH CREPE', 'Dâu', 4), mk('BÁNH CREPE', 'Matcha', 8), mk('BÁNH LAVA', 'Socola', 6)] };
    S.step = 1; document.getElementById('ca').classList.add('on'); document.getElementById('ca').style.display = 'flex'; renderCa();
  });
  return { page, errs };
}
(async () => {
  await sleep(500); const browser = await chromium.launch();
  { const { page, errs } = await setup(browser, 'nolib'); // V8MOD thật có sẵn nhưng Three.js tải lỗi
    await sleep(1500);
    check('A: Three.js tải lỗi → quay về tủ 2.5D (.v7-cab)', await page.evaluate(() => !!document.querySelector('.v7-cab') && !document.getElementById('v8cv')));
    check('A: V8.ok=false, không lỗi JS', (await page.evaluate(() => V8.ok)) === false && errs.length === 0, errs.join('|')); await page.screenshot({ path: 'out/v8_fallback.png' }); await page.close(); }
  { const { page, errs } = await setup(browser, 'fake'); await sleep(800);
    check('B: có canvas 3D + khung stage + bảng +1', await page.evaluate(() => !!document.getElementById('v8cv') && !!document.getElementById('v8stage') && document.querySelectorAll('#v7panel .v7-pay button').length === 3));
    check('B: module 3D nhận đúng 3 bánh nhóm Crepe (kind=crepe)', await page.evaluate(() => __f.items && __f.items.length === 3 && __f.items[0].kind === 'crepe'));
    const g = await page.evaluate(() => ({ st: document.getElementById('v8stage').offsetHeight, wr: document.getElementById('v8wrap').offsetHeight, ch: document.getElementById('caBody').clientHeight }));
    check('B: tổng chiều cuộn ngắn (~1,9 màn, ≤ 2,2)', g.wr / g.ch > 1.7 && g.wr / g.ch < 2.2, (g.wr / g.ch).toFixed(2) + ' màn');
    check('B: lúc đóng, bảng +1 bị làm mờ (chưa mở tủ)', await page.evaluate(() => !document.getElementById('v8stage').classList.contains('open')));
    await page.evaluate(() => { const sc = document.getElementById('caBody'); sc.scrollTop = V8.top + V8.run; }); await sleep(300);
    check('B: cuộn hết đoạn → p=1, tủ mở, module nhận setProgress(1)', await page.evaluate(() => __f.p === 1 && document.getElementById('v8stage').classList.contains('open') && V8.opened));
    const before = await page.evaluate(() => S.cur.rows[V7.idx].ban);
    await page.keyboard.press('t'); await page.keyboard.press('c'); await page.keyboard.press('s'); await sleep(200);
    check('B: phím T/C/S bán +1 qua slQuick (ban tăng 3) và gọi pulse', await page.evaluate((b) => Number(S.cur.rows[V7.idx].ban) === Number(b) + 3 && __f.calls.includes('pulse'), before), 'ban=' + await page.evaluate(() => S.cur.rows[V7.idx].ban));
    check('B: tính tiền không đổi cấu trúc: curCalc chạy được', await page.evaluate(() => { try { return typeof curCalc().totals === 'object'; } catch (e) { return String(e); } }));
    await page.keyboard.press('ArrowRight'); await sleep(100);
    check('B: phím → chọn bánh kế (V7.idx = 1) và bảng +1 đổi theo', await page.evaluate(() => V7.idx === 1 && /Dâu/.test(document.getElementById('v7panel').textContent)));
    await page.evaluate(() => v7Grp(1)); await sleep(400);
    check('B: đổi nhóm → dựng lại 3D với nhóm Lava (kind=lava, 1 bánh)', await page.evaluate(() => __f.items.length === 1 && __f.items[0].kind === 'lava'));
    const bd = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); check('B: không cuộn ngang', bd <= 1, bd + 'px');
    check('B: bảng +1 và chú thích hiện giá niêm yết (50.000đ)', await page.evaluate(() => /50\.000/.test(document.getElementById('v7panel').textContent) && /50\.000/.test(document.getElementById('v8cap').textContent)));
    await page.evaluate(() => v7View('luoi')); await sleep(200); const gridOk = await page.evaluate(() => !document.getElementById('v8cv'));
    await page.evaluate(() => v7View('tu')); await sleep(500);
    check('B: sang dạng lưới rồi quay lại → 3D dựng lại được', gridOk && await page.evaluate(() => !!document.getElementById('v8cv') && V8.inst));
    await page.evaluate(() => v8Disable()); await sleep(200); await page.evaluate(() => v7View('tu')); await sleep(500);
    check('B: sau "Tắt 3D", bấm Xem dạng Tủ bánh → 3D bật lại', await page.evaluate(() => !!document.getElementById('v8cv')));
    await page.evaluate(() => goStep(2)); await sleep(300);
    check('B: sang bước ② → hủy 3D (dispose)', await page.evaluate(() => __f.calls.includes('dispose') && !document.getElementById('v8cv')));
    check('B: không lỗi JS', errs.length === 0, errs.join('|')); await page.screenshot({ path: 'out/v8_fake.png' }); await page.close(); }
  await browser.close(); mock.kill(); srv.close(); console.log(fails ? 'CÓ ' + fails + ' LỖI' : 'TẤT CẢ ĐẠT'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); mock.kill(); process.exit(2); });
