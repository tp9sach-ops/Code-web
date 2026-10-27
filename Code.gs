/**
 * 9 SẠCH — KẾT CA NHÂN VIÊN (Google Apps Script Web App)
 * Code.gs — [Bản API 20261027-api1: có doPost JSON cho giao diện Vercel] đăng nhập, token, tải/ghi ca, tính lại phía server, ảnh, setup sheet.
 * ============================================================================
 * - Project RIÊNG, mở cùng Spreadsheet với trang quản lý bằng openById.
 * - Mọi hàm client gọi có dạng fn(token, ...) và trả {success, data|message, code?}.
 * - Server LẤY CỬA HÀNG TỪ TOKEN, không tin Store do client gửi (trừ Admin xem thử).
 * - Mọi ghi dữ liệu đều có LockService + Version chống ghi đè.
 * - BẢN 20261024a (V4): bán theo TỪNG LẦN BÁN (SL · giá thường/sale% · TM/CK/Shopee · ship), tiền tự tính, nhắc chi ship, QL duyệt tồn đầu bị sửa.
 *     BẢN 20261015a (tối ưu tốc độ + sổ kết ca mới từ tháng 10):
 *     · Không dùng TextFinder nữa — đọc cột khóa phần ĐUÔI sheet bằng 1 lần getValues.
 *     · Ghi đè TẠI CHỖ các dòng của ca (1 lần setValues) thay vì xóa dòng rồi thêm lại.
 *     · Tải 4 ngày (8 ca) trong 1 lần gọi duy nhất khi mở trang.
 *     · Lưu nháp tự động KHÔNG còn tính lại tồn đầu / ghi nhật ký (chỉ làm khi bấm Kết ca).
 *     · Tên mục sổ theo SỔ KẾT CA CHÍNH THỨC từ 01/10/2026 (tự cập nhật Data_NV_MapSo 1 lần).
 * ============================================================================
 * BƯỚC DUY NHẤT PHẢI SỬA: điền SPREADSHEET_ID bên dưới, rồi chạy setupSheets() 1 lần.
 */

var SPREADSHEET_ID = '1Uldgf0QcU3ZT3pKxoh-L8H7qeMASr7ENLt0ykv4046M';
var TZ = 'Asia/Ho_Chi_Minh';
var APP_BUILD = '20261026a';
var BACK_DAYS_MAX = 3;                       // được kết bù tối đa 3 ngày
var TOKEN_PREFIX = 'NVTOKEN_';
var TOKEN_CACHE_SEC = 6 * 60 * 60;           // CacheService tối đa 6 giờ
var TOKEN_LIFE_MS = 12 * 60 * 60 * 1000;     // phiên 12 giờ (lưu ở PropertiesService)
var CATALOG_CACHE_KEY = 'NV_CATALOG_V2';
var CATALOG_CACHE_SEC = 2 * 60 * 60;         // danh mục sản phẩm đổi rất ít → cache 2 giờ
var TOL = 1000;                              // dung sai khớp = kcMatch_ của trang quản lý
var TAIL_ROWS = 6000;                        // chỉ quét ~6000 dòng cuối của sheet lớn (ca gần đây luôn nằm cuối)
var SO_MIGRATE_FLAG = 'NV_SO_THANG10_V2';    // cờ đã cập nhật danh mục sổ theo mẫu tháng 10

var SH = {
  KETCA: 'Data_NV_KetCa',
  TONKHO: 'Data_NV_TonKho',
  THUCHI: 'Data_NV_ThuChi',
  MAPSO: 'Data_NV_MapSo',
  TIENCA: 'Data_NV_TienCa',
  USERS: 'Users_V2',
  SANPHAM: 'Data_SanPham',
  TONKHOSKU: 'Data_TonKhoSKU',
  ANH: 'Data_KetCa_Anh',
  AUDIT: 'Data_AuditLog',
  STORE_SETTINGS: 'Store_Settings',
  KETCA_VH: 'Data_KetCa_Ca',        // sheet của WEB VẬN HÀNH — app đẩy các khoản QL đã duyệt vào đây
  SODUYET: 'Data_NV_SoDuyet',       // lưu vết MỖI LẦN duyệt sổ (Duyệt / Duyệt bổ sung)
  NOP_TIEN: 'Data_NopTien',         // sheet vận hành: tiền mặt nộp về công ty
  TAM_UNG: 'Data_TamUng',           // sheet vận hành: tạm ứng tiền mặt
  ARCH_INDEX: 'Archive_Index'       // danh mục file lưu trữ theo tháng của web vận hành
};

var SCHEMAS = {
  Data_NV_KetCa: ['Key_Id', 'Store', 'Ngay', 'Ca', 'TrangThai', 'NguoiKet', 'SubmittedAt', 'DuyetBoi', 'DuyetLuc',
    'LyDoTraLai', 'Version', 'TongHop', 'GhiChuKhachDat', 'SavedAt', 'LanDuyet', 'BoSung'],
  Data_NV_TonKho: ['Key_Id', 'Store', 'Ngay', 'Ca', 'Nhom', 'MucSo', 'TenMuc', 'ItemCodes', 'TonDau', 'Nhap',
    'BanLeShopee', 'XuatKhac', 'Tang', 'TonCuoi', 'KiemDem', 'ChenhLech', 'GhiChu', 'SavedAt', 'BanChiTiet', 'TdDuyet', 'TdDuyetBoi', 'TdGhiChuQL'],
  Data_NV_ThuChi: ['Id', 'Store', 'Ngay', 'Ca', 'Loai', 'SoTien', 'GhiChu', 'Meta', 'AnhUrl', 'TrangThaiDong',
    'SoTienQL', 'GhiChuQL', 'DaDoVaoKetCa', 'SavedAt'],
  Data_NV_MapSo: ['MucSo', 'Nhom', 'TenMuc', 'ThuTu', 'ItemCodes', 'Store', 'BatDung'],
  // TienMat = cột THÊM so với hợp đồng gốc (tiền mặt bán hàng nhân viên kê khai, ô (A) của sổ) — xem HUONG_DAN.md
  Data_NV_TienCa: ['Key_Id', 'Store', 'Ngay', 'Ca', 'TmDem', 'CkNoti', 'CkNotiShip', 'DonApp', 'DuCk', 'ThieuCk',
    'TmNopNoti', 'TienKet', 'AnhTienMat', 'AnhNoti', 'TienMat', 'SavedAt'],
  Users_V2: ['Username', 'Password', 'Role', 'Stores'],
  Data_SanPham: ['ItemCode', 'ItemName', 'LoaiHang', 'NhomHang', 'GiaBan', 'GiaVonFile', 'ThanhPhan', 'DonGiaVon', 'SavedAt'],
  Data_TonKhoSKU: ['Key_Id', 'Store', 'ItemCode', 'Ngay', 'TonDauNgay', 'NhapTrongNgay', 'TonCuoiNgay', 'SavedAt'],
  Data_KetCa_Anh: ['Id', 'Store', 'Ngay', 'Loai', 'Url', 'FileName', 'UploadedAt', 'UploadedBy'],
  Data_AuditLog: ['Id', 'Timestamp', 'User', 'Action', 'Target', 'Detail'],
  Store_Settings: ['Store_Name', 'MatBang', 'Internet', 'DaDongCua', 'NgayDongCua'],
  Data_NopTien: ['Key_Id', 'Store', 'Ngay', 'SoTien', 'GhiChu', 'NguoiNop', 'SavedAt', 'CtyLayTm'],
  Data_TamUng: ['Key_Id', 'Store', 'Ngay', 'Loai', 'SoTien', 'GhiChu', 'UngKey', 'NguoiLap', 'SavedAt'],
  Data_NV_SoDuyet: ['Id', 'Key_Id', 'Store', 'Ngay', 'Ca', 'Lan', 'Loai', 'NguoiSua', 'NguoiDuyet', 'DuyetLuc', 'LyDo', 'TongHop', 'ChiTiet', 'DayVanHanh'],
  // Sheet của WEB VẬN HÀNH (đã có sẵn; chỉ thêm 3 cột cuối nếu chưa có — KHÔNG đổi cột cũ)
  Data_KetCa_Ca: ['Key_Id', 'Store', 'Ngay', 'Ca', 'TienMat', 'CkNoti', 'Vi', 'CkCaNhanBanh', 'CkCaNhanThuKhac', 'DuCkNoti', 'ThieuCkNoti', 'TmThuKhac',
    'ChiShipSi', 'ChiShipLe', 'ChiShipTiktok', 'ChiDienNuoc', 'ChiKhac', 'LyDoChi', 'AnhUrl', 'SavedAt', 'ChiTietKhac', 'CkAcbBanhSale', 'TmBanhSale',
    'CkAcbShip', 'ChiSuaChua', 'CongTyChi', 'CkNotiShip', 'TmNopNoti', 'ChiShipLeCH', 'ChiShipSiCH', 'NvDuyetBoi', 'NvDuyetLuc', 'NvLan']
};

var TEXT_COLS = {
  Data_NV_KetCa: ['Ngay'], Data_NV_TonKho: ['Ngay'], Data_NV_ThuChi: ['Ngay'], Data_NV_SoDuyet: ['Ngay'], Data_KetCa_Ca: ['Ngay'], Data_NopTien: ['Ngay'], Data_TamUng: ['Ngay'],
  Data_NV_TienCa: ['Ngay'], Data_KetCa_Anh: ['Ngay'], Data_TonKhoSKU: ['Ngay']
};

var CA_LIST = ['Sáng', 'Tối'];
// Các loại thu/chi hợp lệ (đúng key cột của Data_KetCa_Ca — KHÔNG đổi key, trang quản lý đọc theo key này)
var LOAI_OK = {
  NopVe: 1, UngTien: 1,   // tiền mặt ra khỏi két (nộp về công ty / ứng tiền) — KHÔNG phải chi phí
  TmThuKhac: 1, CkCaNhanBanh: 1, CkCaNhanThuKhac: 1, DuCkNoti: 1, ThieuCkNoti: 1, TmBanhSale: 1, CkAcbBanhSale: 1,
  CkAcbShip: 1, ChiShipSi: 1, ChiShipLe: 1, ChiShipTiktok: 1, ChiDienNuoc: 1, ChiKhac: 1, ChiSuaChua: 1, CongTyChi: 1
};
var LOAI_CHI = { UngTien: 1, ChiShipSi: 1, ChiShipLe: 1, ChiShipTiktok: 1, ChiDienNuoc: 1, ChiKhac: 1, ChiSuaChua: 1, CongTyChi: 1 };

// ============================================================================
// 1. TIỆN ÍCH
// ============================================================================

var _ss = null;
function ss_() {
  if (_ss) return _ss;
  if (SPREADSHEET_ID && SPREADSHEET_ID !== 'DIEN_ID_SPREADSHEET_O_DAY') _ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  else _ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw new Error('Chưa điền SPREADSHEET_ID ở đầu Code.gs');
  return _ss;
}
function safeRun_(fn) {
  try { return fn(); }
  catch (err) {
    Logger.log('safeRun_ error: ' + err + '\n' + (err && err.stack || ''));
    return { success: false, message: 'Lỗi hệ thống: ' + (err && err.message ? err.message : String(err)) };
  }
}
function ok_(data) { return { success: true, data: data }; }
function fail_(message, code) { var r = { success: false, message: message }; if (code) r.code = code; return r; }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function genId_(prefix) { return (prefix || 'ID') + '_' + Utilities.getUuid().slice(0, 8); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function validNgay_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function addDays_(ngay, n) {
  var p = String(ngay).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
function minNgay_() { return addDays_(todayStr_(), -BACK_DAYS_MAX); }
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
function priceNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = parseFloat(String(v == null ? '' : v).replace(/[^\d]/g, ''));
  return isFinite(n) ? n : 0;
}
function fmt_(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function r2_(n) { return Math.round((n || 0) * 100) / 100; }
function kcMatch_(a, b) { return Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) <= TOL; }
function safeText_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (max && s.length > max) s = s.slice(0, max);
  if (/^[=+\-@]/.test(s)) s = ' ' + s;   // chống Sheets hiểu nhầm là công thức
  return s;
}
function cellStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}
function normName_(s) {
  var t = String(s || '').toLowerCase();
  try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
  return t.replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}
function hashKey_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8)); }

function getOrCreateSheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) sh = ss_().insertSheet(name);
  return sh;
}

// ---------------------------------------------------------------------------
// Bộ nhớ đệm TRONG 1 LẦN CHẠY (mỗi google.script.run là 1 lần chạy mới) — giảm số lần gọi API Sheets
// ---------------------------------------------------------------------------
var _hdr = {}, _sh = {}, _flag = null, _lr = {}, _col = {};
function schemaFlagKey_() { return 'NV_SCHEMA_OK_' + APP_BUILD; }
function schemaOk_() {
  if (_flag === null) _flag = !!CacheService.getScriptCache().get(schemaFlagKey_());
  return _flag;
}
function ensureAllSchemas_() {
  Object.keys(SCHEMAS).forEach(function (name) { ensureSchema_(getOrCreateSheet_(name), SCHEMAS[name]); });
  CacheService.getScriptCache().put(schemaFlagKey_(), '1', 6 * 60 * 60); _flag = true;
}
function hdrCacheKey_(nm) { return 'NV_H_' + APP_BUILD + '_' + hashKey_(nm); }
function ensureSchema_(sh, schema) {
  delete _hdr[sh.getName()];
  try { CacheService.getScriptCache().remove(hdrCacheKey_(sh.getName())); } catch (e) {}
  if (!schema) return;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  if (header.join('') === '') { sh.getRange(1, 1, 1, schema.length).setValues([schema]); return; }
  var missing = schema.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
}
/** Tiêu đề cột: đọc 1 lần rồi cache 1 giờ (tự đọc lại nếu thiếu cột trong schema). */
function hdr_(sh) {
  var nm = sh.getName();
  if (_hdr[nm]) return _hdr[nm];
  var cache = CacheService.getScriptCache(), ck = hdrCacheKey_(nm), names = null, hit = cache.get(ck), schema = SCHEMAS[nm];
  if (hit) { try { names = JSON.parse(hit); } catch (e) { names = null; } }
  if (names && schema && schema.some(function (c) { return names.indexOf(c) === -1; })) names = null;
  if (!names) {
    var lastCol = sh.getLastColumn();
    names = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); }) : [];
    try { cache.put(ck, JSON.stringify(names), 3600); } catch (e) {}
  }
  var map = {};
  names.forEach(function (n, i) { if (n) map[n] = i + 1; });
  _hdr[nm] = { names: names, map: map };
  return _hdr[nm];
}
function getHeaderMap_(sh) { return hdr_(sh).map; }
function sheetReady_(name) {
  if (_sh[name]) return _sh[name];
  var sh = getOrCreateSheet_(name);
  if (!schemaOk_()) ensureSchema_(sh, SCHEMAS[name]);
  _sh[name] = sh;
  return sh;
}
function lastRow_(sh) {
  var n = sh.getName();
  if (_lr[n] == null) _lr[n] = sh.getLastRow();
  return _lr[n];
}
/** Gọi sau mỗi lần ghi làm thay đổi số dòng / vị trí dòng. */
function dirty_(name) {
  delete _lr[name];
  Object.keys(_col).forEach(function (k) { if (k.indexOf(name + '|') === 0) delete _col[k]; });
}

function logAudit_(user, action, target, detail) {
  try {
    var sh = sheetReady_(SH.AUDIT);
    sh.appendRow([genId_('LOG'), nowStr_(), user, action, target, detail]);
  } catch (e) { Logger.log('audit fail: ' + e); }
}

