/**
 * 9 SẠCH — TỦ BÁNH 3D  |  gas_code.gs
 * Dán toàn bộ file này vào Google Sheets → Tiện ích mở rộng → Apps Script.
 *
 *  - GET  ?action=products  → trả danh sách bánh (sheet "SanPham")
 *  - POST {action:"order"}  → ghi đơn vào sheet "DonHang", trừ tồn kho
 *
 * BƯỚC 1: chạy hàm setup() một lần (cấp quyền) để tạo 2 sheet mẫu.
 * BƯỚC 2: Triển khai → Triển khai mới → Ứng dụng web
 *         (Thực thi với tư cách: Tôi — Ai có quyền truy cập: Bất kỳ ai).
 * BƯỚC 3: Dán URL kết thúc bằng /exec vào src/config.js → gasUrl.
 */

var SHEET_PRODUCTS = 'SanPham';
var SHEET_ORDERS = 'DonHang';
var AUTO_DECREMENT_STOCK = true;   // true: tự trừ tồn kho khi có đơn
var MAX_QTY = 20;
var CACHE_SECONDS = 20;
var TZ = 'Asia/Ho_Chi_Minh';

var PRODUCT_HEADERS = ['id', 'name', 'price', 'desc', 'stock', 'color', 'type', 'image', 'active'];
var ORDER_HEADERS = ['Mã đơn', 'Thời gian', 'Mã bánh', 'Tên bánh', 'SL', 'Đơn giá', 'Thành tiền', 'Khách hàng', 'SĐT', 'Địa chỉ', 'Ghi chú', 'Trạng thái'];

/* ============ Tạo sheet mẫu (chạy 1 lần) ============ */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sp = ss.getSheetByName(SHEET_PRODUCTS) || ss.insertSheet(SHEET_PRODUCTS);
  if (sp.getLastRow() === 0) {
    sp.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]).setFontWeight('bold').setBackground('#e8f1ea');
    var rows = [
      ['sp1', 'Bông Lan Trứng Muối', 35000, 'Bông lan cuộn mềm xốp, sốt trứng muối béo mặn.', 12, '#f2c14e', 'roll', '', true],
      ['sp2', 'Tiramisu', 45000, 'Cà phê, kem mascarpone và lớp cacao đắng nhẹ.', 4, '#b07a54', 'round', '', true],
      ['sp3', 'Cupcake Dâu', 28000, 'Kem dâu tươi mịn trên nền bánh vani.', 0, '#f48fb1', 'cupcake', '', true],
      ['sp4', 'Bánh Mì Bơ Tỏi', 22000, 'Vỏ giòn, ruột mềm, thơm bơ tỏi nướng.', 9, '#d9a066', 'bread', '', true],
      ['sp5', 'Donut Matcha', 25000, 'Phủ matcha Nhật, rắc hạt màu vui mắt.', 2, '#8bc34a', 'donut', '', true],
      ['sp6', 'Red Velvet', 48000, 'Nhung đỏ ẩm mịn, kem phô mai chua nhẹ.', 7, '#c62839', 'round', '', true],
      ['sp7', 'Cuộn Cacao', 32000, 'Cuộn cacao đậm vị, nhân kem tươi.', 5, '#6d4430', 'roll', '', true],
      ['sp8', 'Cupcake Chanh Dây', 30000, 'Chua ngọt thanh mát, kem bơ chanh dây.', 15, '#ffd54a', 'cupcake', '', true]
    ];
    sp.getRange(2, 1, rows.length, PRODUCT_HEADERS.length).setValues(rows);
    sp.getRange(2, 6, 200, 1).setNumberFormat('@'); // cột color giữ dạng chữ (#rrggbb)
    sp.setFrozenRows(1);
    sp.autoResizeColumns(1, PRODUCT_HEADERS.length);
  }

  var od = ss.getSheetByName(SHEET_ORDERS) || ss.insertSheet(SHEET_ORDERS);
  if (od.getLastRow() === 0) {
    od.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]).setFontWeight('bold').setBackground('#fdf1d2');
    od.setFrozenRows(1);
    od.getRange(2, 9, 1000, 1).setNumberFormat('@'); // SĐT giữ số 0 đầu
  }
  SpreadsheetApp.getActive().toast('Đã tạo sheet SanPham và DonHang.');
}

