/* Kiểm thử V9: bánh Lava 3D + 5 ô hàng tặng 3D xoay (WebGL THẬT bằng Chromium + SwiftShader).
 * Cần Three.js cục bộ:  THREE_PATH=/đường/dẫn/three.module.js node tools/v9-test.js   (mặc định: node_modules/three/build/three.module.js)
 * Ca A: Three.js có → 5 ô Tặng có canvas, vẽ ra điểm ảnh thật, ô "tự ghi" giữ chữ, bấm ô vẫn mở được; bánh Lava dựng mô hình riêng.
 * Ca B: Three.js tải lỗi → ô Tặng giữ nguyên chữ cái, không lỗi JS.   Ảnh chụp lưu ở out/ */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'public'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const THREE = process.env.THREE_PATH || path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
if (!fs.existsSync(THREE)) { console.error('Thiếu Three.js: đặt THREE_PATH=...'); process.exit(2); }
fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(p === '/index.html' ? fs.readFileSync(f, 'utf8').replace(/apiUrl: '[^']*'/, "apiUrl: 'http://localhost:5174/'") : fs.readFileSync(f)); }).listen(5173);
const mock = spawn('node', [path.join(__dirname, 'mock-gas.js'), '5174'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const check = (n, c, x) => { console.log((c ? '  ok - ' : '  LỖI - ') + n + (x ? ' ' + x : '')); if (!c) fails++; };
async function setup(browser, withThree) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }), page = await ctx.newPage(), errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.route(/cdnjs\.cloudflare|fonts\.g|jsdelivr|unpkg/, (r) => r.abort());
  if (withThree) await page.route('**/js/vendor/three.module.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(THREE) }));
  await page.goto('http://localhost:5173/'); await page.waitForSelector('#login:not(.hide)'); await page.fill('#lUser', 'nv1'); await page.fill('#lPass', 'pass1'); await page.click('#lBtn'); await page.waitForSelector('#v-home .shift');
  await page.evaluate(() => {
    S.prices = S.prices || {};
    const mk = (nhom, g, n, td) => { S.prices['SKU' + n] = 50000; return { muc: nhom + n, nhom: nhom, ten: g + ' — ' + n, items: ['SKU' + n], auto: null, src: '', tonDau: td, nhap: 0, ban: 0, xuat: 0, tang: 0, kiem: '', ghiChu: '', tdLyDo: '', show: true, open: false, bl: [] }; };
    S.cur = { ngay: S.today, ca: 'Sang', status: 'Nhap', version: 1, locked: false, exists: true, m2: true, dirty: false, rev: 0, chain: Promise.resolve(), thuchi: [], tien: {}, giamGia: '', giaiTrinh: '', khachDat: [],
      rows: [mk('BANH', 'BÁNH LAVA', 'Matcha', 6), mk('BANH', 'BÁNH LAVA', 'Sầu riêng', 5), mk('BANH', 'BÁNH CREPE', 'Xoài', 10),
        mk('HANG_TANG', 'HÀNG TẶNG', 'Sữa chua phô mai', 0), mk('HANG_TANG', 'HÀNG TẶNG', 'Panna Cotta', 0), mk('HANG_TANG', 'HÀNG TẶNG', 'Túi giữ nhiệt Lớn / Nhỏ', 0),
        mk('HANG_TANG', 'HÀNG TẶNG', 'Móc khóa', 0), mk('HANG_TANG', 'HÀNG TẶNG', 'Trái cây sấy', 0), mk('HANG_TANG', 'KHÁC', '(tự ghi 1)', 0)] };
    S.step = 2; document.getElementById('ca').classList.add('on'); document.getElementById('ca').style.display = 'flex'; renderCa();
  });
  return { page, errs };
}
(async () => {
  await sleep(500); const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  { const { page, errs } = await setup(browser, true); await sleep(5000);
    const n = await page.evaluate(() => ({ cv: document.querySelectorAll('.pt-im canvas.pt-3d').length, g3: document.querySelectorAll('.pt-im.g3').length, tiles: document.querySelectorAll('#rowList .pt').length, keys: [].map.call(document.querySelectorAll('canvas.pt-3d'), (c) => c.dataset.g).join(',') }));
    check('A: bước ② có 6 ô, đúng 5 ô có khung 3D (ô "tự ghi" không có)', n.tiles === 6 && n.cv === 5, JSON.stringify(n));
    check('A: đủ 5 sản phẩm: scpm,panna,tui,mockhoa,traicay', n.keys === 'scpm,panna,tui,mockhoa,traicay', n.keys);
    check('A: cả 5 ô đã vẽ xong (class g3, ẩn chữ cái)', n.g3 === 5);
    const px = await page.evaluate(() => [].map.call(document.querySelectorAll('canvas.pt-3d'), (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) k++; return Math.round(k / (d.length / 4) * 100); }));
    check('A: mỗi khung có hình thật (≥ 8% điểm ảnh không trong suốt)', px.every((v) => v >= 8), px.join('%, ') + '%');
    check('A: ô "tự ghi" vẫn hiện chữ cái', await page.evaluate(() => { const t = document.querySelectorAll('#rowList .pt')[5]; return !!t && !t.querySelector('canvas') && getComputedStyle(t.querySelector('.l')).display !== 'none'; }));
    const f1 = await page.evaluate(() => document.querySelector('canvas.pt-3d').toDataURL().length); await sleep(900);
    const f2 = await page.evaluate(() => document.querySelector('canvas.pt-3d').toDataURL().length);
    const sig = await page.evaluate(async () => { const c = document.querySelector('canvas.pt-3d'), a = c.toDataURL(); await new Promise((r) => setTimeout(r, 700)); return a !== c.toDataURL(); });
    check('A: sản phẩm chuyển động (khung hình đổi theo thời gian)', sig);
    await page.screenshot({ path: path.join(__dirname, '..', 'out', 'v9_tang.png') });
    await page.evaluate(() => psOpen(3)); await sleep(500);
    check('A: bấm vào ô Tặng vẫn mở khung nhập sản phẩm', await page.evaluate(() => !!document.querySelector('.ps-h')));
    check('A: ảnh đầu khung nhập cũng là 3D (đã vẽ)', await page.evaluate(() => !!document.querySelector('.ps-h .pt-im.g3 canvas')));
    await page.evaluate(() => { psUp(3); }); await sleep(400);
    check('A: bấm +/- trong khung nhập, hình 3D vẫn còn', await page.evaluate(() => !!document.querySelector('.ps-h .pt-im canvas')));
    await page.screenshot({ path: path.join(__dirname, '..', 'out', 'v9_sheet.png') });
    await page.evaluate(() => closeSheet());
    check('A: không có ô nào đè lên nhau gây cuộn ngang', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    await page.evaluate(() => goStep(1)); await sleep(500); await page.evaluate(() => { const g = v7Groups(); for (let k = 0; k < g.length; k++) if (/LAVA/i.test(g[k].name)) v7Grp(k); });
    await sleep(6000);
    const lv = await page.evaluate(() => ({ inst: !!V8.inst, ok: V8.ok, grp: V7.grp, cv: !!document.getElementById('v8cv') }));
    check('A: tủ 3D thật chạy ở nhóm Lava, không rơi về 2D', lv.inst && lv.ok === true && /LAVA/i.test(lv.grp) && lv.cv, JSON.stringify(lv));
    await page.evaluate(() => { const sc = document.getElementById('caBody'); sc.scrollTop = V8.top + V8.run; }); await sleep(2500);
    await page.screenshot({ path: path.join(__dirname, '..', 'out', 'v9_lava.png') });
    check('A: không lỗi JS', errs.length === 0, errs.join('|')); await page.close(); }
  { const { page, errs } = await setup(browser, false); await sleep(4000);
    const n = await page.evaluate(() => ({ cv: document.querySelectorAll('canvas.pt-3d').length, g3: document.querySelectorAll('.pt-im.g3').length, letters: [].filter.call(document.querySelectorAll('.pt-im .l'), (l) => getComputedStyle(l).display !== 'none').length }));
    check('B: Three.js tải lỗi → không còn khung 3D, 6 chữ cái vẫn hiện', n.cv === 0 && n.g3 === 0 && n.letters === 6, JSON.stringify(n));
    check('B: không lỗi JS', errs.length === 0, errs.join('|')); await page.screenshot({ path: path.join(__dirname, '..', 'out', 'v9_fallback.png') }); await page.close(); }
  await browser.close(); mock.kill(); srv.close(); console.log(fails ? 'CÓ ' + fails + ' LỖI' : 'TẤT CẢ ĐẠT'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); mock.kill(); process.exit(2); });