// ---------------------------------------------------------------------------
// Tìm dòng theo khóa — thay TextFinder bằng 1 lần getValues cột khóa (phần đuôi sheet)
// ---------------------------------------------------------------------------
/** {start, keys[], partial}: giá trị cột colName từ dòng `start` đến cuối. full=true → đọc toàn cột. */
function keyCol_(sh, colName, full) {
  var nm = sh.getName(), ck = nm + '|' + colName + (full ? '|F' : '');
  if (_col[ck]) return _col[ck];
  var col = getHeaderMap_(sh)[colName], last = lastRow_(sh), out = { start: 2, keys: [], partial: false };
  if (col && last >= 2) {
    var start = full ? 2 : Math.max(2, last - TAIL_ROWS + 1);
    out.start = start; out.partial = start > 2;
    out.keys = sh.getRange(start, col, last - start + 1, 1).getValues().map(function (r) { return cellStr_(r[0]); });
  }
  _col[ck] = out;
  return out;
}
/** Các dòng có ô cột colName BẮT ĐẦU bằng prefix. expect=true: nếu không thấy trong phần đuôi thì quét toàn sheet. */
function rowsByPrefix_(sh, colName, prefix, expect) {
  function scan(kc) {
    var rows = [];
    for (var i = 0; i < kc.keys.length; i++) if (kc.keys[i].indexOf(prefix) === 0) rows.push(kc.start + i);
    return rows;
  }
  var kc = keyCol_(sh, colName, false), rows = scan(kc);
  if (!rows.length && expect && kc.partial) rows = scan(keyCol_(sh, colName, true));
  return rows;
}
function exactRow_(sh, colName, key) {
  var kc = keyCol_(sh, colName, true);
  for (var i = 0; i < kc.keys.length; i++) if (kc.keys[i] === key) return kc.start + i;
  return 0;
}
function runsOf_(rows) {
  var runs = [];
  rows.forEach(function (r) {
    var l = runs[runs.length - 1];
    if (l && r === l.start + l.len) l.len++; else runs.push({ start: r, len: 1 });
  });
  return runs;
}
/** Đọc các dòng thành object. Nhiều đoạn rời nhau nhưng nằm gần → đọc 1 lần cả khoảng cho nhanh. */
function readRowObjs_(sh, rows) {
  if (!rows.length) return [];
  var header = hdr_(sh).names, width = Math.max(header.length, 1), out = [];
  function push(rowNo, vals) {
    var o = { _row: rowNo };
    header.forEach(function (h, c) { if (h) o[h] = vals[c]; });
    out.push(o);
  }
  var runs = runsOf_(rows), first = rows[0], span = rows[rows.length - 1] - first + 1;
  if (runs.length > 3 && span <= 3000) {
    var all = sh.getRange(first, 1, span, width).getValues();
    rows.forEach(function (r) { push(r, all[r - first]); });
  } else {
    runs.forEach(function (run) {
      sh.getRange(run.start, 1, run.len, width).getValues().forEach(function (vals, i) { push(run.start + i, vals); });
    });
  }
  return out;
}
function deleteRows_(sh, rows) {
  if (!rows.length) return;
  runsOf_(rows).reverse().forEach(function (run) { sh.deleteRows(run.start, run.len); });
  dirty_(sh.getName());
}
function hasExtraCols_(name, sh) {
  var schema = SCHEMAS[name];
  return hdr_(sh).names.some(function (n) { return n && schema.indexOf(n) === -1; });
}
function objToRow_(name, o, map, width, base) {
  var row = base ? base.slice() : new Array(width).fill('');
  SCHEMAS[name].forEach(function (c) { var ci = map[c]; if (ci && o.hasOwnProperty(c)) row[ci - 1] = o[c]; });
  return row;
}
function appendRowsRaw_(name, sh, map, width, data) {
  if (!data.length) return;
  var start = lastRow_(sh) + 1, endRow = start + data.length - 1;
  if (endRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), endRow - sh.getMaxRows() + 100);
  (TEXT_COLS[name] || []).forEach(function (c) { if (map[c]) sh.getRange(start, map[c], data.length, 1).setNumberFormat('@'); });
  sh.getRange(start, 1, data.length, width).setValues(data);
  dirty_(name);
}
/**
 * Thay TOÀN BỘ các dòng của 1 ca bằng `objs`:
 *   - ghi đè TẠI CHỖ lên các dòng cũ (1 lần setValues cho mỗi đoạn liền nhau),
 *   - thiếu thì thêm cuối sheet, thừa thì xóa. Hầu hết lần lưu chỉ tốn 1 lệnh ghi.
 */
function replaceRows_(name, oldRows, objs) {
  var sh = sheetReady_(name), h = hdr_(sh), map = h.map, width = Math.max(h.names.length, SCHEMAS[name].length);
  var reuse = Math.min(oldRows.length, objs.length), extra = hasExtraCols_(name, sh);
  var reused = oldRows.slice(0, reuse), at = 0;
  runsOf_(reused).forEach(function (run) {
    var base = extra ? sh.getRange(run.start, 1, run.len, width).getValues() : null;
    var block = [];
    for (var i = 0; i < run.len; i++) block.push(objToRow_(name, objs[at + i], map, width, base ? base[i] : null));
    sh.getRange(run.start, 1, run.len, width).setValues(block);
    at += run.len;
  });
  var more = [];
  for (var j = reuse; j < objs.length; j++) more.push(objToRow_(name, objs[j], map, width, null));
  appendRowsRaw_(name, sh, map, width, more);
  if (oldRows.length > reuse) deleteRows_(sh, oldRows.slice(reuse));
}
/** Cập nhật/thêm 1 dòng theo khóa chính xác (dùng cho sheet nhỏ: Data_NV_KetCa, Data_NV_TienCa). */
function upsertRow_(name, keyCol, key, obj, knownRow) {
  var sh = sheetReady_(name), h = hdr_(sh), map = h.map, width = Math.max(h.names.length, SCHEMAS[name].length);
  var row = knownRow || exactRow_(sh, keyCol, key);
  if (row) {
    var base = hasExtraCols_(name, sh) ? sh.getRange(row, 1, 1, width).getValues()[0] : null;
    sh.getRange(row, 1, 1, width).setValues([objToRow_(name, obj, map, width, base)]);
  } else {
    appendRowsRaw_(name, sh, map, width, [objToRow_(name, obj, map, width, null)]);
  }
}

// --- Cache lớn (CacheService giới hạn ~100KB/khóa) ---
function cachePutBig_(key, str, sec) {
  var c = CacheService.getScriptCache(), size = 30000, n = Math.ceil(str.length / size), obj = {};
  for (var i = 0; i < n; i++) obj[key + '_' + i] = str.substr(i * size, size);
  obj[key + '_n'] = String(n);
  c.putAll(obj, sec);
}
function cacheGetBig_(key) {
  var c = CacheService.getScriptCache(), n = parseInt(c.get(key + '_n') || '0', 10);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), out = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; out += got[keys[j]]; }
  return out;
}

// ============================================================================
// 2. WEB APP + ĐĂNG NHẬP + TOKEN
// ============================================================================

// ----------------------------------------------------------------------------
// 2a. API JSON cho giao diện chạy trên Vercel (thêm ở bản API 20261027-api1)
//     Giao diện gọi:  POST <URL /exec>  với Content-Type: text/plain  và thân JSON
//                     {"fn":"nvLogin","args":["user","pass"]}
//     Trả về đúng như cũ: {success, data|message, code?}.  Dữ liệu vẫn nằm ở Google Sheets.
//     Chỉ các hàm trong API_FNS_ được gọi từ ngoài; hàm nội bộ (tên có "_" cuối, setupSheets...) KHÔNG gọi được.
// ----------------------------------------------------------------------------
var API_BUILD = '20261027-api1';
var API_MAX_ARGS = 12;

function API_FNS_() {
  return {
    nvLogin: nvLogin, nvLogout: nvLogout, nvBootstrap: nvBootstrap, nvGetStatuses: nvGetStatuses,
    nvGetDay: nvGetDay, nvGetCatalog: nvGetCatalog, nvSaveCa: nvSaveCa, nvDeleteCa: nvDeleteCa,
    nvUploadAnh: nvUploadAnh, nvGetImages: nvGetImages,
    nvQlPending: nvQlPending, nvQlLine: nvQlLine, nvQlTonDau: nvQlTonDau, nvQlDuyetCa: nvQlDuyetCa,
    nvQlTraLai: nvQlTraLai, nvQlMoLaiCa: nvQlMoLaiCa, nvSoLichSu: nvSoLichSu, nvLuuSo: nvLuuSo
  };
}
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
/** Xử lý 1 yêu cầu API đã giải mã. Tách riêng để kiểm thử được ngoài Apps Script. */
function apiHandle_(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return fail_('Yêu cầu không hợp lệ.', 'BADREQ');
  var fn = String(req.fn || ''), table = API_FNS_();
  if (!Object.prototype.hasOwnProperty.call(table, fn)) return fail_('Hàm không tồn tại: ' + fn.slice(0, 40), 'NOFN');
  var args = Array.isArray(req.args) ? req.args : [];
  if (args.length > API_MAX_ARGS) return fail_('Quá nhiều tham số.', 'BADREQ');
  try {
    var r = table[fn].apply(null, args);
    return r || fail_('Máy chủ không phản hồi.');
  } catch (err) {
    Logger.log('apiHandle_ ' + fn + ': ' + err + '\n' + (err && err.stack || ''));
    return fail_('Lỗi hệ thống: ' + (err && err.message ? err.message : String(err)));
  }
}
function doPost(e) {
  var raw = '';
  try { raw = (e && e.postData && e.postData.contents) || ''; } catch (err) {}
  return jsonOut_(apiHandle_(parseJson_(raw, null)));
}
/** GET ?fn=ping → kiểm tra máy chủ sống + làm nóng (giảm độ trễ lần gọi đầu).
 *  GET không tham số → vẫn phục vụ giao diện cũ (Index.html) nếu còn trong dự án Apps Script (đường lui). */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.fn === 'ping' || p.api) return jsonOut_(ok_({ build: APP_BUILD, api: API_BUILD, time: nowStr_() }));
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('9 Sạch — Kết ca nhân viên')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return jsonOut_(ok_({ build: APP_BUILD, api: API_BUILD, note: 'API sẵn sàng. Giao diện chạy ở Vercel.' }));
  }
}

function oneStore_(stores) {
  var s = String(stores || '').trim();
  if (!s || s === '*' || s.indexOf(',') !== -1) return '';
  return s;
}

function nvLogin(username, password) {
  return safeRun_(function () {
    username = String(username || '').trim(); password = String(password || '').trim();
    if (!username || !password) return fail_('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
    var cache = CacheService.getScriptCache(), failKey = 'NVFAIL_' + username.toLowerCase();
    if (parseInt(cache.get(failKey) || '0', 10) >= 10) return fail_('Đăng nhập sai quá nhiều lần. Thử lại sau 10 phút.');

    var sh = sheetReady_(SH.USERS), values = sh.getDataRange().getValues(), header = values[0].map(String);
    var iU = header.indexOf('Username'), iP = header.indexOf('Password'), iR = header.indexOf('Role'), iS = header.indexOf('Stores');
    var account = null;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][iU]).trim() === username && String(values[i][iP]).trim() === password) {
        account = { username: username, role: String(values[i][iR]).trim(), stores: String(values[i][iS]).trim() };
        break;
      }
    }
    if (!account) {
      cache.put(failKey, String(parseInt(cache.get(failKey) || '0', 10) + 1), 600);
      return fail_('Sai tài khoản hoặc mật khẩu.');
    }
    if (account.role !== 'NhanVien' && account.role !== 'Admin' && account.role !== 'QuanLy') return fail_('Tài khoản này không có quyền dùng web Kết ca nhân viên.');
    if (account.role === 'NhanVien' && !oneStore_(account.stores)) return fail_('Tài khoản chưa được gán đúng 1 cửa hàng. Báo quản lý kiểm tra cột Stores.');
    cache.remove(failKey);

    var token = Utilities.getUuid();
    cache.put(TOKEN_PREFIX + token, JSON.stringify(account), TOKEN_CACHE_SEC);
    try {
      var props = PropertiesService.getScriptProperties();
      props.setProperty(TOKEN_PREFIX + token, JSON.stringify({ account: account, exp: Date.now() + TOKEN_LIFE_MS }));
      cleanupTokens_(props);
    } catch (e) { Logger.log('save long token fail: ' + e); }
    logAudit_(username, 'NV_LOGIN', account.role, '');
    return ok_({ token: token, username: username, role: account.role, store: account.role === 'QuanLy' ? '' : oneStore_(account.stores), readOnly: account.role === 'Admin' || account.role === 'QuanLy' });
  });
}
function cleanupTokens_(props) {
  var all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(TOKEN_PREFIX) !== 0) return;
    try { var r = JSON.parse(all[k]); if (!r.exp || r.exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}
function getAccountByToken_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache(), raw = cache.get(TOKEN_PREFIX + token);
  if (raw) return JSON.parse(raw);
  try {
    var raw2 = PropertiesService.getScriptProperties().getProperty(TOKEN_PREFIX + token);
    if (!raw2) return null;
    var rec = JSON.parse(raw2);
    if (!rec.exp || rec.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty(TOKEN_PREFIX + token); return null; }
    cache.put(TOKEN_PREFIX + token, JSON.stringify(rec.account), TOKEN_CACHE_SEC);
    return rec.account;
  } catch (e) { return null; }
}
function nvLogout(token) {
  return safeRun_(function () {
    if (token) {
      CacheService.getScriptCache().remove(TOKEN_PREFIX + token);
      try { PropertiesService.getScriptProperties().deleteProperty(TOKEN_PREFIX + token); } catch (e) {}
    }
    return ok_({});
  });
}
/** Xác định cửa hàng thao tác. NhanVien: LẤY TỪ TOKEN. Admin: chỉ xem (không ghi). */
function ctx_(token, store, write) {
  var acc = getAccountByToken_(token);
  if (!acc) return { err: fail_('Phiên đăng nhập đã hết hạn. Bản nháp vẫn được giữ trên máy.', 'EXPIRED') };
  if (acc.role === 'Admin') {
    if (write) return { err: fail_('Tài khoản Admin chỉ được xem, không ghi dữ liệu kết ca.', 'READONLY') };
    var st = String(store || '').trim();
    if (!st) return { err: fail_('Hãy chọn cửa hàng để xem.') };
    return { account: acc, store: st, readOnly: true };
  }
  if (acc.role === 'QuanLy') {
    if (write) return { err: fail_('Tài khoản Quản lý không kết ca — chỉ duyệt.', 'READONLY') };
    var ms = mgrStores_(acc), qs = String(store || '').trim() || (ms.length === 1 ? ms[0] : '');
    if (!qs) return { err: fail_('Hãy chọn cửa hàng.') };
    if (ms.indexOf(qs) === -1) return { err: fail_('Bạn không quản lý cửa hàng này.') };
    return { account: acc, store: qs, readOnly: true };
  }
  if (acc.role === 'NhanVien') {
    var s = oneStore_(acc.stores);
    if (!s) return { err: fail_('Tài khoản chưa gán đúng 1 cửa hàng.') };
    return { account: acc, store: s, readOnly: false };
  }
  return { err: fail_('Tài khoản không có quyền.') };
}
function checkNgayCa_(ngay, ca, write) {
  if (!validNgay_(ngay)) return fail_('Ngày không hợp lệ.');
  if (ca !== null && CA_LIST.indexOf(ca) === -1) return fail_('Ca chỉ nhận "Sáng" hoặc "Tối".');
  if (write) {
    if (ngay > todayStr_()) return fail_('Không được kết ca cho ngày tương lai.');
    if (ngay < minNgay_()) return fail_('Chỉ được kết bù tối đa ' + BACK_DAYS_MAX + ' ngày. Liên hệ quản lý để nhập giúp.');
  }
  return null;
}

// ============================================================================
// 3. DANH MỤC, ÁNH XẠ SỔ, TỒN ĐẦU
// ============================================================================

