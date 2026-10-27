/* Kiểm thử lớp API của Code.gs bằng cách nạp file vào sandbox có giả lập dịch vụ Apps Script.
 * Chạy:  node tools/test-gas.js */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
const store = {};
const sandbox = {
  console, Logger: { log() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ _t: t, setMimeType() { return this; } }) },
  HtmlService: { XFrameOptionsMode: { ALLOWALL: 1 }, createHtmlOutputFromFile: () => { throw new Error('Không có Index'); } },
  CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {}, getProperties: () => ({}) }) },
  Utilities: { formatDate: () => '2026-10-27 10:00:00', getUuid: () => 'uuid-1234-5678' },
  LockService: {}, SpreadsheetApp: {}, DriveApp: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const J = (o) => JSON.parse(o._t);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok -', name); };

t('doPost: hàm không có trong danh sách → NOFN', () => {
  const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn: 'setupSheets', args: [] }) } }));
  assert.strictEqual(r.success, false); assert.strictEqual(r.code, 'NOFN');
});
t('doPost: không gọi được hàm nội bộ / prototype', () => {
  ['ss_', 'safeRun_', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'API_FNS_', 'apiHandle_'].forEach((fn) => {
    const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn, args: [] }) } }));
    assert.strictEqual(r.code, 'NOFN', fn);
  });
});
t('doPost: JSON hỏng / rỗng / mảng → BADREQ', () => {
  ['{hỏng', '', '[]', 'null', '"x"'].forEach((c) => {
    const r = J(sandbox.doPost({ postData: { contents: c } }));
    assert.strictEqual(r.code, 'BADREQ', JSON.stringify(c));
  });
  assert.strictEqual(J(sandbox.doPost({})).code, 'BADREQ');
  assert.strictEqual(J(sandbox.doPost()).code, 'BADREQ');
});
t('doPost: quá nhiều tham số → BADREQ', () => {
  const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn: 'nvLogout', args: new Array(13).fill('x') }) } }));
  assert.strictEqual(r.code, 'BADREQ');
});
t('doPost: nvLogout chạy qua dispatcher', () => {
  const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn: 'nvLogout', args: ['tok'] }) } }));
  assert.strictEqual(r.success, true);
});
t('doPost: nvLogin thiếu tham số trả lỗi tiếng Việt (không ném lỗi)', () => {
  const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn: 'nvLogin', args: ['', ''] }) } }));
  assert.strictEqual(r.success, false); assert.match(r.message, /nhập đầy đủ/);
});
t('doPost: hàm ném lỗi → trả fail, không sập', () => {
  sandbox.nvLogout = () => { throw new Error('boom'); };
  const r = J(sandbox.doPost({ postData: { contents: JSON.stringify({ fn: 'nvLogout', args: [] }) } }));
  assert.strictEqual(r.success, false); assert.match(r.message, /boom/);
});
t('doGet?fn=ping → JSON có build + api', () => {
  const r = J(sandbox.doGet({ parameter: { fn: 'ping' } }));
  assert.strictEqual(r.success, true); assert.ok(r.data.build); assert.strictEqual(r.data.api, '20261027-api1');
});
t('doGet không tham số, không có Index → JSON ghi chú (không lỗi)', () => {
  const r = J(sandbox.doGet({ parameter: {} }));
  assert.strictEqual(r.success, true); assert.match(r.data.note, /Vercel/);
  assert.strictEqual(J(sandbox.doGet()).success, true);
});
t('bảng API khớp danh sách mục 3.7 của bàn giao (18 hàm), và hàm nào cũng tồn tại', () => {
  const names = run('Object.keys(API_FNS_())');
  assert.strictEqual(names.length, 18);
  names.forEach((x) => assert.strictEqual(typeof run('API_FNS_().' + x), 'function', x));
});
console.log('PASS ' + n + ' kiểm thử');