/* ============ Trả dữ liệu ============ */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'products';
  if (action === 'products') {
    return json_({ success: true, data: { products: getProducts_(), updatedAt: new Date().toISOString() } });
  }
  return json_({ success: false, message: 'Hành động không hợp lệ.' });
}

/* ============ Nhận đơn ============ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ success: false, message: 'Hệ thống đang bận, vui lòng thử lại.' });
  }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'order') return json_({ success: false, message: 'Hành động không hợp lệ.' });

    // Ô bẫy cho bot: người thật không điền
    if (body.website) return json_({ success: true, data: { orderId: 'OK' } });

    var name = clean_(body.name, 80);
    var phone = clean_(body.phone, 20);
    var address = clean_(body.address, 200);
    var note = clean_(body.note, 300);
    var qty = Math.floor(Number(body.qty));
    var productId = clean_(body.productId, 40);

    if (name.length < 2) return json_({ success: false, message: 'Vui lòng nhập họ tên.' });
    if (!/^[0-9+\s.\-]{9,15}$/.test(phone)) return json_({ success: false, message: 'Số điện thoại chưa đúng.' });
    if (!qty || qty < 1 || qty > MAX_QTY) return json_({ success: false, message: 'Số lượng không hợp lệ.' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sp = ss.getSheetByName(SHEET_PRODUCTS);
    var od = ss.getSheetByName(SHEET_ORDERS);
    if (!sp || !od) return json_({ success: false, message: 'Chưa chạy setup() để tạo sheet.' });

    var values = sp.getDataRange().getValues();
    var head = values[0];
    var iId = head.indexOf('id'), iName = head.indexOf('name'), iPrice = head.indexOf('price');
    var iStock = head.indexOf('stock'), iActive = head.indexOf('active');
    var rowIdx = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][iId]) === productId) { rowIdx = r; break; }
    }
    if (rowIdx < 0) return json_({ success: false, message: 'Không tìm thấy bánh này.' });
    var row = values[rowIdx];
    if (String(row[iActive]).toUpperCase() === 'FALSE') return json_({ success: false, message: 'Bánh này đã ngừng bán.' });

    var stock = Number(row[iStock]) || 0;
    if (stock < qty) {
      return json_({ success: false, message: stock <= 0 ? 'Bánh này đã hết hàng.' : 'Chỉ còn ' + stock + ' cái.' });
    }

    var price = Number(row[iPrice]) || 0;            // giá lấy từ Sheet, không tin dữ liệu từ trình duyệt
    var orderId = 'DH' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + Math.floor(1000 + Math.random() * 9000);
    od.appendRow([
      orderId,
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
      productId, row[iName], qty, price, price * qty,
      name, phone, address, note, 'Mới'
    ]);
    if (AUTO_DECREMENT_STOCK) sp.getRange(rowIdx + 1, iStock + 1).setValue(stock - qty);
    CacheService.getScriptCache().remove('products');

    return json_({ success: true, data: { orderId: orderId, total: price * qty } });
  } catch (err) {
    return json_({ success: false, message: 'Lỗi: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

/* ============ Hàm phụ ============ */
function getProducts_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('products');
  if (hit) return JSON.parse(hit);

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  var h = v[0];
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var o = {};
    for (var c = 0; c < h.length; c++) o[h[c]] = v[r][c];
    if (!o.name) continue;
    if (String(o.active).toUpperCase() === 'FALSE') continue;
    out.push({
      id: String(o.id || ''), name: String(o.name), price: Number(o.price) || 0,
      desc: String(o.desc || ''), stock: Number(o.stock) || 0,
      color: String(o.color || '#e0a82e'), type: String(o.type || 'round'), image: String(o.image || '')
    });
  }
  cache.put('products', JSON.stringify(out), CACHE_SECONDS);
  return out;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