function loadCatalog_() {
  var cached = cacheGetBig_(CATALOG_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  var sh = sheetReady_(SH.SANPHAM), values = sh.getDataRange().getValues(), out = [];
  if (values.length > 1) {
    var h = values[0].map(function (x) { return String(x).trim(); });
    var iC = h.indexOf('ItemCode'), iN = h.indexOf('ItemName'), iL = h.indexOf('LoaiHang'), iG = h.indexOf('NhomHang'), iP = h.indexOf('GiaBan'), iT = h.indexOf('ThanhPhan');
    for (var i = 1; i < values.length; i++) {
      var code = String(values[i][iC] || '').trim(); if (!code) continue;
      out.push([code, String(values[i][iN] || ''), String(values[i][iL] || ''), String(values[i][iG] || ''), priceNum_(values[i][iP]), iT >= 0 ? String(values[i][iT] || '') : '']);
    }
  }
  try { cachePutBig_(CATALOG_CACHE_KEY, JSON.stringify(out), CATALOG_CACHE_SEC); } catch (e) { Logger.log('cache catalog fail ' + e); }
  return out;
}
function priceMap_() {
  var m = {}; loadCatalog_().forEach(function (r) { m[r[0]] = r[4]; }); return m;
}
function nvGetCatalog(token) {
  return safeRun_(function () {
    var c = ctx_(token, 'x', false); if (c.err) return c.err;
    return ok_({ items: loadCatalog_() });   // [ItemCode, ItemName, LoaiHang, NhomHang, GiaBan]
  });
}
function isOn_(v) {
  if (v === false || v === 0) return false;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'n' || s === 'no' || s === 'x' || s === 'không' || s === 'khong');
}
function parseCodes_(v) {
  if (Array.isArray(v)) return v;
  var s = String(v || '').trim(); if (!s) return [];
  try { var a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return s.split(/[,;|]/).map(function (x) { return x.trim(); }).filter(Boolean); }
}
function readMapSo_(store) {
  var key = 'NV_MAPSO_' + hashKey_(store), cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var rows = readMapSoRaw_(store);
  try { cache.put(key, JSON.stringify(rows), 120); } catch (e) {}
  return rows;
}
function readMapSoRaw_(store) {
  var sh = sheetReady_(SH.MAPSO), values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var h = values[0].map(function (x) { return String(x).trim(); });
  var ix = {}; h.forEach(function (n, i) { ix[n] = i; });
  var byMuc = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i], muc = String(r[ix.MucSo] || '').trim(); if (!muc) continue;
    var st = String(r[ix.Store] || '*').trim() || '*';
    if (st !== '*' && st !== store) continue;
    if (!isOn_(r[ix.BatDung])) { if (st === store) delete byMuc[muc]; continue; }
    var rec = { muc: muc, nhom: String(r[ix.Nhom] || 'BANH').trim(), ten: String(r[ix.TenMuc] || muc), thuTu: num_(r[ix.ThuTu]) || 9999, items: parseCodes_(r[ix.ItemCodes]), store: st };
    if (!byMuc[muc] || st === store) byMuc[muc] = rec;   // dòng riêng cửa hàng đè dòng '*'
  }
  return Object.keys(byMuc).map(function (k) { return byMuc[k]; }).sort(function (a, b) { return a.thuTu - b.thuTu; });
}

function prevCa_(ngay, ca) { return (ca === 'Sáng') ? { ngay: addDays_(ngay, -1), ca: 'Tối' } : { ngay: ngay, ca: 'Sáng' }; }
function prefixOf_(store, ngay, ca) { return store + '|' + ngay + '|' + ca + '|'; }
function segPrefix_(key) {
  var p = key.split('|'); if (p.length < 4) return '';
  return p[0] + '|' + p[1] + '|' + p[2] + '|';
}

/** Tồn kho SKU của 1 ngày (dự phòng cho tồn đầu ca Sáng khi chưa có sổ NV hôm trước). */
function skuOfNgay_(store, ngay) {
  var sh = sheetReady_(SH.TONKHOSKU), kc = keyCol_(sh, 'Ngay', false), rows = [];
  for (var i = 0; i < kc.keys.length; i++) if (kc.keys[i] === ngay) rows.push(kc.start + i);
  var sku = {};
  readRowObjs_(sh, rows).forEach(function (o) {
    if (String(o.Store) === store && cellStr_(o.Ngay) === ngay) sku[String(o.ItemCode)] = num_(o.TonCuoiNgay);
  });
  return sku;
}
/** Tồn đầu tự điền = tồn cuối ca liền trước (ưu tiên Data_NV_TonKho, không có thì Data_TonKhoSKU). prevObjs = dòng Data_NV_TonKho của ca trước. */
function openingFrom_(store, ngay, ca, mapRows, prevObjs) {
  var prev = prevCa_(ngay, ca), out = {}, extras = [], mapSet = {};
  mapRows.forEach(function (m) { mapSet[m.muc] = 1; });
  prevObjs.forEach(function (o) {
    out[o.MucSo] = { ton: num_(o.TonCuoi), src: 'NV' };
    if (!mapSet[o.MucSo] && num_(o.TonCuoi) > 0) {
      extras.push({ muc: String(o.MucSo), nhom: String(o.Nhom || 'BANH'), ten: String(o.TenMuc || o.MucSo), items: parseCodes_(o.ItemCodes), ton: num_(o.TonCuoi) });
    }
  });
  if (!prevObjs.length && ca === 'Sáng') {
    var sku = skuOfNgay_(store, prev.ngay);
    mapRows.forEach(function (m) {
      var has = false, sum = 0;
      m.items.forEach(function (c) { if (sku.hasOwnProperty(c)) { has = true; sum += sku[c]; } });
      if (has) out[m.muc] = { ton: sum, src: 'KIOT' };
    });
  }
  return { open: out, extras: extras };
}

// ============================================================================
// 4. TÍNH TOÁN (phải khớp hàm calcDoc ở Index.html)
// ============================================================================

function shipStats_(lines) {
  var r = { acb: 0, expSi: 0, expLe: 0, revLe: 0, companyLe: 0 };
  lines.forEach(function (l) {
    var m = l.meta || {}, amt = num_(l.so);
    var loai = m.loai === 'si' ? 'si' : 'le', payer = m.payer === 'congty' ? 'congty' : 'khach';
    var timing = (m.timing === 'datTruoc' || m.timing === 'traTruoc') ? m.timing : 'thuong';
    var acbIn = payer === 'khach' && timing !== 'traTruoc', chiNow = timing !== 'datTruoc';
    if (acbIn) r.acb += amt;
    if (chiNow) { if (loai === 'si') r.expSi += amt; else r.expLe += amt; }
    if (acbIn && loai === 'le') r.revLe += amt;
    if (chiNow && loai === 'le' && payer === 'congty') r.companyLe += amt;
  });
  return r;
}
function rowPrice_(items, pm) {
  for (var i = 0; i < items.length; i++) if (pm[items[i]] > 0) return pm[items[i]];
  return 0;
}

/** V4 — Gộp các LẦN BÁN (r.bl) của mọi mặt hàng. PHẢI KHỚP aggLines ở Index.html.
 *  l = {id,q,kind:'thuong'|'sale',pct,pay:'TM'|'CK'|'SP',gia,ship,shipPay:'TM'|'CK',shipLoai:'le'|'si',kh} */
function aggLines_(rows, pm) {
  var A = { has: false, qty: 0, gross: 0, disc: 0, tm: 0, ck: 0, sp: 0, shipTm: 0, shipCk: 0, shipCkLe: 0, shipSi: 0, shipLe: 0, items: [], unpriced: [], linedMuc: {} };
  rows.forEach(function (r) {
    (r.bl || []).forEach(function (l) {
      var q = num_(l.q); if (!(q > 0)) return;
      A.has = true; A.linedMuc[r.muc] = 1;
      var unit = num_(l.gia) > 0 ? num_(l.gia) : rowPrice_(r.items || [], pm), tot = num_(l.tot);
      if (!(unit > 0) && !(tot > 0) && A.unpriced.indexOf(r.ten) === -1) A.unpriced.push(r.ten);
      var gross = tot > 0 ? Math.round(tot) : Math.round(q * unit);   // tot = số tiền chốt sẵn (phần của combo)
      var pct = Math.min(100, Math.max(0, num_(l.pct)));
      var disc = l.kind === 'sale' ? Math.round(gross * pct / 100) : 0, net = gross - disc;
      A.qty += q; A.gross += gross; A.disc += disc;
      if (l.pay === 'CK') A.ck += net; else if (l.pay === 'SP') A.sp += net; else A.tm += net;
      var f = num_(l.ship);
      if (f > 0) {
        var si = l.shipLoai === 'si';
        if (l.shipPay === 'CK') { A.shipCk += f; if (!si) A.shipCkLe += f; } else A.shipTm += f;
        if (si) A.shipSi += f; else A.shipLe += f;
        A.items.push({ id: String(l.id), fee: f, pay: l.shipPay === 'CK' ? 'CK' : 'TM', loai: si ? 'si' : 'le', ten: r.ten, q: q, kh: String(l.kh || '') });
      }
    });
  });
  return A;
}
/** Mã các đơn ship chưa có khoản chi tương ứng (meta.ref). */
function shipDue_(A, thuchi) {
  var done = {};
  thuchi.forEach(function (l) { if ((l.loai === 'ChiShipSi' || l.loai === 'ChiShipLe') && l.meta && l.meta.ref) done[l.meta.ref] = 1; });
  return A.items.filter(function (x) { return !done[x.id]; });
}
function calcDoc_(doc, pm) {
  var T = doc.tien, S = {};
  Object.keys(LOAI_OK).forEach(function (k) { S[k] = 0; });
  doc.thuchi.forEach(function (l) { S[l.loai] += num_(l.so); });
  var rows = doc.rows.map(function (r) {
    var tonCuoi = r.nhom === 'HANG_TANG'
      ? num_(r.tonDau) + num_(r.nhap) - num_(r.tang) - num_(r.ban)
      : num_(r.tonDau) + num_(r.nhap) - num_(r.ban) - num_(r.xuat);
    tonCuoi = r2_(tonCuoi);
    var hasK = r.kiem !== '' && r.kiem !== null && r.kiem !== undefined;
    var price = rowPrice_(r.items, pm);
    return { muc: r.muc, ten: r.ten, nhom: r.nhom, tonCuoi: tonCuoi, hasKiem: hasK, chenh: hasK ? r2_(num_(r.kiem) - tonCuoi) : null, price: price, ban: num_(r.ban) };
  });
  var M2 = doc.m2 === true, A = M2 ? aggLines_(doc.rows, pm) : null;
  var goodsRaw = 0, unpriced = [];
  rows.forEach(function (r) {
    if (M2 && A.linedMuc[r.muc]) return;     // mặt hàng đã khai theo từng lần bán → tính ở A.gross
    if (r.ban > 0) { if (r.price > 0) goodsRaw += r.ban * r.price; else unpriced.push(r.ten); }
  });
  if (M2) { goodsRaw += A.gross; A.unpriced.forEach(function (n) { if (unpriced.indexOf(n) === -1) unpriced.push(n); }); }
  var ship = shipStats_(doc.thuchi.filter(function (l) { return l.loai === 'CkAcbShip'; }));
  if (M2) { ship.acb += A.shipCk; ship.expSi += A.shipSi; ship.expLe += A.shipLe; ship.revLe += A.shipCkLe; }
  var tienMat = M2 ? A.tm + A.shipTm : num_(T.tienMat), ckNoti = num_(T.ckNoti), du = num_(T.duCk), thieu = num_(T.thieuCk), app = M2 ? A.sp : num_(T.donApp);
  var ckBill = ckNoti - du + thieu;
  var revKiot = tienMat + ckBill + app;
  var revNgoai = S.TmThuKhac + S.TmBanhSale + S.CkCaNhanThuKhac + S.CkAcbBanhSale + ship.revLe;
  var revenue = revKiot + revNgoai;
  var goodsNet = goodsRaw - (M2 ? A.disc : 0) - num_(doc.giamGia);
  var revHang = goodsNet + ship.revLe + (M2 ? A.shipTm + S.TmThuKhac + S.CkCaNhanThuKhac : 0);
  var tmTong = tienMat + S.TmThuKhac + S.TmBanhSale - S.ChiShipTiktok - S.ChiDienNuoc - S.ChiKhac;
  // Ship do CÔNG TY đã chi (meta.ct) không trừ két; tiền NỘP VỀ công ty và ỨNG tiền trừ két nhưng không phải chi phí
  var ctShip = 0; doc.thuchi.forEach(function (l) { if ((l.loai === 'ChiShipSi' || l.loai === 'ChiShipLe') && l.meta && l.meta.ct) ctShip += num_(l.so); });
  var tmConLai = tmTong - S.ChiShipSi - S.ChiShipLe + ctShip - S.CkCaNhanBanh - S.NopVe - S.UngTien;
  var tongChi = S.ChiShipSi + S.ChiShipLe + S.ChiShipTiktok + S.ChiDienNuoc + S.ChiKhac + S.ChiSuaChua + S.CongTyChi;
  var tongCk = ckNoti + (M2 ? A.shipCk : num_(T.ckNotiShip)) + S.CkCaNhanThuKhac + S.CkAcbBanhSale + S.CkAcbShip;
  var ckBillExpected = M2 ? A.ck : goodsNet - tienMat - app - (S.TmThuKhac + S.TmBanhSale + S.CkCaNhanThuKhac + S.CkAcbBanhSale);
  var gt = doc.giaiTrinh || {}, checks = [];
  function add(id, label, entered, ref, why, okOverride) {
    var diff = (entered === null || ref === null) ? null : entered - ref;
    var okk = (okOverride !== undefined) ? okOverride : kcMatch_(entered, ref);
    checks.push({ id: id, label: label, ok: okk, entered: entered, ref: ref, diff: diff, why: okk ? '' : why, giaiTrinh: String(gt[id] || '') });
  }
  var d1 = revenue - revHang;
  add('DT', 'Doanh thu theo hàng bán ↔ theo tiền thu', revenue, revHang,
    (d1 > 0 ? 'Tiền thu NHIỀU hơn hàng bán ' : 'Tiền thu ÍT hơn hàng bán ') + fmt_(Math.abs(d1)) + 'đ. ' +
    (d1 > 0 ? 'Có thể: bán chưa ghi vào sổ, khách đặt/cọc trước, hoặc Noti dư chưa ghi "Dư tiền CK (F)".'
            : 'Có thể: bánh sale/giảm giá chưa ghi ô Giảm giá, bán chưa bấm bill, hoặc CK về hôm trước chưa ghi "Thiếu tiền (G)".') +
    (unpriced.length ? ' Mặt hàng chưa có giá: ' + unpriced.join(', ') + '.' : ''));
  var d2 = num_(T.tmDem) - tmConLai;
  add('TM', 'Tiền mặt đếm thực tế ↔ tiền mặt tính theo công thức', num_(T.tmDem), tmConLai,
    'Tiền mặt đếm ' + (d2 > 0 ? 'DƯ' : 'THIẾU') + ' ' + fmt_(Math.abs(d2)) + 'đ so với công thức. Kiểm tra: quên ghi khoản chi/thu tiền mặt, CK Noti bánh (Kiot bấm tiền mặt), tiền mặt nộp Noti.');
  var d3 = ckNoti - (ckBillExpected + du - thieu);
  add('NOTI', 'CK Noti kê khai ↔ CK trong bill + Dư − Thiếu', ckNoti, ckBillExpected + du - thieu,
    d3 > 0 ? 'Noti nhận NHIỀU hơn bill ' + fmt_(Math.abs(d3)) + 'đ: khách CK trước/đặt trước → ghi vào ô "Dư tiền CK (F)".'
           : 'Noti nhận ÍT hơn bill ' + fmt_(Math.abs(d3)) + 'đ: CK về hôm trước, hôm nay mới bấm bill → ghi vào ô "Thiếu tiền (G)".');
  add('SHIP_SI', 'Ship sỉ: chi thực tế ↔ cần chi', S.ChiShipSi, ship.expSi,
    'Chi ship sỉ ' + (S.ChiShipSi > ship.expSi ? 'NHIỀU' : 'ÍT') + ' hơn số cần chi ' + fmt_(Math.abs(S.ChiShipSi - ship.expSi)) + 'đ. Xem lại dòng "CK Noti — Ship": loại ship, người trả, thời điểm (đặt trước = chưa chi; đã trả trước = chỉ chi).');
  add('SHIP_LE', 'Ship lẻ: chi thực tế ↔ cần chi', S.ChiShipLe, ship.expLe,
    'Chi ship lẻ ' + (S.ChiShipLe > ship.expLe ? 'NHIỀU' : 'ÍT') + ' hơn số cần chi ' + fmt_(Math.abs(S.ChiShipLe - ship.expLe)) + 'đ. Xem lại dòng "CK Noti — Ship".');
  var badTon = rows.filter(function (r) { return r.hasKiem && Math.abs(r.chenh) > 0.0001; });
  add('TON', 'Tồn kho: tồn cuối tính ↔ kiểm đếm', badTon.reduce(function (s, r) { return s + Math.abs(r.chenh); }, 0), 0,
    'Lệch: ' + badTon.map(function (r) { return r.ten + ' (' + (r.chenh > 0 ? '+' : '') + r.chenh + ')'; }).join('; ') + '. Đếm lại hoặc kiểm tra bán/xuất khác chưa ghi.',
    badTon.length === 0);
  var missNote = doc.thuchi.filter(function (l) { return LOAI_CHI[l.loai] && !String(l.note || '').trim(); }).length;
  var miss = [];
  if (!T.anhTM) miss.push('ảnh tiền mặt'); if (!T.anhNoti) miss.push('ảnh Noti'); if (missNote) miss.push(missNote + ' khoản chi chưa có ghi chú');
  if (M2) {   // bán bánh ổ 12 (giá thường, không combo) → tặng 1 panna cotta hoặc sữa chua
    var gReq = 0, gGot = 0;
    doc.rows.forEach(function (r) {
      if (/_12$/.test(r.muc) && r.nhom === 'BANH') (r.bl || []).forEach(function (l) { if (l.kind !== 'sale' && !l.cb) gReq += num_(l.q); });
      if (r.muc === 'HT_PANNA' || r.muc === 'HT_SCPM') gGot += num_(r.tang);
    });
    if (gReq > 0 || gGot > 0) add('TANG', 'Tặng kèm (panna cotta / sữa chua) ↔ bánh ổ 12 bán giá thường', gGot, gReq, 'Bán ' + gReq + ' bánh ổ 12 giá thường → phải tặng ' + gReq + ' (panna cotta hoặc sữa chua), đã ghi tặng ' + gGot + '.', gGot === gReq);
  }
  var missThu = M2 ? doc.thuchi.filter(function (l) { return (l.loai === 'TmThuKhac' || l.loai === 'CkCaNhanThuKhac') && !String(l.note || '').trim(); }).length : 0;
  if (missThu) miss.push(missThu + ' khoản thu chưa có lý do');
  add('ANH', 'Đủ ảnh tiền mặt, ảnh Noti và ghi chú khoản chi', null, null, 'Còn thiếu: ' + miss.join(', ') + '.', miss.length === 0);
  return {
    rows: rows, S: S, ship: ship, checks: checks,
    totals: { revenue: revenue, revKiot: revKiot, revNgoai: revNgoai, revHang: revHang, goodsNet: goodsNet, ckBill: ckBill, tmTong: tmTong, tmConLai: tmConLai, tongChi: tongChi, tongCk: tongCk },
    A: A, derived: M2 ? { tienMat: tienMat, donApp: app, ckNotiShip: A.shipCk, giamGiaTuDong: A.disc, ckBillDuKien: A.ck } : null, missThu: missThu
  };
}

// ============================================================================
// 5. CHUẨN HÓA DỮ LIỆU CLIENT GỬI LÊN
// ============================================================================

function cleanNum_(v) { var n = num_(v); return r2_(n); }
function cleanQty_(v) { if (v === '' || v === null || v === undefined) return ''; return r2_(num_(v)); }
/** Nhiều ảnh chứng từ: các URL Drive nối bằng '|' (tối đa 8). */
function cleanAnh_(v) {
  return String(v || '').split('|').map(function (u) { return u.trim(); }).filter(function (u) { return /^https:\/\/drive\.google\.com\/[\w\/?=&.\-]+$/.test(u) || /^https:\/\/lh3\.googleusercontent\.com\/[\w\/?=&.\-]+$/.test(u); }).slice(0, 8).join('|');
}
function cleanBl_(bl, muc) {
  var out = [], seen = {};
  (Array.isArray(bl) ? bl : []).slice(0, 80).forEach(function (l) {
    var q = cleanNum_(l && l.q); if (!(q > 0)) return;
    var id = String((l && l.id) || '').replace(/[^\w\-]/g, '').slice(0, 40) || ('L' + Utilities.getUuid().slice(0, 8));
    if (seen[id]) id = id + '_' + out.length; seen[id] = 1;
    var sale = l.kind === 'sale';
    out.push({ id: id, q: q, kind: sale ? 'sale' : 'thuong', pct: sale ? Math.min(100, Math.max(0, cleanNum_(l.pct))) : 0,
      pay: (l.pay === 'CK' || l.pay === 'SP') ? l.pay : 'TM', gia: cleanNum_(l.gia), tot: cleanNum_(l.tot), cb: safeText_(l.cb, 40), cbn: safeText_(l.cbn, 80), cbq: cleanNum_(l.cbq), ship: cleanNum_(l.ship),
      shipPay: l.shipPay === 'CK' ? 'CK' : 'TM', shipLoai: l.shipLoai === 'si' ? 'si' : 'le', kh: safeText_(l.kh, 60) });
  });
  return out;
}
function normDoc_(d, store, ngay, ca) {
  d = d || {};
  var prefix = store + '|' + ngay + '|' + ca + '|';
  var seen = {}, rows = [];
  (d.rows || []).slice(0, 250).forEach(function (r) {
    var muc = String(r.muc || '').trim();
    if (!/^[A-Za-z0-9_\-]{1,60}$/.test(muc) || seen[muc]) return;
    seen[muc] = 1;
    var nhom = (r.nhom === 'HANG_TANG' || r.nhom === 'KHAC') ? r.nhom : 'BANH';
    rows.push({
      muc: muc, nhom: nhom, ten: safeText_(r.ten || muc, 120),
      items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).map(function (x) { return String(x).slice(0, 40); }),
      tonDau: cleanNum_(r.tonDau), nhap: cleanNum_(r.nhap), ban: cleanNum_(r.ban), xuat: cleanNum_(r.xuat), tang: cleanNum_(r.tang),
      bl: cleanBl_(r.bl, muc),
      kiem: cleanQty_(r.kiem), ghiChu: safeText_(r.ghiChu, 200), tdLyDo: safeText_(r.tdLyDo, 200),
      auto: (r.auto === null || r.auto === undefined || r.auto === '') ? null : cleanNum_(r.auto)   // tồn đầu tự điền (client gửi; khi KẾT CA server tính lại để chặn gian lận)
    });
    var rr = rows[rows.length - 1]; if (rr.bl.length) rr.ban = r2_(rr.bl.reduce(function (s, l) { return s + l.q; }, 0));   // SL bán = tổng các lần bán
  });
  var thuchi = [];
  (d.thuchi || []).slice(0, 250).forEach(function (l) {
    if (!LOAI_OK[l.loai]) return;
    var meta = {};
    if (l.meta && typeof l.meta === 'object') {
      if (l.loai === 'CkAcbShip') {
        meta = { loai: l.meta.loai === 'si' ? 'si' : 'le', payer: l.meta.payer === 'congty' ? 'congty' : 'khach',
                 timing: (l.meta.timing === 'datTruoc' || l.meta.timing === 'traTruoc') ? l.meta.timing : 'thuong',
                 ngay: validNgay_(l.meta.ngay) ? l.meta.ngay : '' };
      } else if (l.loai === 'ChiKhac') { meta = { ct: !!l.meta.ct }; }
      else if (l.loai === 'ChiShipSi' || l.loai === 'ChiShipLe') { meta = { ref: String(l.meta.ref || '').replace(/[^\w\-|]/g, '').slice(0, 90), ct: !!l.meta.ct }; }
      else if (l.loai === 'ChiDienNuoc') { meta = { sub: ['dien', 'nuoc', 'wifi'].indexOf(l.meta.sub) !== -1 ? l.meta.sub : '' }; }
      else if (l.loai === 'NopVe') { meta = { ct: !!l.meta.ct }; }
    }
    var id = String(l.id || '');
    if (id.indexOf(prefix) !== 0 || id.length > 90) id = prefix + Utilities.getUuid().slice(0, 8);
    thuchi.push({ id: id, loai: l.loai, so: cleanNum_(l.so), note: safeText_(l.note, 300), meta: meta, anh: cleanAnh_(l.anh) });
  });
  var T = d.tien || {};
  var tien = {
    tienMat: cleanNum_(T.tienMat), tmDem: cleanNum_(T.tmDem), ckNoti: cleanNum_(T.ckNoti), ckNotiShip: cleanNum_(T.ckNotiShip),
    donApp: cleanNum_(T.donApp), duCk: cleanNum_(T.duCk), thieuCk: cleanNum_(T.thieuCk), tmNopNoti: cleanNum_(T.tmNopNoti),
    tienKet: cleanNum_(T.tienKet), anhTM: String(T.anhTM || '').slice(0, 300), anhNoti: String(T.anhNoti || '').slice(0, 300)
  };
  var gt = {};
  if (d.giaiTrinh && typeof d.giaiTrinh === 'object') Object.keys(d.giaiTrinh).slice(0, 12).forEach(function (k) { gt[k] = safeText_(d.giaiTrinh[k], 400); });
  var kd = (d.khachDat || []).slice(0, 40).map(function (k) {
    return { ten: safeText_(k.ten, 80), banh: safeText_(k.banh, 120), coc: cleanNum_(k.coc), ngayLay: safeText_(k.ngayLay, 20) };
  });
  return { rows: rows, thuchi: thuchi, tien: tien, giamGia: cleanNum_(d.giamGia), giaiTrinh: gt, khachDat: kd, m2: d.m2 === true };
}

// ============================================================================
// 6. ĐỌC CA / NGÀY  (tải NHIỀU ngày trong 1 lần — dùng chung các lần đọc sheet)
// ============================================================================

function parseJson_(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }

function caDocFrom_(ket, ton, tc, tien) {
  var th = ket ? parseJson_(ket.TongHop, {}) : {};
  return {
    exists: !!ket, status: ket ? String(ket.TrangThai || 'Nhap') : 'Chua', version: ket ? num_(ket.Version) : 0,
    lyDoTraLai: ket ? String(ket.LyDoTraLai || '') : '', submittedAt: ket ? String(ket.SubmittedAt || '') : '',
    nguoiKet: ket ? String(ket.NguoiKet || '') : '', duyetBoi: ket ? String(ket.DuyetBoi || '') : '', savedAt: ket ? String(ket.SavedAt || '') : '',
    tongHop: th,
    doc: {
      rows: ton.map(function (o) {
        return { muc: String(o.MucSo), nhom: String(o.Nhom), ten: String(o.TenMuc), items: parseCodes_(o.ItemCodes),
          tonDau: o.TonDau, nhap: o.Nhap, ban: o.BanLeShopee, xuat: o.XuatKhac, tang: o.Tang, kiem: o.KiemDem === '' ? '' : o.KiemDem, ghiChu: String(o.GhiChu || ''),
          bl: parseJson_(o.BanChiTiet, []), tdTt: String(o.TdDuyet || ''), tdQL: String(o.TdGhiChuQL || '') };
      }),
      thuchi: tc.map(function (o) {
        return { id: String(o.Id), loai: String(o.Loai), so: num_(o.SoTien), note: String(o.GhiChu || ''), meta: parseJson_(o.Meta, {}), anh: String(o.AnhUrl || ''),
          tt: String(o.TrangThaiDong || 'ChoDuyet'), soQL: o.SoTienQL, ghiChuQL: String(o.GhiChuQL || '') };
      }),
      tien: tien ? {
        tienMat: tien.TienMat, tmDem: tien.TmDem, ckNoti: tien.CkNoti, ckNotiShip: tien.CkNotiShip, donApp: tien.DonApp, duCk: tien.DuCk,
        thieuCk: tien.ThieuCk, tmNopNoti: tien.TmNopNoti, tienKet: tien.TienKet, anhTM: String(tien.AnhTienMat || ''), anhNoti: String(tien.AnhNoti || '')
      } : null,
      giamGia: th.giamGia || 0, m2: th.m2 === true, giaiTrinh: th.giaiTrinh || {}, khachDat: parseJson_(ket ? ket.GhiChuKhachDat : '', [])
    }
  };
}

/**
 * Tải trọn các ngày `days` (mỗi ngày 2 ca) của 1 cửa hàng. Mỗi sheet chỉ đọc cột khóa 1 lần,
 * rồi đọc các dòng cần thiết 1–2 lần. Trả {ngay: {ngay, ca:{Sáng,Tối}, opening:{}, extras:{}}}.
 */
function loadDays_(store, days, mapRows) {
  var kSh = sheetReady_(SH.KETCA), tSh = sheetReady_(SH.TONKHO), cSh = sheetReady_(SH.THUCHI), nSh = sheetReady_(SH.TIENCA);
  var needKet = {}, wantTon = {}, d, c;
  days.forEach(function (ng) {
    CA_LIST.forEach(function (ca) {
      needKet[store + '|' + ng + '|' + ca] = 1;
      wantTon[prefixOf_(store, ng, ca)] = 1;
      var p = prevCa_(ng, ca); wantTon[prefixOf_(store, p.ngay, p.ca)] = 1;
    });
  });
  // --- Data_NV_KetCa (nhỏ → đọc cả cột khóa) ---
  var kk = keyCol_(kSh, 'Key_Id', true), kRows = [];
  kk.keys.forEach(function (k, i) { if (needKet[k]) kRows.push(kk.start + i); });
  var ketBy = {}; readRowObjs_(kSh, kRows).forEach(function (o) { ketBy[String(o.Key_Id)] = o; });
  var anyKet = Object.keys(ketBy).length > 0;

  // --- Data_NV_TonKho: nhóm dòng theo tiền tố 'store|ngay|ca|' ---
  function group(sh, colName, want, fullIfMissing, mustHave) {
    function build(kc) {
      var by = {};
      kc.keys.forEach(function (k, i) { var pre = segPrefix_(k); if (pre && want[pre]) (by[pre] = by[pre] || []).push(kc.start + i); });
      return by;
    }
    var kc = keyCol_(sh, colName, false), by = build(kc);
    if (kc.partial && fullIfMissing) {
      var miss = mustHave.some(function (pre) { return !by[pre]; });
      if (miss) by = build(keyCol_(sh, colName, true));
    }
    return by;
  }
  var ketPrefixes = Object.keys(ketBy).map(function (k) { return k + '|'; });
  var tonRows = group(tSh, 'Key_Id', wantTon, true, ketPrefixes);
  var tcWant = {}; ketPrefixes.forEach(function (p) { tcWant[p] = 1; });
  var tcRows = anyKet ? group(cSh, 'Id', tcWant, false, []) : {};

  // đọc dữ liệu: ton (mọi tiền tố tìm thấy) + thu chi (ca có sổ)
  var allTon = []; Object.keys(tonRows).forEach(function (p) { allTon = allTon.concat(tonRows[p]); });
  allTon.sort(function (a, b) { return a - b; });
  var tonBy = {}; readRowObjs_(tSh, allTon).forEach(function (o) { var p = segPrefix_(String(o.Key_Id)); (tonBy[p] = tonBy[p] || []).push(o); });
  var allTc = []; Object.keys(tcRows).forEach(function (p) { allTc = allTc.concat(tcRows[p]); });
  allTc.sort(function (a, b) { return a - b; });
  var tcBy = {}; readRowObjs_(cSh, allTc).forEach(function (o) { var p = segPrefix_(String(o.Id)); (tcBy[p] = tcBy[p] || []).push(o); });
  var tienBy = {};
  if (anyKet) {
    var nk = keyCol_(nSh, 'Key_Id', true), nRows = [];
    nk.keys.forEach(function (k, i) { if (ketBy[k]) nRows.push(nk.start + i); });
    readRowObjs_(nSh, nRows).forEach(function (o) { tienBy[String(o.Key_Id)] = o; });
  }

  var out = {};
  days.forEach(function (ng) {
    var res = { ngay: ng, ca: {}, opening: {}, extras: {} };
    CA_LIST.forEach(function (ca) {
      var key = store + '|' + ng + '|' + ca, pre = key + '|', ket = ketBy[key] || null;
      res.ca[ca] = caDocFrom_(ket, ket ? (tonBy[pre] || []) : [], ket ? (tcBy[pre] || []) : [], ket ? (tienBy[key] || null) : null);
      var p = prevCa_(ng, ca), op = openingFrom_(store, ng, ca, mapRows, tonBy[prefixOf_(store, p.ngay, p.ca)] || []);
      res.opening[ca] = op.open; res.extras[ca] = op.extras;
    });
    out[ng] = res;
  });
  return out;
}
function statusesFromDays_(days) {
  var out = {};
  Object.keys(days).forEach(function (ng) {
    out[ng] = {};
    CA_LIST.forEach(function (ca) {
      var cd = days[ng].ca[ca];
      out[ng][ca] = cd.exists ? { status: cd.status, lyDo: cd.lyDoTraLai, version: cd.version } : { status: 'Chua' };
    });
  });
  return out;
}

/** Trạng thái các ngày — rất nhẹ: chỉ đọc đuôi Data_NV_KetCa. */
function statusesOf_(store, ngayList) {
  var sh = sheetReady_(SH.KETCA), out = {}, last = lastRow_(sh);
  ngayList.forEach(function (n) { out[n] = { 'Sáng': { status: 'Chua' }, 'Tối': { status: 'Chua' } }; });
  if (last < 2) return out;
  var h = hdr_(sh), n = Math.min(600, last - 1), width = Math.max(h.names.length, 1);
  var vals = sh.getRange(last - n + 1, 1, n, width).getValues();   // 1 lần đọc đuôi sheet (ca gần đây luôn nằm cuối)
  var iS = h.map.Store - 1, iN = h.map.Ngay - 1, iC = h.map.Ca - 1, iT = h.map.TrangThai - 1, iL = h.map.LyDoTraLai - 1, iV = h.map.Version - 1;
  vals.forEach(function (r) {
    var ng = cellStr_(r[iN]);
    if (String(r[iS]) !== store || !out[ng]) return;
    out[ng][String(r[iC])] = { status: String(r[iT] || 'Nhap'), lyDo: String(r[iL] || ''), version: num_(r[iV]) };
  });
  return out;
}
function recentDays_() { var t = todayStr_(); return [t, addDays_(t, -1), addDays_(t, -2), addDays_(t, -3)]; }

function nvBootstrap(token, store) {
  return safeRun_(function () {
    var acc = getAccountByToken_(token);
    if (!acc) return fail_('Phiên đăng nhập đã hết hạn.', 'EXPIRED');
    if (!schemaOk_()) ensureAllSchemas_();
    var stores = [];
    if (acc.role === 'QuanLy') {
      stores = mgrStores_(acc); if (!store && stores.length === 1) store = stores[0];
      if (!store) return ok_({ username: acc.username, role: acc.role, readOnly: true, stores: stores, store: '', today: todayStr_(), minNgay: minNgay_(), build: APP_BUILD, mapso: [], statuses: {}, days: {} });
    } else if (acc.role === 'Admin') {
      var sh = sheetReady_(SH.STORE_SETTINGS), vals = sh.getDataRange().getValues(), iS = vals.length ? vals[0].indexOf('Store_Name') : -1;
      if (iS >= 0) for (var i = 1; i < vals.length; i++) if (vals[i][iS]) stores.push(String(vals[i][iS]));
      if (!store) return ok_({ username: acc.username, role: acc.role, readOnly: true, stores: stores, store: '', today: todayStr_(), minNgay: minNgay_(), build: APP_BUILD, mapso: [], statuses: {}, days: {} });
    }
    var c = ctx_(token, store, false); if (c.err) return c.err;
    migrateSoThang10_();                                           // chạy 1 lần duy nhất: cập nhật tên mục sổ theo mẫu tháng 10
    var mapRows = readMapSo_(c.store), dayList = recentDays_();
    var days = loadDays_(c.store, dayList, mapRows);
    return ok_({
      username: acc.username, role: acc.role, readOnly: c.readOnly, store: c.store, stores: stores, today: dayList[0], minNgay: minNgay_(),
      build: APP_BUILD, mapso: mapRows, statuses: statusesFromDays_(days), days: days
    });
  });
}
function nvGetStatuses(token, store) {
  return safeRun_(function () {
    var c = ctx_(token, store, false); if (c.err) return c.err;
    return ok_({ statuses: statusesOf_(c.store, recentDays_()) });
  });
}
function nvGetDay(token, ngay, store, cas) {
  return safeRun_(function () {
    var c = ctx_(token, store, false); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, null, false); if (bad) return bad;
    var list = (Array.isArray(cas) ? cas : []).filter(function (x) { return CA_LIST.indexOf(x) !== -1; });
    if (!list.length) list = CA_LIST;
    var cold = coldFileFor_(ngay), one = (cold && loadDayCold_(c.store, ngay, cold)) || loadDays_(c.store, [ngay], readMapSo_(c.store))[ngay], res = { ngay: ngay, ca: {}, opening: {}, extras: {} };
    list.forEach(function (ca) { res.ca[ca] = one.ca[ca]; res.opening[ca] = one.opening[ca]; res.extras[ca] = one.extras[ca]; });
    return ok_(res);
  });
}

// ============================================================================
// 7. LƯU / GỬI / XÓA CA
// ============================================================================

function nvSaveCa(token, payload) {
  return safeRun_(function () {
    payload = payload || {};
    var c = ctx_(token, null, true); if (c.err) return c.err;
    var ngay = String(payload.ngay || ''), ca = String(payload.ca || '');
    var bad = checkNgayCa_(ngay, ca, true); if (bad) return bad;
    var store = c.store, key = store + '|' + ngay + '|' + ca, submit = payload.submit === true;

    // ---- Việc KHÔNG cần khóa: chuẩn hóa + tính toán (chỉ dùng CPU / cache) ----
    var doc = normDoc_(payload.doc, store, ngay, ca), pm = priceMap_(), calc = calcDoc_(doc, pm);
    if (doc.m2 && calc.derived) { doc.tien.tienMat = calc.derived.tienMat; doc.tien.donApp = calc.derived.donApp; doc.tien.ckNotiShip = calc.derived.ckNotiShip; }   // lưu số TỰ TÍNH để trang vận hành đọc đúng
    // Tồn đầu bị sửa: bản nháp tin số "tự điền" client gửi (nhanh); khi KẾT CA server tự tính lại từ ca trước (chặn gian lận)
    var autoOf = {};
    if (submit) {
      var mapRows = readMapSo_(store), p = prevCa_(ngay, ca), pSh = sheetReady_(SH.TONKHO);
      var op = openingFrom_(store, ngay, ca, mapRows, readRowObjs_(pSh, rowsByPrefix_(pSh, 'Key_Id', prefixOf_(store, p.ngay, p.ca), false))).open;
      Object.keys(op).forEach(function (m) { autoOf[m] = op[m].ton; });
    } else {
      doc.rows.forEach(function (r) { if (r.auto !== null) autoOf[r.muc] = r.auto; });
    }
    var tdSua = [];
    doc.rows.forEach(function (r) { var a = autoOf[r.muc]; if (a !== undefined && Math.abs(num_(r.tonDau) - a) > 0.0001) tdSua.push(r.muc); });

    if (submit) {
      var errs = [];
      calc.rows.forEach(function (r) { if (r.tonCuoi < 0) errs.push('Tồn cuối âm: ' + r.ten + ' (' + r.tonCuoi + ')'); });
      doc.rows.forEach(function (r) { if (tdSua.indexOf(r.muc) !== -1 && !String(r.tdLyDo || '').trim()) errs.push('Tồn đầu bị sửa chưa có lý do: ' + r.ten); });
      doc.thuchi.forEach(function (l) { if (LOAI_CHI[l.loai] && !String(l.note || '').trim()) errs.push('Khoản chi ' + fmt_(l.so) + 'đ thiếu ghi chú'); });
      doc.thuchi.forEach(function (l) { if (l.loai === 'ChiDienNuoc' && !(l.meta && l.meta.sub)) errs.push('Khoản chi ' + fmt_(l.so) + 'đ: phải chọn rõ Điện, Nước hay Wifi'); });
      if (doc.m2) {
        var due = shipDue_(calc.A, doc.thuchi); if (due.length) errs.push('Còn ' + due.length + ' đơn ship chưa bấm CHI (' + fmt_(due.reduce(function (s, x) { return s + x.fee; }, 0)) + 'đ)');
        if (calc.missThu) errs.push(calc.missThu + ' khoản thu chưa ghi lý do');
        if (calc.A.unpriced.length) errs.push('Chưa có giá bán: ' + calc.A.unpriced.join(', '));
      }
      calc.checks.forEach(function (k) { if (!k.ok && k.id !== 'ANH' && !k.giaiTrinh.trim()) errs.push('Chỉ tiêu lệch cần giải trình: ' + k.label); });
      calc.checks.forEach(function (k) { if (!k.ok && k.id === 'ANH' && !k.giaiTrinh.trim()) errs.push('Thiếu ảnh/ghi chú — nhập giải trình hoặc bổ sung'); });
      if (errs.length) return fail_('Chưa gửi được: ' + errs.slice(0, 8).join(' • '), 'INVALID');
    }
    var tongHop = { v: 1, m2: doc.m2 === true, A: calc.A ? { qty: calc.A.qty, gross: calc.A.gross, disc: calc.A.disc, tm: calc.A.tm, ck: calc.A.ck, sp: calc.A.sp, shipTm: calc.A.shipTm, shipCk: calc.A.shipCk } : null, totals: calc.totals, ship: calc.ship, S: calc.S, giamGia: doc.giamGia, giaiTrinh: doc.giaiTrinh, tonDauSua: tdSua,
      checks: calc.checks.map(function (k) { return { id: k.id, label: k.label, ok: k.ok, entered: k.entered, ref: k.ref, diff: k.diff, why: k.why, giaiTrinh: k.giaiTrinh }; }),
      soKhopLech: { khop: calc.checks.filter(function (k) { return k.ok; }).length, lech: calc.checks.filter(function (k) { return !k.ok; }).length } };
    var thStr = JSON.stringify(tongHop); if (thStr.length > 49000) return fail_('Dữ liệu ca quá dài, hãy rút gọn ghi chú/giải trình.');

    // ---- Phần ghi: giữ khóa càng ngắn càng tốt ----
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại sau vài giây.', 'BUSY');
    try {
      var kSh = sheetReady_(SH.KETCA), ketRow = exactRow_(kSh, 'Key_Id', key);
      var ket = ketRow ? readRowObjs_(kSh, [ketRow])[0] : null;
      var status = ket ? String(ket.TrangThai || 'Nhap') : 'Nhap';
      if (status === 'ChoDuyet' || status === 'DaDuyet') return fail_('Ca này đã gửi, không sửa được nữa (trừ khi quản lý trả lại).', 'LOCKED');
      var curVer = ket ? num_(ket.Version) : 0;
      if (num_(payload.version) !== curVer) return fail_('Ca này vừa được cập nhật ở máy khác — hãy tải lại.', 'VERSION');

      var tonSh = sheetReady_(SH.TONKHO), tcSh = sheetReady_(SH.THUCHI), now = nowStr_();
      var oldTonRows = ket ? rowsByPrefix_(tonSh, 'Key_Id', key + '|', true) : [];
      var oldTcRows = ket ? rowsByPrefix_(tcSh, 'Id', key + '|', true) : [];
      // Giữ quyết định của quản lý với các dòng thu/chi không đổi (sau khi bị trả lại)
      var oldTc = {}; readRowObjs_(tcSh, oldTcRows).forEach(function (o) { oldTc[String(o.Id)] = o; });
      var oldTon = {}; if (tdSua.length && oldTonRows.length) readRowObjs_(tonSh, oldTonRows).forEach(function (o) { oldTon[String(o.MucSo)] = o; });   // giữ quyết định duyệt tồn đầu nếu số không đổi

      replaceRows_(SH.TONKHO, oldTonRows, doc.rows.map(function (r, i) {
        var k = calc.rows[i], ghi = r.ghiChu;
        if (tdSua.indexOf(r.muc) !== -1) ghi = '[TĐ sửa từ ' + autoOf[r.muc] + ': ' + (r.tdLyDo || '—') + ']' + (r.ghiChu ? ' ' + r.ghiChu : '');
        return { Key_Id: key + '|' + r.muc, Store: store, Ngay: ngay, Ca: ca, Nhom: r.nhom, MucSo: r.muc, TenMuc: r.ten, ItemCodes: JSON.stringify(r.items),
          TonDau: r.tonDau, Nhap: r.nhap, BanLeShopee: r.ban, XuatKhac: r.xuat, Tang: r.tang, TonCuoi: k.tonCuoi,
          KiemDem: r.kiem, ChenhLech: k.hasKiem ? k.chenh : '', GhiChu: ghi, SavedAt: now,
          BanChiTiet: r.bl.length ? JSON.stringify(r.bl) : '',
          TdDuyet: tdSua.indexOf(r.muc) === -1 ? '' : ((oldTon[r.muc] && Math.abs(num_(oldTon[r.muc].TonDau) - r.tonDau) < 0.0001 && oldTon[r.muc].TdDuyet) ? String(oldTon[r.muc].TdDuyet) : 'ChoDuyet'),
          TdDuyetBoi: (oldTon[r.muc] && Math.abs(num_(oldTon[r.muc].TonDau) - r.tonDau) < 0.0001) ? String(oldTon[r.muc].TdDuyetBoi || '') : '',
          TdGhiChuQL: (oldTon[r.muc] && Math.abs(num_(oldTon[r.muc].TonDau) - r.tonDau) < 0.0001) ? String(oldTon[r.muc].TdGhiChuQL || '') : '' };
      }));
      replaceRows_(SH.THUCHI, oldTcRows, doc.thuchi.map(function (l) {
        var o = oldTc[l.id], keep = o && num_(o.SoTien) === l.so && String(o.Loai) === l.loai;
        return { Id: l.id, Store: store, Ngay: ngay, Ca: ca, Loai: l.loai, SoTien: l.so, GhiChu: l.note, Meta: JSON.stringify(l.meta), AnhUrl: l.anh,
          TrangThaiDong: keep ? String(o.TrangThaiDong || 'ChoDuyet') : 'ChoDuyet', SoTienQL: keep ? o.SoTienQL : '', GhiChuQL: keep ? o.GhiChuQL : '',
          DaDoVaoKetCa: keep ? o.DaDoVaoKetCa : '', SavedAt: now };
      }));
      var T = doc.tien;
      upsertRow_(SH.TIENCA, 'Key_Id', key, { Key_Id: key, Store: store, Ngay: ngay, Ca: ca, TmDem: T.tmDem, CkNoti: T.ckNoti, CkNotiShip: T.ckNotiShip, DonApp: T.donApp,
        DuCk: T.duCk, ThieuCk: T.thieuCk, TmNopNoti: T.tmNopNoti, TienKet: T.tienKet, AnhTienMat: T.anhTM, AnhNoti: T.anhNoti, TienMat: T.tienMat, SavedAt: now });

      var newVer = curVer + 1, newStatus = submit ? 'ChoDuyet' : (status === 'TraLai' ? 'TraLai' : 'Nhap');
      upsertRow_(SH.KETCA, 'Key_Id', key, {
        Key_Id: key, Store: store, Ngay: ngay, Ca: ca, TrangThai: newStatus, NguoiKet: c.account.username,
        SubmittedAt: submit ? now : (ket ? ket.SubmittedAt : ''), DuyetBoi: ket ? ket.DuyetBoi : '', DuyetLuc: ket ? ket.DuyetLuc : '',
        LyDoTraLai: submit ? '' : (ket ? ket.LyDoTraLai : ''), Version: newVer, TongHop: thStr, GhiChuKhachDat: JSON.stringify(doc.khachDat), SavedAt: now, LanDuyet: ket ? ket.LanDuyet : '', BoSung: ket ? ket.BoSung : ''
      }, ketRow);
      if (submit) logAudit_(c.account.username, 'NV_GUI_KET_CA', key, 'v' + newVer);   // nháp tự lưu không ghi nhật ký (tránh chậm + rác)
      return ok_({ version: newVer, status: newStatus, savedAt: now, tongHop: tongHop, tonDauSua: tdSua });
    } finally { lock.releaseLock(); }
  });
}

function nvDeleteCa(token, ngay, ca) {
  return safeRun_(function () {
    var c = ctx_(token, null, true); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, true); if (bad) return bad;
    var key = c.store + '|' + ngay + '|' + ca;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.', 'BUSY');
    try {
      var kSh = sheetReady_(SH.KETCA), ketRow = exactRow_(kSh, 'Key_Id', key);
      var ket = ketRow ? readRowObjs_(kSh, [ketRow])[0] : null;
      var st = ket ? String(ket.TrangThai || 'Nhap') : 'Nhap';
      if (st === 'ChoDuyet' || st === 'DaDuyet') return fail_('Ca đã gửi, không xóa được.', 'LOCKED');
      var tonSh = sheetReady_(SH.TONKHO), tcSh = sheetReady_(SH.THUCHI), nSh = sheetReady_(SH.TIENCA);
      deleteRows_(tonSh, rowsByPrefix_(tonSh, 'Key_Id', key + '|', true));
      deleteRows_(tcSh, rowsByPrefix_(tcSh, 'Id', key + '|', true));
      var nRow = exactRow_(nSh, 'Key_Id', key); if (nRow) deleteRows_(nSh, [nRow]);
      kSh = sheetReady_(SH.KETCA); ketRow = exactRow_(kSh, 'Key_Id', key); if (ketRow) deleteRows_(kSh, [ketRow]);
      logAudit_(c.account.username, 'NV_XOA_NHAP', key, '');
      return ok_({});
    } finally { lock.releaseLock(); }
  });
}

function anhFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('NV_ANH_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folders = DriveApp.getFoldersByName('9Sach_AnhKetCa');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('9Sach_AnhKetCa');
  try { props.setProperty('NV_ANH_FOLDER_ID', folder.getId()); } catch (e) {}
  return folder;
}
/** Upload ảnh (base64) lên Drive. loai: 'TienMat' | 'Noti' (ghi Data_KetCa_Anh) | 'ThuChi' (chỉ trả URL). */
function nvUploadAnh(token, base64Data, mimeType, fileName, ngay, ca, loai) {
  return safeRun_(function () {
    var c = ctx_(token, null, true); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, true); if (bad) return bad;
    if (['TienMat', 'Noti', 'ThuChi'].indexOf(loai) === -1) return fail_('Loại ảnh không hợp lệ.');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(String(mimeType || ''))) return fail_('Chỉ nhận ảnh JPG/PNG/WEBP.');
    if (!base64Data || base64Data.length > 9 * 1024 * 1024) return fail_('Ảnh quá lớn. Hãy chụp lại.');
    var kSh = sheetReady_(SH.KETCA), ketRow = exactRow_(kSh, 'Key_Id', c.store + '|' + ngay + '|' + ca);
    var ket = ketRow ? readRowObjs_(kSh, [ketRow])[0] : null;
    var st = ket ? String(ket.TrangThai || 'Nhap') : 'Nhap';
    if (st === 'ChoDuyet' || st === 'DaDuyet') return fail_('Ca đã gửi, không tải thêm ảnh.', 'LOCKED');
    var folder = anhFolder_();
    var safeName = String(fileName || 'anh.jpg').replace(/[^\w.\-]/g, '_').slice(0, 80);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, c.store + '_' + ngay + '_' + ca + '_' + safeName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?id=' + file.getId();
    if (loai !== 'ThuChi') {
      var lock = LockService.getScriptLock();
      if (lock.tryLock(15000)) {
        try {
          var aSh = sheetReady_(SH.ANH), aMap = getHeaderMap_(aSh), aW = Math.max(hdr_(aSh).names.length, SCHEMAS[SH.ANH].length);
          appendRowsRaw_(SH.ANH, aSh, aMap, aW, [objToRow_(SH.ANH, { Id: genId_('ANH'), Store: c.store, Ngay: ngay, Loai: loai, Url: url, FileName: safeName, UploadedAt: nowStr_(), UploadedBy: c.account.username }, aMap, aW, null)]);
        } finally { lock.releaseLock(); }
      }
    }
    logAudit_(c.account.username, 'NV_UPLOAD_ANH', c.store + '|' + ngay + '|' + ca + '|' + loai, safeName);
    return ok_({ url: url });
  });
}

// ============================================================================
// 8. SETUP: tạo sheet + danh mục SỔ KẾT CA MỚI (theo mẫu "SỔ KẾT CA CHÍNH THỨC" từ 01/10/2026)
// ============================================================================

// [MucSo, Nhom, TenMuc ("PHÂN LOẠI — LOẠI HÀNG" đúng chữ trên sổ), tokens khớp tên SP (dấu | = hoặc, ! = loại trừ)]
var SO_SEED_ = [
  ['CREPE_SET2', 'BANH', 'BÁNH CREPE — Set 2 Cái', ['crepe', '2']],
  ['CREPE_SET4', 'BANH', 'BÁNH CREPE — Set 4 Cái', ['crepe', '4']]
];
(function () {
  var T = [['VANG', 'Vàng', 'vang'], ['XANH', 'Xanh', 'xanh'], ['THANTRE', 'Than tre', 'than tre']];
  T.forEach(function (t) { [12, 16].forEach(function (sz) {
    SO_SEED_.push(['NGANLOP_' + t[0] + '_' + sz, 'BANH', 'BÁNH NGÀN LỚP TRUYỀN THỐNG — ' + t[1] + ' ' + sz + 'cm', ['ngan lop', t[2], String(sz), '!phu si', '!lava', '!mix']]);
  }); });
  [['XANH', 'Phú sĩ xanh', 'xanh'], ['TIM', 'Phú sĩ tím', 'tim'], ['CHOCO', 'Choco hạnh nhân', 'choco|hanh nhan']].forEach(function (t) { [12, 16].forEach(function (sz) {
    SO_SEED_.push(['PHUSI_' + t[0] + '_' + sz, 'BANH', 'BÁNH PHÚ SĨ — ' + t[1] + ' ' + sz + 'cm', ['phu si', t[2], String(sz)]]);
  }); });
  [12, 16].forEach(function (sz) { SO_SEED_.push(['3VI_MIX_' + sz, 'BANH', 'BÁNH 3 VỊ — Mix ' + sz + 'cm', ['3 vi|mix', String(sz)]]); });
  SO_SEED_.push(['LAVA_MATCHA', 'BANH', 'BÁNH LAVA — Matcha', ['lava', 'matcha']]);
  SO_SEED_.push(['LAVA_SAURIENG', 'BANH', 'BÁNH LAVA — Sầu riêng', ['lava', 'sau rieng']]);
  SO_SEED_.push(['KHAC_KEMSOCOLA', 'KHAC', 'KHÁC — Kem Socola', ['kem', 'socola']]);
  SO_SEED_.push(['KHAC_HOPSN_NENXOAN', 'KHAC', 'KHÁC — Hộp sinh nhật / Nến xoắn', ['hop sinh nhat|nen xoan']]);
  SO_SEED_.push(['KHAC_SETTIMDA_MEKA', 'KHAC', 'KHÁC — Set tim da / Túi 1 Meka', ['set tim da|tui meka']]);
  SO_SEED_.push(['TUGHI_1', 'KHAC', 'KHÁC — (tự ghi 1)', []]);
  SO_SEED_.push(['TUGHI_2', 'KHAC', 'KHÁC — (tự ghi 2)', []]);
  SO_SEED_.push(['HT_SCPM', 'HANG_TANG', 'HÀNG TẶNG — Sữa chua phô mai', ['sua chua', 'pho mai']]);
  SO_SEED_.push(['HT_PANNA', 'HANG_TANG', 'HÀNG TẶNG — Panna Cotta', ['panna']]);
  SO_SEED_.push(['HT_TUIGIUNHIET', 'HANG_TANG', 'HÀNG TẶNG — Túi giữ nhiệt Lớn / Nhỏ', ['tui giu nhiet']]);
  SO_SEED_.push(['HT_MOCKHOA', 'HANG_TANG', 'HÀNG TẶNG — Móc khóa', ['moc khoa']]);
  SO_SEED_.push(['HT_TRAICAYSAY', 'HANG_TANG', 'HÀNG TẶNG — Trái cây sấy', ['trai cay say']]);
  SO_SEED_.push(['HT_TUGHI_1', 'HANG_TANG', 'KHÁC — (tự ghi 1)', []]);
  SO_SEED_.push(['HT_TUGHI_2', 'HANG_TANG', 'KHÁC — (tự ghi 2)', []]);
})();
var SO_CODES_ = {   // mã hàng THẬT trong Data_SanPham (không dùng đoán theo tên nữa — tên danh mục không có chữ "vàng/tím/xanh"...)
  CREPE_SET2: ['BR0002'], CREPE_SET4: ['BR0003'],
  NGANLOP_VANG_12: ['BO2003'], NGANLOP_VANG_16: ['BO2004'], NGANLOP_XANH_12: ['BO2005'], NGANLOP_XANH_16: ['BO2006'],
  NGANLOP_THANTRE_12: ['BO2007'], NGANLOP_THANTRE_16: ['BO2008'],
  PHUSI_XANH_12: ['BO2011'], PHUSI_XANH_16: ['BO2012'], PHUSI_TIM_12: ['BO2009'], PHUSI_TIM_16: ['BO2010'], PHUSI_CHOCO_12: ['BO2001'], PHUSI_CHOCO_16: ['BO2002'],
  '3VI_MIX_12': ['MX4001'], '3VI_MIX_16': ['MX4002'],
  LAVA_MATCHA: ['BB12002', 'BB12004'], LAVA_SAURIENG: ['BB12001', 'BB12003'], KHAC_KEMSOCOLA: ['KT9001']
};
function seedCodes_(s, catalog) { return SO_CODES_[s[0]] ? SO_CODES_[s[0]].slice() : matchItemCodes_(s[3], catalog); }
var SO_RETIRED_ = ['CREPE'];   // mục cũ "Bánh crepe" (1 dòng) — thay bằng Set 2 Cái / Set 4 Cái

function tokenMatch_(name, tok) {
  if (tok.charAt(0) === '!') return !tokenMatch_(name, tok.slice(1));
  return tok.split('|').some(function (t) {
    if (/^\d+$/.test(t)) return new RegExp('(^|[^0-9])' + t + '([^0-9]|$)').test(name);
    return name.indexOf(t) !== -1;
  });
}
function matchItemCodes_(tokens, catalog) {
  if (!tokens.length) return [];
  var out = [];
  catalog.forEach(function (r) {
    if (r[2] === 'Combo') return;   // combo không phải mặt hàng đơn — tránh lấy nhầm giá combo
    var nm = normName_(r[1]);
    if (tokens.every(function (t) { return tokenMatch_(nm, t); })) out.push(r[0]);
  });
  return out;
}

/**
 * Cập nhật Data_NV_MapSo theo sổ mới (idempotent): đổi TenMuc/ThuTu theo mẫu tháng 10, thêm mục mới
 * (Crepe Set 2/Set 4), ngừng dùng mục cũ "CREPE". KHÔNG đụng ItemCodes đã có / các dòng riêng của cửa hàng ngoài danh sách.
 * Tồn crepe cũ còn lại vẫn hiện ở ca kế tiếp dưới dạng "mặt hàng thêm" để nhân viên chuyển sang Set 2/Set 4.
 */
function migrateSoThang10_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(SO_MIGRATE_FLAG)) return null;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return null;
    try {
      if (props.getProperty(SO_MIGRATE_FLAG)) return null;
      var log = capNhatSoThang10();
      props.setProperty(SO_MIGRATE_FLAG, nowStr_());
      return log;
    } finally { lock.releaseLock(); }
  } catch (e) { Logger.log('migrateSoThang10_ fail: ' + e); return null; }
}
/** CÓ THỂ CHẠY TAY: cập nhật danh mục sổ theo mẫu tháng 10 (an toàn chạy nhiều lần). */
function capNhatSoThang10() {
  var log = { renamed: 0, added: 0, retired: 0, recoded: 0, unmatched: [] };
  var sh = sheetReady_(SH.MAPSO), catalog = loadCatalog_();
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) { setupSheets(); return log; }
  var h = vals[0].map(function (x) { return String(x).trim(); }), ix = {}; h.forEach(function (n, i) { ix[n] = i; });
  var seedBy = {}; SO_SEED_.forEach(function (s, i) { seedBy[s[0]] = { s: s, i: i }; });
  var have = {};
  for (var r = 1; r < vals.length; r++) {
    var muc = String(vals[r][ix.MucSo] || '').trim(); if (!muc) continue;
    have[muc] = true;
    var sd = seedBy[muc];
    if (sd) {
      var changed = false;
      if (String(vals[r][ix.TenMuc]) !== sd.s[2]) { vals[r][ix.TenMuc] = sd.s[2]; changed = true; }
      if (num_(vals[r][ix.ThuTu]) !== sd.i + 1) { vals[r][ix.ThuTu] = sd.i + 1; changed = true; }
      if (String(vals[r][ix.Nhom]) !== sd.s[1]) { vals[r][ix.Nhom] = sd.s[1]; changed = true; }
      if (changed) log.renamed++;
      if (SO_CODES_[muc] && JSON.stringify(parseCodes_(vals[r][ix.ItemCodes])) !== JSON.stringify(SO_CODES_[muc])) { vals[r][ix.ItemCodes] = JSON.stringify(SO_CODES_[muc]); log.recoded++; }
    } else if (SO_RETIRED_.indexOf(muc) !== -1 && isOn_(vals[r][ix.BatDung])) { vals[r][ix.BatDung] = false; log.retired++; }
  }
  sh.getRange(1, 1, vals.length, h.length).setValues(vals);
  var add = [];
  SO_SEED_.forEach(function (s, i) {
    if (have[s[0]]) return;
    var codes = seedCodes_(s, catalog);
    if (s[3].length && !codes.length) log.unmatched.push(s[0] + ' — ' + s[2]);
    var row = new Array(h.length).fill('');
    row[ix.MucSo] = s[0]; row[ix.Nhom] = s[1]; row[ix.TenMuc] = s[2]; row[ix.ThuTu] = i + 1; row[ix.ItemCodes] = JSON.stringify(codes); row[ix.Store] = '*'; row[ix.BatDung] = true;
    add.push(row);
  });
  if (add.length) { sh.getRange(vals.length + 1, 1, add.length, h.length).setValues(add); log.added = add.length; }
  dirty_(SH.MAPSO);
  Logger.log('capNhatSoThang10: ' + JSON.stringify(log));
  return log;
}

/** CHẠY 1 LẦN (idempotent): tạo/vá sheet Data_NV_*, ép định dạng text cột Ngày, seed Data_NV_MapSo. */
function setupSheets() {
  var log = { sheets: [], seeded: 0, filled: 0, unmatched: [], multi: [] };
  Object.keys(SCHEMAS).forEach(function (name) {
    var sh = getOrCreateSheet_(name);
    ensureSchema_(sh, SCHEMAS[name]);
    var map = getHeaderMap_(sh);
    (TEXT_COLS[name] || []).forEach(function (c) { if (map[c]) sh.getRange(2, map[c], Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'); });
    if (name.indexOf('Data_NV_') === 0) { sh.setFrozenRows(1); log.sheets.push(name); }
  });
  var mapSh = sheetReady_(SH.MAPSO);
  var catalog = loadCatalog_();
  if (mapSh.getLastRow() <= 1) {
    var rows = SO_SEED_.map(function (s, i) {
      var codes = seedCodes_(s, catalog);
      if (s[3].length && !codes.length) log.unmatched.push(s[0] + ' — ' + s[2]);
      if (codes.length > 1) log.multi.push(s[0] + ' → ' + codes.join(', '));
      return [s[0], s[1], s[2], i + 1, JSON.stringify(codes), '*', true];
    });
    mapSh.getRange(2, 1, rows.length, 7).setValues(rows);
    log.seeded = rows.length;
    try { PropertiesService.getScriptProperties().setProperty(SO_MIGRATE_FLAG, nowStr_()); } catch (e) {}
  } else {
    // Đã có dữ liệu: chỉ điền ItemCodes còn trống, không đè gì khác
    var vals = mapSh.getDataRange().getValues(), h = vals[0].map(String), iM = h.indexOf('MucSo'), iI = h.indexOf('ItemCodes');
    SO_SEED_.forEach(function (s) {
      if (!s[3].length) return;
      for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][iM]) === s[0] && parseCodes_(vals[r][iI]).length === 0) {
          var codes = seedCodes_(s, catalog);
          if (codes.length) { mapSh.getRange(r + 1, iI + 1).setValue(JSON.stringify(codes)); log.filled++; } else log.unmatched.push(s[0] + ' — ' + s[2]);
        }
      }
    });
  }
  CacheService.getScriptCache().put(schemaFlagKey_(), '1', 6 * 60 * 60); _flag = true;
  Logger.log(JSON.stringify(log, null, 2));
  return log;
}

/** Tạo tài khoản nhân viên mẫu vào Users_V2 (sửa tham số rồi chạy tay). */
function themNhanVienMau() {
  var sh = sheetReady_(SH.USERS);
  sh.appendRow(['nv_demo', '1234', 'NhanVien', 'TÊN CỬA HÀNG ĐÚNG Y NHƯ Store_Settings']);
}

// ============================================================================
// 9. PHÂN QUYỀN QUẢN LÝ CỬA HÀNG (Role = QuanLy) — duyệt từng khoản thu/chi + duyệt ca
//    Users_V2: Role = QuanLy ; Stores = "Gò Vấp" hoặc "Gò Vấp,Tân Bình" (nhiều cửa hàng cách nhau dấu phẩy, "*" = tất cả)
// ============================================================================
function mgrStores_(acc) {
  var s = String(acc.stores || '').trim();
  if (!s || s === '*') {
    var sh = sheetReady_(SH.STORE_SETTINGS), vals = sh.getDataRange().getValues(), iS = vals.length ? vals[0].indexOf('Store_Name') : -1, out = [];
    if (iS >= 0) for (var i = 1; i < vals.length; i++) if (vals[i][iS]) out.push(String(vals[i][iS]));
    return out;
  }
  return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}
function setCells_(sh, row, obj) {
  var m = hdr_(sh).map;
  Object.keys(obj).forEach(function (k) { if (m[k]) sh.getRange(row, m[k]).setValue(obj[k]); });
}
function qlCtx_(token, store) {
  var c = ctx_(token, store, false); if (c.err) return c;
  if (c.account.role !== 'QuanLy') return { err: fail_('Chỉ tài khoản Quản lý mới được duyệt.', 'FORBIDDEN') };
  return c;
}
/** Danh sách ca đang CHỜ DUYỆT của mọi cửa hàng người quản lý phụ trách (4 ngày gần nhất). */
function nvQlPending(token) {
  return safeRun_(function () {
    var acc = getAccountByToken_(token);
    if (!acc) return fail_('Phiên đăng nhập đã hết hạn.', 'EXPIRED');
    if (acc.role !== 'QuanLy') return fail_('Chỉ tài khoản Quản lý mới xem được danh sách duyệt.', 'FORBIDDEN');
    var stores = mgrStores_(acc), mine = {}; stores.forEach(function (s) { mine[s] = 1; });
    var days = {}; recentDays_().forEach(function (d) { days[d] = 1; });
    var sh = sheetReady_(SH.KETCA), last = lastRow_(sh), out = [];
    if (last >= 2) {
      var h = hdr_(sh), n = Math.min(1500, last - 1), width = Math.max(h.names.length, 1), vals = sh.getRange(last - n + 1, 1, n, width).getValues();
      var iS = h.map.Store - 1, iN = h.map.Ngay - 1, iC = h.map.Ca - 1, iT = h.map.TrangThai - 1, iK = h.map.NguoiKet - 1, iU = h.map.SubmittedAt - 1, iH = h.map.TongHop - 1;
      vals.forEach(function (r) {
        var st = String(r[iS]), ng = cellStr_(r[iN]);
        if (!mine[st] || !days[ng] || String(r[iT]) !== 'ChoDuyet') return;
        var rev = 0; try { rev = JSON.parse(String(r[iH] || '{}')).totals.revenue || 0; } catch (e) {}
        out.push({ store: st, ngay: ng, ca: String(r[iC]), nguoiKet: String(r[iK] || ''), submittedAt: String(r[iU] || ''), revenue: rev });
      });
    }
    out.sort(function (a, b) { return a.ngay < b.ngay ? 1 : a.ngay > b.ngay ? -1 : (a.store < b.store ? -1 : 1); });
    return ok_({ stores: stores, list: out });
  });
}
function qlCaLocked_(store, ngay, ca, fn, allow) {
  var key = store + '|' + ngay + '|' + ca, lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, thử lại sau vài giây.', 'BUSY');
  try {
    var kSh = sheetReady_(SH.KETCA), ketRow = exactRow_(kSh, 'Key_Id', key);
    if (!ketRow) return fail_('Không tìm thấy ca này.');
    var ket = readRowObjs_(kSh, [ketRow])[0];
    if (String(ket.TrangThai) !== (allow || 'ChoDuyet')) return fail_(allow ? 'Ca này chưa ở trạng thái đã duyệt.' : 'Ca này không còn ở trạng thái chờ duyệt (đã duyệt hoặc đã trả lại).', 'STATE');
    return fn(key, kSh, ketRow, ket);
  } finally { lock.releaseLock(); }
}
/** decision: DaDuyet | TuChoi | ChoDuyet. soQL (tùy chọn) = số tiền quản lý chỉnh lại. */
function nvQlLine(token, store, ngay, ca, lineId, decision, soQL, ghiChuQL) {
  return safeRun_(function () {
    var c = qlCtx_(token, store); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, false); if (bad) return bad;
    if (['DaDuyet', 'TuChoi', 'ChoDuyet'].indexOf(decision) === -1) return fail_('Quyết định không hợp lệ.');
    if (decision === 'TuChoi' && !String(ghiChuQL || '').trim()) return fail_('Từ chối khoản phải ghi lý do.');
    return qlCaLocked_(c.store, ngay, ca, function (key) {
      if (String(lineId).indexOf(key + '|') !== 0) return fail_('Khoản không thuộc ca này.');
      var tcSh = sheetReady_(SH.THUCHI), row = exactRow_(tcSh, 'Id', String(lineId));
      if (!row) return fail_('Không tìm thấy khoản thu/chi.');
      var hasSo = decision === 'DaDuyet' && soQL !== '' && soQL !== null && soQL !== undefined;
      setCells_(tcSh, row, { TrangThaiDong: decision, SoTienQL: hasSo ? num_(soQL) : '', GhiChuQL: safeText_(ghiChuQL, 300) });
      logAudit_(c.account.username, 'QL_DUYET_DONG', lineId, decision + (hasSo ? ' →' + soQL : ''));
      return ok_({});
    });
  });
}
/** V4 — QL duyệt/từ chối 1 mặt hàng bị nhân viên SỬA TỒN ĐẦU (khác tồn cuối ca trước). */
function nvQlTonDau(token, store, ngay, ca, muc, decision, ghiChuQL) {
  return safeRun_(function () {
    var c = qlCtx_(token, store); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, false); if (bad) return bad;
    if (['DaDuyet', 'TuChoi'].indexOf(decision) === -1) return fail_('Quyết định không hợp lệ.');
    if (decision === 'TuChoi' && !String(ghiChuQL || '').trim()) return fail_('Từ chối phải ghi lý do.');
    return qlCaLocked_(c.store, ngay, ca, function (key) {
      var tSh = sheetReady_(SH.TONKHO), row = exactRow_(tSh, 'Key_Id', key + '|' + String(muc));
      if (!row) return fail_('Không tìm thấy mặt hàng này trong ca.');
      setCells_(tSh, row, { TdDuyet: decision, TdDuyetBoi: c.account.username, TdGhiChuQL: safeText_(ghiChuQL, 300) });
      logAudit_(c.account.username, 'QL_DUYET_TON_DAU', key + '|' + muc, decision);
      return ok_({});
    });
  });
}
/** Duyệt cả ca: mọi khoản thu/chi phải đã được duyệt hoặc từ chối. Sau đó đánh dấu sẵn sàng đẩy về web vận hành. */
function nvQlDuyetCa(token, store, ngay, ca) {
  return safeRun_(function () {
    var c = qlCtx_(token, store); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, false); if (bad) return bad;
    return qlCaLocked_(c.store, ngay, ca, function (key, kSh, ketRow, ket) {
      var tcSh = sheetReady_(SH.THUCHI), rows = rowsByPrefix_(tcSh, 'Id', key + '|', true), objs = readRowObjs_(tcSh, rows);
      var open = objs.filter(function (o) { var t = String(o.TrangThaiDong || 'ChoDuyet'); return t !== 'DaDuyet' && t !== 'TuChoi'; }).length;
      if (open) return fail_('Còn ' + open + ' khoản thu/chi chưa duyệt. Hãy duyệt hoặc từ chối hết rồi mới duyệt ca.', 'INVALID');
      var tSh = sheetReady_(SH.TONKHO), tObjs = readRowObjs_(tSh, rowsByPrefix_(tSh, 'Key_Id', key + '|', true));
      var tdOpen = tObjs.filter(function (o) { return String(o.TdDuyet || '') === 'ChoDuyet'; }).length;
      var tdNo = tObjs.filter(function (o) { return String(o.TdDuyet || '') === 'TuChoi'; }).length;
      if (tdOpen) return fail_('Còn ' + tdOpen + ' mặt hàng bị sửa tồn đầu chưa duyệt.', 'INVALID');
      if (tdNo) return fail_('Có ' + tdNo + ' tồn đầu bị từ chối — hãy bấm "Trả lại ca" để nhân viên đếm lại.', 'INVALID');
      var now = nowStr_(), lan = num_(ket.LanDuyet) + 1, boSung = lan > 1 || String(ket.BoSung || '') !== '';
      rows.forEach(function (r) { setCells_(tcSh, r, { DaDoVaoKetCa: now }); });
      setCells_(kSh, ketRow, { TrangThai: 'DaDuyet', DuyetBoi: c.account.username, DuyetLuc: now, Version: num_(ket.Version) + 1, SavedAt: now, LanDuyet: lan, BoSung: '' });
      dirty_(SH.KETCA);
      logAudit_(c.account.username, 'QL_DUYET_KET_CA', key, 'v' + (num_(ket.Version) + 1) + ' lần ' + lan);
      var push = { pushed: false, why: 'chưa chạy' };
      try {
        var cd = loadDays_(c.store, [ngay], readMapSo_(c.store))[ngay].ca[ca];
        var lyDoMo = String(ket.BoSung || '');
        push = pushVanHanh_(c.store, ngay, ca, cd, c.account.username, lan, now);
        saveSoDuyet_(key, c.store, ngay, ca, lan, boSung ? 'Duyệt bổ sung' : 'Duyệt', String(ket.NguoiKet || ''), c.account.username, now, lyDoMo, cd, push);
      } catch (e) { push = { pushed: false, why: 'Lỗi khi đẩy sang vận hành: ' + e }; Logger.log('push fail ' + e); }
      return ok_({ status: 'DaDuyet', duyetLuc: now, lan: lan, loai: boSung ? 'Duyệt bổ sung' : 'Duyệt', push: push });
    });
  });
}
function nvQlTraLai(token, store, ngay, ca, lyDo) {
  return safeRun_(function () {
    var c = qlCtx_(token, store); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, false); if (bad) return bad;
    lyDo = safeText_(lyDo, 300); if (!lyDo.trim()) return fail_('Phải ghi lý do trả lại.');
    return qlCaLocked_(c.store, ngay, ca, function (key, kSh, ketRow, ket) {
      setCells_(kSh, ketRow, { TrangThai: 'TraLai', LyDoTraLai: lyDo, Version: num_(ket.Version) + 1, SavedAt: nowStr_() });
      dirty_(SH.KETCA);
      logAudit_(c.account.username, 'QL_TRA_LAI', key, lyDo);
      return ok_({ status: 'TraLai' });
    });
  });
}

// ============================================================================
// 9b. ĐẨY SANG WEB VẬN HÀNH · LƯU VẾT DUYỆT SỔ · MỞ LẠI SỬA BỔ SUNG · ĐỌC THÁNG ĐÃ LƯU TRỮ
//     Web vận hành đọc Data_KetCa_Ca theo Key_Id = Cửa hàng|Ngày|Ca. Các cột TienMat/CkNoti/Vi do vận hành tự tính từ Kiot nên KHÔNG đụng tới.
// ============================================================================
function tsStr_(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : String(v == null ? '' : v); }
function coldFileFor_(ngay) {
  var mk = String(ngay || '').slice(0, 7), sh = ss_().getSheetByName(SH.ARCH_INDEX);
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); }), iT = h.indexOf('Thang'), iF = h.indexOf('FileId'), iS = h.indexOf('TrangThai');
  if (iT < 0 || iF < 0 || iS < 0) return null;
  for (var i = 1; i < v.length; i++) if (cellStr_(v[i][iT]).slice(0, 7) === mk && String(v[i][iS]) === 'ARCHIVED' && v[i][iF]) return { fileId: String(v[i][iF]), mk: mk };
  return null;
}
function pushVanHanh_(store, ngay, ca, cd, who, lan, now) {
  if (coldFileFor_(ngay)) return { pushed: false, why: 'Tháng ' + ngay.slice(0, 7) + ' đã lưu trữ — nhập tay ở web vận hành.' };
  var sh = sheetReady_(SH.KETCA_VH), key = store + '|' + ngay + '|' + ca, h = hdr_(sh), map = h.map, width = Math.max(h.names.length, SCHEMAS[SH.KETCA_VH].length);
  var row = exactRow_(sh, 'Key_Id', key), cur = row ? sh.getRange(row, 1, 1, width).getValues()[0] : null;
  if (cur && map.NvDuyetLuc && map.SavedAt) {
    var nv = tsStr_(cur[map.NvDuyetLuc - 1]), sv = tsStr_(cur[map.SavedAt - 1]);
    if (nv && sv && sv > nv) return { pushed: false, why: 'Quản lý đã CHỐT ca này ở web vận hành sau lần duyệt trước — không ghi đè. Cần sửa thì sửa tay ở vận hành.' };
  }
  var by = {}; function add(k, amt, note, extra) { var o = { amt: amt, note: note || '' }; if (extra) Object.keys(extra).forEach(function (x) { o[x] = extra[x]; }); (by[k] = by[k] || []).push(o); }
  (cd.doc.thuchi || []).forEach(function (l) {
    if (l.tt === 'TuChoi') return;
    var amt = (l.soQL !== '' && l.soQL != null) ? num_(l.soQL) : num_(l.so); if (!(amt > 0)) return;
    var m = l.meta || {}, note = l.note || '';
    if (l.loai === 'CkAcbShip') add('CkAcbShip', amt, note, { loai: m.loai || 'le', payer: m.payer || 'khach', timing: m.timing || 'thuong', ngay: m.ngay || '' });
    else if (l.loai === 'ChiShipSi' || l.loai === 'ChiShipLe') add(l.loai, amt, note, { tt: false, ngay: '', ho: !!m.ct });
    else if (l.loai === 'ChiDienNuoc') add('ChiDienNuoc', amt, ({ dien: '[Điện] ', nuoc: '[Nước] ', wifi: '[Wifi] ' }[m.sub] || '') + note);
    else if (l.loai === 'NopVe' || l.loai === 'UngTien') { /* ghi sang Data_NopTien / Data_TamUng bên dưới */ }
    else if (l.loai === 'ChiKhac') add('ChiKhac', amt, note, { ho: !!m.ct });
    else add(l.loai, amt, note);
  });
  var A = (cd.doc.m2 === true) ? aggLines_(cd.doc.rows || [], priceMap_()) : null;
  if (A) A.items.forEach(function (x) { if (x.pay === 'CK') add('CkAcbShip', x.fee, 'Ship ' + String(x.ten).split(' — ').pop() + ' x' + x.q + (x.kh ? ' - ' + x.kh : ''), { loai: x.loai, payer: 'khach', timing: 'thuong', ngay: '' }); });
  var T = (cd.doc.tien || {}), gt = (cd.tongHop && cd.tongHop.giaiTrinh) || {};
  if (num_(T.duCk) > 0) add('DuCkNoti', num_(T.duCk), String(gt.NOTI || ''), { khach: '', khop: true });
  if (num_(T.thieuCk) > 0) add('ThieuCkNoti', num_(T.thieuCk), String(gt.NOTI || ''), { khach: '', khop: true });
  var MANAGED = ['TmThuKhac', 'CkCaNhanThuKhac', 'CkCaNhanBanh', 'TmBanhSale', 'CkAcbBanhSale', 'CkAcbShip', 'ChiShipSi', 'ChiShipLe', 'ChiShipTiktok', 'ChiDienNuoc', 'ChiKhac', 'ChiSuaChua', 'CongTyChi', 'DuCkNoti', 'ThieuCkNoti'];
  var vals = {}, detail = {};
  MANAGED.forEach(function (k) {
    var list = by[k] || [], sum = 0;
    list.forEach(function (x) { if (k !== 'CkAcbShip' || (x.payer === 'khach' && x.timing !== 'traTruoc')) sum += x.amt; });
    vals[k] = list.length ? sum : ''; if (list.length) detail[k] = list;
  });
  vals.CkNotiShip = num_(T.ckNotiShip) > 0 ? num_(T.ckNotiShip) : ''; vals.TmNopNoti = num_(T.tmNopNoti) > 0 ? num_(T.tmNopNoti) : '';
  vals.ChiTietKhac = JSON.stringify(detail);
  if (vals.ChiTietKhac.length > 49000) return { pushed: false, why: 'Chi tiết thu/chi quá dài để ghi vào vận hành.' };
  vals.NvDuyetBoi = who; vals.NvDuyetLuc = now; vals.NvLan = lan; vals.SavedAt = now;
  if (row) {
    Object.keys(vals).forEach(function (k) { if (map[k]) cur[map[k] - 1] = vals[k]; });
    sh.getRange(row, 1, 1, width).setValues([cur]);
  } else {
    var o = { Key_Id: key, Store: store, Ngay: ngay, Ca: ca }; Object.keys(vals).forEach(function (k) { o[k] = vals[k]; });
    upsertRow_(SH.KETCA_VH, 'Key_Id', key, o, 0);
  }
  dirty_(SH.KETCA_VH);
  try { pushTienMat_(store, ngay, ca, cd, now); } catch (e) { Logger.log('pushTienMat_ ' + e); }
  return { pushed: true, why: '', soKhoan: Object.keys(detail).reduce(function (n, k) { return n + detail[k].length; }, 0) };
}
/** Tiền mặt NỘP VỀ công ty → Data_NopTien; ỨNG tiền → Data_TamUng (Loai UNG). Khóa = Cửa hàng|Ngày|NV/TU + S/T + 8 ký tự cuối id khoản; khoản bị bỏ ở lần duyệt bổ sung thì xóa. */
function pushTienMat_(store, ngay, ca, cd, now) {
  var cc = ca === 'Sáng' ? 'S' : 'T', who = String(cd.nguoiKet || ''), lines = (cd.doc.thuchi || []).filter(function (l) { return l.tt !== 'TuChoi'; });
  [['NopVe', SH.NOP_TIEN, 'NV'], ['UngTien', SH.TAM_UNG, 'TU']].forEach(function (def) {
    var sh = sheetReady_(def[1]), pre = store + '|' + ngay + '|' + def[2] + cc, want = {};
    lines.filter(function (l) { return l.loai === def[0]; }).forEach(function (l) {
      var amt = (l.soQL !== '' && l.soQL != null) ? num_(l.soQL) : num_(l.so); if (!(amt > 0)) return;
      var key = pre + String(l.id).slice(-8); want[key] = 1;
      var o = def[0] === 'NopVe'
        ? { Key_Id: key, Store: store, Ngay: ngay, SoTien: amt, GhiChu: l.note || '', NguoiNop: who, SavedAt: now, CtyLayTm: (l.meta && l.meta.ct) ? 1 : '' }
        : { Key_Id: key, Store: store, Ngay: ngay, Loai: 'UNG', SoTien: amt, GhiChu: l.note || '', UngKey: '', NguoiLap: who, SavedAt: now };
      upsertRow_(def[1], 'Key_Id', key, o, 0);
    });
    var last = lastRow_(sh);
    if (last >= 2) {
      var kc = hdr_(sh).map.Key_Id, vals = sh.getRange(2, kc, last - 1, 1).getValues();
      for (var i = vals.length - 1; i >= 0; i--) { var k = String(vals[i][0]); if (k.indexOf(pre) === 0 && !want[k]) sh.deleteRow(i + 2); }
    }
    dirty_(def[1]);
  });
}
function saveSoDuyet_(key, store, ngay, ca, lan, loai, nguoiSua, nguoiDuyet, now, lyDo, cd, push) {
  var rows = (cd.doc.rows || []).filter(function (r) { return num_(r.tonDau) || num_(r.nhap) || num_(r.ban) || num_(r.xuat) || num_(r.tang) || r.kiem !== ''; })
    .map(function (r) { return { muc: r.muc, ten: r.ten, tonDau: r.tonDau, nhap: r.nhap, ban: r.ban, xuat: r.xuat, tang: r.tang, kiem: r.kiem, bl: r.bl || [], tdTt: r.tdTt || '' }; });
  var ct = JSON.stringify({ rows: rows, thuchi: cd.doc.thuchi, tien: cd.doc.tien, khachDat: cd.doc.khachDat });
  if (ct.length > 48000) ct = JSON.stringify({ thuchi: cd.doc.thuchi, tien: cd.doc.tien, cat: 'rút gọn vì quá dài' });
  var th = JSON.stringify(cd.tongHop || {}); if (th.length > 48000) th = '{}';
  var sid = genId_('SD');
  upsertRow_(SH.SODUYET, 'Id', sid, { Id: sid, Key_Id: key, Store: store, Ngay: ngay, Ca: ca, Lan: lan, Loai: loai, NguoiSua: nguoiSua, NguoiDuyet: nguoiDuyet, DuyetLuc: now,
    LyDo: lyDo, TongHop: th, ChiTiet: ct, DayVanHanh: push && push.pushed ? 'Đã đẩy' : ('Không đẩy: ' + (push && push.why || '')) }, 0);
}
/** QL mở lại 1 ca ĐÃ DUYỆT để nhân viên sửa bổ sung (bắt buộc lý do). Lần duyệt sau sẽ ghi "Duyệt bổ sung" kèm người sửa/người duyệt/ngày giờ. */
function nvQlMoLaiCa(token, store, ngay, ca, lyDo) {
  return safeRun_(function () {
    var c = qlCtx_(token, store); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, ca, false); if (bad) return bad;
    lyDo = safeText_(lyDo, 300); if (!lyDo.trim()) return fail_('Phải ghi lý do mở lại.');
    return qlCaLocked_(c.store, ngay, ca, function (key, kSh, ketRow, ket) {
      setCells_(kSh, ketRow, { TrangThai: 'TraLai', LyDoTraLai: 'MỞ LẠI SỬA BỔ SUNG: ' + lyDo, BoSung: lyDo, Version: num_(ket.Version) + 1, SavedAt: nowStr_() });
      dirty_(SH.KETCA);
      logAudit_(c.account.username, 'QL_MO_LAI_CA', key, lyDo);
      return ok_({ status: 'TraLai' });
    }, 'DaDuyet');
  });
}
/** Lịch sử duyệt của 1 ca (không kèm chi tiết nặng). */
function nvSoLichSu(token, store, ngay, ca) {
  return safeRun_(function () {
    var c = ctx_(token, store, false); if (c.err) return c.err;
    var sh = sheetReady_(SH.SODUYET), key = c.store + '|' + ngay + '|' + ca, fkey = c.store + '|' + ngay + '|Ngày', last = lastRow_(sh), out = [], files = [];
    if (last >= 2) {
      var h = hdr_(sh), n = Math.min(3000, last - 1), vals = sh.getRange(last - n + 1, 1, n, Math.max(h.names.length, 1)).getValues(), m = h.map;
      vals.forEach(function (r) { if (String(r[m.Key_Id - 1]) === fkey && String(r[m.Loai - 1]) === 'Lưu sổ') files.push({ lan: num_(r[m.Lan - 1]), luc: tsStr_(r[m.DuyetLuc - 1]), nguoi: String(r[m.NguoiSua - 1]), url: String(r[m.ChiTiet - 1]), kind: String(r[m.DayVanHanh - 1]), tt: String(r[m.LyDo - 1] || '') });
        if (String(r[m.Key_Id - 1]) === key) out.push({ lan: num_(r[m.Lan - 1]), loai: String(r[m.Loai - 1]), nguoiSua: String(r[m.NguoiSua - 1]), nguoiDuyet: String(r[m.NguoiDuyet - 1]), luc: tsStr_(r[m.DuyetLuc - 1]), lyDo: String(r[m.LyDo - 1] || ''), day: String(r[m.DayVanHanh - 1] || '') }); });
    }
    out.sort(function (a, b) { return a.lan - b.lan; });
    files.sort(function (a, b) { return b.lan - a.lan; });
    return ok_({ list: out, files: files });
  });
}
/** LƯU SỔ: nhận HTML sổ của cả ngày từ app → PDF (nếu chuyển được) lưu Drive, ghi vết vào Data_NV_SoDuyet. */
function nvLuuSo(token, store, ngay, html, tinhTrang) {
  return safeRun_(function () {
    var c = ctx_(token, store, false); if (c.err) return c.err;
    var bad = checkNgayCa_(ngay, null, false); if (bad) return bad;
    html = String(html || ''); if (html.length < 200 || html.length > 1500000) return fail_('Dữ liệu sổ không hợp lệ hoặc quá lớn.');
    var now = nowStr_(), name = 'SoKetCa_' + c.store.replace(/[^\w]+/g, '_') + '_' + ngay + '_' + now.replace(/[^\d]/g, '');
    var blob = Utilities.newBlob('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + name + '</title></head><body>' + html + '</body></html>', 'text/html', name + '.html'), file, kind = 'PDF';
    try { file = anhFolder_().createFile(blob.getAs('application/pdf').setName(name + '.pdf')); } catch (e) { kind = 'HTML'; file = anhFolder_().createFile(blob); }
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/file/d/' + file.getId() + '/view', key = c.store + '|' + ngay + '|Ngày', sh = sheetReady_(SH.SODUYET), last = lastRow_(sh), lan = 1;
    if (last >= 2) { var m = hdr_(sh).map, n = Math.min(3000, last - 1), v = sh.getRange(last - n + 1, 1, n, hdr_(sh).names.length).getValues(); v.forEach(function (r) { if (String(r[m.Key_Id - 1]) === key && String(r[m.Loai - 1]) === 'Lưu sổ') lan++; }); }
    var id = genId_('SD');
    upsertRow_(SH.SODUYET, 'Id', id, { Id: id, Key_Id: key, Store: c.store, Ngay: ngay, Ca: 'Ngày', Lan: lan, Loai: 'Lưu sổ', NguoiSua: c.account.username, NguoiDuyet: '', DuyetLuc: now, LyDo: safeText_(tinhTrang, 300), TongHop: '', ChiTiet: url, DayVanHanh: kind }, 0);
    logAudit_(c.account.username, 'LUU_SO', key, kind + ' lần ' + lan);
    return ok_({ url: url, kind: kind, lan: lan });
  });
}
/** Đọc 1 ngày của THÁNG ĐÃ LƯU TRỮ (file tháng do web vận hành tạo). Trả null nếu file/tab không có → dùng đường thường. */
function loadDayCold_(store, ngay, cold) {
  var ss; try { ss = SpreadsheetApp.openById(cold.fileId); } catch (e) { return null; }
  function tab(nm) {
    var t = ss.getSheetByName(nm); if (!t || t.getLastRow() < 2) return [];
    var v = t.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); }), out = [];
    for (var i = 1; i < v.length; i++) { var o = {}; h.forEach(function (n, k) { o[n] = v[i][k]; }); out.push(o); }
    return out;
  }
  var kets = tab('Data_NV_KetCa'), tons = tab('Data_NV_TonKho'), tcs = tab('Data_NV_ThuChi'), tiens = tab('Data_NV_TienCa');
  if (!kets.length && !tons.length) return null;
  var res = { ngay: ngay, ca: {}, opening: {}, extras: {}, luuTru: true };
  CA_LIST.forEach(function (ca) {
    var key = store + '|' + ngay + '|' + ca, pre = key + '|';
    var ket = kets.filter(function (o) { return String(o.Key_Id) === key; })[0] || null;
    res.ca[ca] = caDocFrom_(ket, ket ? tons.filter(function (o) { return String(o.Key_Id).indexOf(pre) === 0; }) : [], ket ? tcs.filter(function (o) { return String(o.Id).indexOf(pre) === 0; }) : [], ket ? (tiens.filter(function (o) { return String(o.Key_Id) === key; })[0] || null) : null);
    res.opening[ca] = {}; res.extras[ca] = [];
  });
  return res;
}

// ============================================================================
// 10. ẢNH SẢN PHẨM (lấy từ bảng sản phẩm của web tạo đơn khách sỉ)
//     Sửa IMG_SHEET_NAMES nếu sheet sản phẩm của web tạo đơn tên khác.
// ============================================================================
var IMG_SEED_ = [   // ảnh sản phẩm (nguồn: bảng sản phẩm của web tạo đơn). id = ItemCode trong Data_SanPham
  ['KT9001', 'Kem socola trái cây', 'https://lh3.googleusercontent.com/d/1_TkDiSgTKslRC8ryiHTjDsPXUBMTasxh'],
  ['BR0002', 'Bánh crepe sầu riêng set 2', 'https://lh3.googleusercontent.com/d/1imrCUbLKSWLIAeR0Yvne_d-LkRXXoCOY'],
  ['BR0003', 'Bánh crepe sầu riêng set 4', 'https://lh3.googleusercontent.com/d/1pItCPhq1i-LnFVnkIibPRM02Tf_OGaTa'],
  ['', 'Bánh crepe sầu riêng set 6', 'https://img.upanhnhanh.com/0cbf1c82ea50ad4c7a0cee5adf9996d4'],
  ['MX4001', 'Bánh mix 3 vị 12cm', 'https://lh3.googleusercontent.com/d/1JX9A5bysQFcK64Vdbr5fjZyk0crjQwYO'],
  ['MX4002', 'Bánh mix 3 vị 16cm', 'https://lh3.googleusercontent.com/d/1lgR2biOMjZH3UNpAcxHThETRZJH1klna'],
  ['BO2009', 'Bánh sầu riêng phú sĩ khoai môn 12cm', 'https://lh3.googleusercontent.com/d/1HJXz8NAgIyHnfc05G-tHJrys6gEez3cH'],
  ['BO2010', 'Bánh sầu riêng phú sĩ khoai môn 16cm', 'https://lh3.googleusercontent.com/d/1gLa8Wg1J5Z3w3-JXB5cP6fqT5JtoHi1y'],
  ['BO2011', 'Bánh sầu riêng phú sĩ lá dứa 12cm', 'https://lh3.googleusercontent.com/d/1AIVQRJVu92vP-O-ye9l3wwOnPLh5A94O'],
  ['BO2012', 'Bánh sầu riêng phú sĩ lá dứa 16cm', 'https://lh3.googleusercontent.com/d/1a4xeaElwsTxr4IGAdAWG9eu55QjJ5Exg'],
  ['BO2001', 'Bánh sầu riêng chocolate 12cm', 'https://lh3.googleusercontent.com/d/1dYny8hPbdUUuByz0Ug4bjCATQM2GmKmm'],
  ['BO2002', 'Bánh sầu riêng chocolate 16cm', 'https://lh3.googleusercontent.com/d/1iNR9OlRxHwBlBqlBWms8iyB0CczCfpY6'],
  ['BO2003', 'Bánh sầu riêng ngàn lớp truyền thống 12cm', 'https://lh3.googleusercontent.com/d/1l__hPNBqGDsvsR-PV1lvosHm0i4bafhG'],
  ['BO2004', 'Bánh sầu riêng ngàn lớp truyền thống 16cm', 'https://lh3.googleusercontent.com/d/1SFuAXaLpQ1VUD2Arrvb5dnkNudrXEqRn'],
  ['BO2007', 'Bánh sầu riêng phô mai than tre 12cm', 'https://lh3.googleusercontent.com/d/1zmbx_ZKQz177FmEdWasq8bWiH1LdtEiP'],
  ['BO2008', 'Bánh sầu riêng phô mai than tre 16cm', 'https://lh3.googleusercontent.com/d/1Nl1kI0Bdi5JRLf5jtJ8R5-nnNG0f9_rz'],
  ['BO2005', 'Bánh sầu riêng ngàn lớp xanh 12cm', 'https://lh3.googleusercontent.com/d/1gBvd8-MxoPrIi0YVW7lh2Py1kiShwHC6'],
  ['BO2006', 'Bánh sầu riêng ngàn lớp xanh 16cm', 'https://lh3.googleusercontent.com/d/1sv9VvRbDSg4UfPsrrIh0SDrc9erBbHKY']
];
var IMG_SHEET_NAMES = ['SanPham', 'Products', 'Data_Products', 'DanhMucSanPham', 'SanPham_Web'];
function nvGetImages(token) {
  return safeRun_(function () {
    if (!getAccountByToken_(token)) return fail_('Phiên đăng nhập đã hết hạn.', 'EXPIRED');
    var cache = CacheService.getScriptCache(), hit = cacheGetBig_('NV_IMG_V2');
    if (hit) { try { return ok_({ items: JSON.parse(hit) }); } catch (e) {} }
    var items = IMG_SEED_.map(function (x) { return { id: x[0], name: x[1], img: x[2] }; }), sh = null;   // ảnh có sẵn; sheet (nếu có) bổ sung/ghi đè
    for (var i = 0; i < IMG_SHEET_NAMES.length && !sh; i++) sh = ss_().getSheetByName(IMG_SHEET_NAMES[i]);
    if (sh) {
      var v = sh.getDataRange().getValues();
      if (v.length > 1) {
        var h = v[0].map(function (x) { return normName_(String(x)); });
        function col(re) { for (var k = 0; k < h.length; k++) if (re.test(h[k])) return k; return -1; }
        var cI = col(/^(id|ma|ma sp|itemcode|ma san pham)$/), cN = col(/^(ten|name|ten sp|itemname|ten san pham)/), cG = col(/(anh|img|image|hinh)/);
        if (cG >= 0) for (var r = 1; r < v.length; r++) {
          var u = String(v[r][cG] || '').trim(); if (!u) continue;
          items.push({ id: cI >= 0 ? String(v[r][cI] || '').trim() : '', name: cN >= 0 ? String(v[r][cN] || '') : '', img: u });
        }
      }
    }
    try { cachePutBig_('NV_IMG_V2', JSON.stringify(items), 3600); } catch (e) {}
    return ok_({ items: items });
  });
}
