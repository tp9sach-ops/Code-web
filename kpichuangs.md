/**
 * 9 SẠCH — BÁO CÁO KẾT QUẢ KINH DOANH (BẢN V5) — GIAI ĐOẠN 1
 * Code.gs — Nền tảng dữ liệu, tải chunk, CRUD, quản trị hệ thống
 * ============================================================================
 * Kiến trúc: Document-Oriented (Data_Doc) + CacheService cho master data +
 * LockService cho mọi thao tác ghi + generation token chống tải chồng chéo.
 * MỌI hàm server trả về {success, message} hoặc {success, data} — không throw
 * thẳng ra ngoài withFailureHandler.
 * ============================================================================
 */

// ============================================================================
// 0. HẰNG SỐ HỆ THỐNG
// ============================================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

const SHEET_NAMES = {
  DATA_DOC: 'Data_Doc',
  USERS: 'Users_V2',
  STORE_SETTINGS: 'Store_Settings',
  CHI_PHI: 'Data_ChiPhi',
  CONG_NO: 'Data_CongNo',
  ACTION_PLAN: 'Data_ActionPlan',
  KET_CA_CA: 'Data_KetCa_Ca',
  KET_CA_NGAY: 'Data_KetCa_Ngay',
  DU_KIEN: 'Data_DuKien',
  TON_KHO_SKU: 'Data_TonKhoSKU',       // Giai đoạn 3
  GOI_Y_DAT_HANG: 'Data_GoiYDatHang',   // Giai đoạn 3
  KHUYEN_MAI: 'Data_KhuyenMai',         // Giai đoạn 3
  AUDIT_LOG: 'Data_AuditLog',           // Giai đoạn 4
  MUC_TIEU: 'Data_MucTieu',             // Giai đoạn 4 — mục tiêu doanh thu theo tháng/cửa hàng
  IMPORT_HISTORY: 'Data_ImportHistory',  // Lịch sử nạp file Excel
  KET_CA_ANH: 'Data_KetCa_Anh',          // Ảnh tiền mặt / ảnh Noti kết ca (nhiều ảnh, có lịch sử)
  KHU_VUC: 'Data_KhuVuc',                // Giai đoạn 5 — chia cửa hàng theo khu vực
  KPI_KHU_VUC: 'Data_KpiKhuVuc',
  KPI_TRUONG_PHONG: 'Data_KpiTruongPhong',   // V56 — KPI Trưởng phòng KD (chỉ tài khoản vip)         // Giai đoạn 5 — KPI cá nhân + vi phạm nhập tay theo khu vực/tháng
  GIA_VON_SKU: 'Data_GiaVonSKU',         // Bảng giá vốn đơn vị theo từng SKU — dùng chung toàn hệ thống
  NHAN_VIEN: 'Data_NhanVien',            // Giai đoạn 6 — danh sách nhân viên bán hàng theo cửa hàng
  KPI_NHAN_VIEN: 'Data_KpiNhanVien',     // Giai đoạn 6 — chấm điểm hành vi + vi phạm theo nhân viên/tháng
  SUA_CHUA_PANA: 'Data_SuaChuaPana',     // Thống kê SL bán Sữa Chua & Panna theo ngày (cửa hàng 49 Hàng Bài)
  PHU_CAP: 'Data_PhuCap',                // Giai đoạn 6b — phụ cấp + tổng giờ công theo nhân viên/tháng
  CHI_PHI_CO_DINH_THANG: 'Data_ChiPhiCoDinhThang', // Giai đoạn 7 — Lợi Nhuận Ngày: chi phí cố định nhập theo tháng
  CONG_NHAT_NGAY: 'Data_CongNhatNgay',             // Giai đoạn 7 — Lợi Nhuận Ngày: công + lương theo nhân viên/ngày
  DOANH_THU_NGOAI_KIOT: 'Data_DoanhThuNgoaiKiot',  // Giai đoạn 7 — Lợi Nhuận Ngày: doanh thu ngoài Kiot theo ngày
  IMPORT_HISTORY_GIOCONG: 'Data_ImportHistoryGioCong', // Lịch sử nạp giờ công THEO NGÀY (khác lịch sử nạp KiotViet)
  SAN_PHAM: 'Data_SanPham',                        // Giai đoạn 8 — Danh mục sản phẩm KiotViet (Hàng hóa/Dịch vụ/Combo)
  USER_SETTINGS: 'Data_UserSettings',              // Giai đoạn 9 — lưu link Google Sheet riêng theo từng tài khoản
  TON_KHO_DOI_SOAT: 'Data_TonKhoDoiSoat',          // Giai đoạn 10 — kiểm kê thực tế & chênh lệch tồn kho
  TON_KHO_KET_CHUYEN: 'Data_TonKhoKetChuyen',      // Giai đoạn 10 — chênh lệch đã xác nhận kết chuyển vào chi phí
  BANH_SALE: 'Data_BanhSale',                       // Giai đoạn 11 — bánh sale (giảm giá bán gấp)
  XUAT_KHAC: 'Data_XuatKhac',                             // Xuất khác (hủy/tặng/trả…) chờ xác nhận & đã xác nhận
  TARGET_DIEU_CHINH: 'Data_TargetDieuChinh',        // Giai đoạn 13 — đề xuất điều chỉnh target theo mùa
  BANH_SALE_KIOT: 'Data_BanhSaleKiot',              // V51 — bánh sale theo Kiot (chỉ ghi thông tin)
  NOP_TIEN: 'Data_NopTien'                          // V51 — nộp tiền mặt về công ty
};
// Schema cột cho từng sheet — dùng để initSystemSheets() tự vá khi thiếu cột
const SHEET_SCHEMAS = {
  Data_Doc: ['DocId', 'Store', 'Ngay', 'MonthKey', 'InvoiceId', 'Revenue', 'Doc', 'ImportedAt'],
  Users_V2: ['Username', 'Password', 'Role', 'Stores'],
  Store_Settings: ['Store_Name', 'MatBang', 'Internet', 'DaDongCua', 'NgayDongCua'],
  Data_ChiPhi: ['Key_Id', 'Store', 'Thang', 'GiaVon', 'TonDau', 'TonCuoi', 'Luong', 'DienNuoc',
    'ChietKhauShopee', 'ChietKhauXanhSM', 'BHXH', 'ChiPhiKhac', 'MatBang', 'Internet', 'DoanhThuKhac', 'TonKhoChiTiet', 'SavedAt'],
  Data_CongNo: ['Id', 'Store', 'TenKhachHang', 'SoTien', 'TuoiNo', 'QuaHan', 'GhiChu'],
  Data_ActionPlan: ['Id', 'Moc', 'HanhDong', 'NguoiPhuTrach', 'Kpi', 'KetQuaKyVong', 'Nhom', 'Store', 'CreatedAt'],
  Data_KetCa_Ca: ['Key_Id', 'Store', 'Ngay', 'Ca', 'TienMat', 'CkNoti', 'Vi', 'CkCaNhanBanh', 'CkCaNhanThuKhac',
    'DuCkNoti', 'ThieuCkNoti', 'TmThuKhac', 'ChiShipSi', 'ChiShipLe', 'ChiShipTiktok',
    'ChiDienNuoc', 'ChiKhac', 'LyDoChi', 'AnhUrl', 'SavedAt', 'ChiTietKhac', 'CkAcbBanhSale', 'TmBanhSale', 'CkAcbShip', 'ChiSuaChua', 'CongTyChi'],
  Data_KetCa_Ngay: ['Key_Id', 'Store', 'Ngay', 'TienKet', 'SaleTm', 'SaleCk', 'NotiThucTe', 'AnhUrl', 'SavedAt'],
  Data_DuKien: ['Key_Id', 'Store', 'Thang', 'DoanhThuDuKien', 'GiaVonDuKien', 'ChiPhiCoDinhDuKien',
    'ChiPhiKhacDuKien', 'HoaVonDoanhThu', 'SavedAt'],
  Data_TonKhoSKU: ['Key_Id', 'Store', 'ItemCode', 'Ngay', 'TonDauNgay', 'NhapTrongNgay', 'TonCuoiNgay', 'SavedAt'],
  Data_GoiYDatHang: ['Key_Id', 'Store', 'ItemCode', 'Ngay', 'SlGoiY', 'SlThucDat', 'GhiChu', 'SavedAt'],
  Data_KhuyenMai: ['Id', 'TenSuKien', 'NgayBatDau', 'NgayKetThuc', 'Store', 'HeSoSuKien', 'GhiChu'],
  Data_AuditLog: ['Id', 'Timestamp', 'User', 'Action', 'Target', 'Detail'],
  Data_MucTieu: ['Key_Id', 'Store', 'Thang', 'MucTieuDoanhThu', 'GhiChu', 'SavedAt'],
  Data_ImportHistory: ['Id', 'FileName', 'ImportedAt', 'RowsInserted', 'RowsSkipped', 'User'],
  Data_KetCa_Anh: ['Id', 'Store', 'Ngay', 'Loai', 'Url', 'FileName', 'UploadedAt', 'UploadedBy'],
  Data_KhuVuc: ['Id', 'TenKhuVuc', 'Stores', 'SavedAt'],
  Data_KpiKhuVuc: ['Key_Id', 'KhuVucId', 'Thang', 'KpiCaNhan', 'ViPham', 'GhiChu', 'SavedAt', 'NgayCongPct', 'HeSoThangDacBiet', 'KpiCaNhanChiTiet'],
  Data_KpiTruongPhong: ['Key_Id', 'Thang', 'ViPham', 'GhiChu', 'NgayCongPct', 'HeSoThangDacBiet', 'SavedAt', 'NguoiLuu'],
  Data_GiaVonSKU: ['ItemCode', 'ItemName', 'DonGiaVon', 'SavedAt'],
  Data_NhanVien: ['Id', 'Store', 'HoTen', 'ThangBatDau', 'TrangThai', 'NgayNghiViec', 'GhiChu', 'SavedAt', 'LuongGio'],
  Data_KpiNhanVien: ['Key_Id', 'NhanVienId', 'Store', 'Thang', 'ChiTietLoi', 'DiemQuanLy', 'GhiChu', 'SavedAt'],
  Data_SuaChuaPana: ['Key_Id', 'Store', 'Ngay', 'SlSuaChua', 'SlPanna', 'SavedAt'],
  Data_PhuCap: ['Key_Id', 'NhanVienId', 'Store', 'Thang', 'LoaiPhuCap', 'SoTienPhuCap', 'TongGioCong', 'SavedAt', 'ChiTietPhuCap'],
  Data_ChiPhiCoDinhThang: ['Key_Id', 'Store', 'Thang', 'ChiPhiCoDinh', 'GhiChu', 'SavedAt'],
  Data_CongNhatNgay: ['Key_Id', 'NhanVienId', 'Store', 'Ngay', 'GioLam', 'LuongGio', 'ThanhTien', 'SavedAt', 'ChiTietCa'],
  Data_DoanhThuNgoaiKiot: ['Key_Id', 'Store', 'Ngay', 'SoTien', 'KyBaoCao', 'GhiChu', 'SavedAt'],
  Data_ImportHistoryGioCong: ['Id', 'FileName', 'ImportedAt', 'SoNhanVien', 'SoLuot', 'AffectedKeys', 'User'],
  Data_SanPham: ['ItemCode', 'ItemName', 'LoaiHang', 'NhomHang', 'GiaBan', 'GiaVonFile', 'ThanhPhan', 'DonGiaVon', 'SavedAt'],
  Data_UserSettings: ['Username', 'SheetLinks', 'SavedAt'],
  Data_TonKhoDoiSoat: ['Key_Id', 'Store', 'ItemCode', 'ItemName', 'Thang', 'TonCuoiThucTe', 'GhiChu', 'SavedAt'],
  Data_TonKhoKetChuyen: ['Key_Id', 'Store', 'ItemCode', 'ItemName', 'Thang', 'SoLuongChenhLech', 'GiaVonDonVi', 'GiaTriChenhLech', 'KetChuyenVaoMuc', 'GhiChu', 'NguoiXuLy', 'SavedAt'],
  Data_BanhSale: ['Key_Id', 'Store', 'Ngay', 'ItemCode', 'ItemName', 'SoLuong', 'TrangThai', 'NgayNhap', 'NgayRaDong', 'SoNgay',
    'GiaBanGoc', 'GiaSale', 'GiaVonDonVi', 'ThanhTienSale', 'ThanhTienGiaVon', 'LoiNhuanSale', 'GiaGiamTong',
    'DaGhiNhanChiPhi', 'GhiChu', 'SavedAt', 'Ca', 'HinhThucThu'],
  Data_XuatKhac: ['Key_Id', 'Store', 'Ngay', 'Loai', 'ItemCode', 'ItemName', 'SoLuong',
    'GiaVonDonVi', 'ThanhTienGiaVon', 'LyDo', 'GhiChu', 'DaGhiNhanChiPhi', 'Ca', 'HinhThucThu'],
  Data_TargetDieuChinh: ['Key_Id', 'Store', 'Thang', 'PhanTramDieuChinh', 'LyDo', 'SavedAt'],
  Data_BanhSaleKiot: ['Key_Id', 'Store', 'Ngay', 'ItemCode', 'ItemName', 'GiamPct', 'SoLuong', 'ThanhTien',
    'TrangThai', 'NgayNhap', 'NgayRaDong', 'SoNgay', 'GhiChu', 'SavedAt', 'NguoiCapNhat'],
  Data_NopTien: ['Key_Id', 'Store', 'Ngay', 'SoTien', 'GhiChu', 'NguoiNop', 'SavedAt', 'CtyLayTm']
};

// Cột phải luôn ép định dạng text để tránh Google Sheets tự convert Date
const TEXT_FORMAT_COLUMNS = {
  Data_Doc: ['Ngay', 'MonthKey', 'InvoiceId'],
  Data_ChiPhi: ['Thang'],
  Data_KetCa_Ca: ['Ngay'],
  Data_KetCa_Ngay: ['Ngay'],
  Data_DuKien: ['Thang'],
  Data_TonKhoSKU: ['Ngay'],
  Data_GoiYDatHang: ['Ngay'],
  Data_KhuyenMai: ['NgayBatDau', 'NgayKetThuc'],
  Data_MucTieu: ['Thang'],
  Store_Settings: ['NgayDongCua'],
  Data_KetCa_Anh: ['Ngay'],
  Data_KpiKhuVuc: ['Thang'],
  Data_KpiTruongPhong: ['Thang'],
  Data_NhanVien: ['ThangBatDau', 'NgayNghiViec'],
  Data_KpiNhanVien: ['Thang'],
  Data_SuaChuaPana: ['Ngay'],
  Data_PhuCap: ['Thang'],
  Data_ChiPhiCoDinhThang: ['Thang'],
  Data_CongNhatNgay: ['Ngay'],
  Data_DoanhThuNgoaiKiot: ['Ngay'],
  Data_TonKhoDoiSoat: ['Thang'],
  Data_TonKhoKetChuyen: ['Thang'],
  Data_BanhSale: ['Ngay', 'NgayNhap', 'NgayRaDong'],
  Data_XuatKhac: ['Ngay'],
  Data_TargetDieuChinh: ['Thang'],
  Data_BanhSaleKiot: ['Ngay', 'NgayNhap', 'NgayRaDong'],
  Data_NopTien: ['Ngay']
};
const APP_BUILD = '20261003a'; // ĐỔI chuỗi này mỗi lần deploy
const CACHE_KEYS = {
  MASTER_DATA: 'MASTER_DATA_V5_' + APP_BUILD,
  TOKEN_PREFIX: 'TOKEN_'
};

const CACHE_TTL = {
  MASTER_DATA_SEC: 60 * 60 * 3,   // 180 phút — giảm số lần phải đọc lại toàn bộ sheet cấu hình
  TOKEN_SEC: 60 * 60 * 12         // 12 tiếng — đăng nhập lại ít hơn
};

const RAW_DATA_CHUNK_SIZE = 20000;
const IMPORT_CHUNK_SIZE = 300;

// Tài khoản cứng dự phòng — chỉ dùng khi sheet Users_V2 lỗi/không đọc được
const FALLBACK_ACCOUNTS = [
  { username: 'vip', password: '9999', role: 'Admin', stores: '*' },
  { username: 'admin', password: '9sach@2026', role: 'Admin', stores: '*' }
];

// Cột bắt buộc tối thiểu khi import KiotViet Excel
const REQUIRED_IMPORT_COLUMNS = ['Chi nhánh', 'Mã hóa đơn', 'Thời gian', 'Tên hàng', 'Thành tiền', 'VAT hàng'];

// Hệ số z tra theo mức độ ưu tiên (service level) — dùng cho Giai đoạn 3 (Gợi Ý Đặt Hàng)
const SERVICE_LEVEL_Z = { thap: 0.52, trungbinh: 0.84, cao: 1.28 }; // 70% / 80% / 90%

// ============================================================================
// 1. TIỆN ÍCH DÙNG CHUNG — an toàn tuyệt đối, không throw ra ngoài
// ============================================================================

/**
 * Bọc mọi hàm server bằng safeRun để đảm bảo luôn trả {success, message/data}
 * dù bên trong có lỗi bất ngờ ở đâu (1 dòng dữ liệu rác không được làm sập cả app).
 */
function safeRun_(fn) {
  try {
    return fn();
  } catch (err) {
    Logger.log('safeRun_ error: ' + err + '\n' + (err.stack || ''));
    return { success: false, message: 'Lỗi hệ thống: ' + (err && err.message ? err.message : String(err)) };
  }
}

function ok_(data) {
  return { success: true, data: data };
}

function fail_(message) {
  return { success: false, message: message };
}

function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
}

function genId_(prefix) {
  return (prefix || 'ID') + '_' + Utilities.getUuid().slice(0, 8);
}

/** Lấy sheet theo tên, tạo mới nếu chưa tồn tại (không throw). */
function getOrCreateSheet_(name) {
  var sh = SS.getSheetByName(name);
  if (!sh) {
    sh = SS.insertSheet(name);
  }
  return sh;
}

/** Đảm bảo header đúng schema — chèn thêm cột thiếu ở cuối, không xoá cột lạ. */
function ensureSchema_(sh, schema) {
  if (!schema) return; // không để 1 sheet thiếu schema làm sập cả thao tác ghi
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var missing = schema.filter(function (col) { return header.indexOf(col) === -1; });
  if (header.join('') === '') {
    // sheet trống hoàn toàn — ghi thẳng header chuẩn
    sh.getRange(1, 1, 1, schema.length).setValues([schema]);
    return;
  }
  if (missing.length > 0) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
  }
}

/** Trả về map { colName: colIndex(1-based) } của 1 sheet theo header thực tế. */
function getHeaderMap_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return {};
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  header.forEach(function (name, idx) {
    var key = String(name || '').trim();
    if (key) map[key] = idx + 1; // 1-based
  });
  return map;
}

/** Ép định dạng text cho các cột chỉ định TRƯỚC khi ghi giá trị (chống Sheets auto-convert). */
function forceTextFormat_(sh, colIndexes, numRows, startRow) {
  colIndexes.forEach(function (colIdx) {
    if (colIdx) sh.getRange(startRow, colIdx, numRows, 1).setNumberFormat('@');
  });
}

// ============================================================================
// 2. KHỞI TẠO HỆ THỐNG
// ============================================================================

/**
 * Tạo/tự vá toàn bộ sheet nền tảng theo schema. Idempotent — gọi lại bao nhiêu
 * lần cũng an toàn. Chạy 1 lần khi mở app hoặc theo yêu cầu Admin.
 */
function initSystemSheets() {
  return safeRun_(function () {
    var props = PropertiesService.getScriptProperties();
    var lastInit = props.getProperty('SHEETS_INIT_AT');
    var now = Date.now();
    // Chỉ thực sự quét/tạo lại ~25 sheet mỗi 6 tiếng/lần — đây là nguyên nhân chính khiến
    // MỌI lần đăng nhập bị chậm (vòng lặp getRange/setValues qua từng sheet). Các lần đăng
    // nhập ở giữa khoảng 6 tiếng bỏ qua hẳn bước này, an toàn vì sheet đã được đảm bảo đúng.
    if (lastInit && (now - parseInt(lastInit, 10)) < 6 * 60 * 60 * 1000) {
      return ok_({ message: 'Đã kiểm tra gần đây — bỏ qua để tăng tốc.' });
    }
    Object.keys(SHEET_SCHEMAS).forEach(function (name) {
      var sh = getOrCreateSheet_(name);
      ensureSchema_(sh, SHEET_SCHEMAS[name]);
    });
    var usersSh = SS.getSheetByName(SHEET_NAMES.USERS);
    if (usersSh.getLastRow() <= 1) {
      var rows = FALLBACK_ACCOUNTS.map(function (a) { return [a.username, a.password, a.role, a.stores]; });
      usersSh.getRange(2, 1, rows.length, 4).setValues(rows);
    }
    invalidateMasterCache_();
    props.setProperty('SHEETS_INIT_AT', String(now));
    return ok_({ message: 'Đã khởi tạo/kiểm tra xong toàn bộ ' + Object.keys(SHEET_SCHEMAS).length + ' sheet hệ thống.' });
  });
}

/** Trả về "phiên bản dữ liệu" hiện tại — client dùng để biết có cần tải lại Data_Doc hay không. */
function getDataVersion(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var version = PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
    return ok_({ version: version });
  });
}
/** Gọi hàm này ở CUỐI mọi thao tác làm thay đổi Data_Doc — đánh dấu để client tải lại. */
function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(Date.now()));
}

function doGet() {
  var tpl = HtmlService.createTemplateFromFile('Index');
  return tpl.evaluate()
    .setTitle('9 Sạch — Báo Cáo Kết Quả Kinh Doanh')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================================
// 3. ĐĂNG NHẬP & TOKEN
// ============================================================================

function checkSystemLogin(username, password) {
  return safeRun_(function () {
    if (!username || !password) return fail_('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
    initSystemSheets(); // đảm bảo sheet tồn tại trước khi đọc

    var account = null;
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.USERS);
      var values = sh.getDataRange().getValues();
      var header = values[0];
      var idxU = header.indexOf('Username'), idxP = header.indexOf('Password'),
          idxR = header.indexOf('Role'), idxS = header.indexOf('Stores');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idxU]).trim() === username && String(values[i][idxP]).trim() === password) {
          account = { username: username, role: values[i][idxR], stores: values[i][idxS] };
          break;
        }
      }
    } catch (e) {
      Logger.log('Đọc Users_V2 lỗi, dùng fallback: ' + e);
    }

    if (!account) {
      var fb = FALLBACK_ACCOUNTS.filter(function (a) { return a.username === username && a.password === password; })[0];
      if (fb) account = { username: fb.username, role: fb.role, stores: fb.stores };
    }

    if (!account) return fail_('Sai tài khoản hoặc mật khẩu.');

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      CACHE_KEYS.TOKEN_PREFIX + token,
      JSON.stringify(account),
      CACHE_TTL.TOKEN_SEC
    );
    saveLongLivedToken_(token, account);
    return ok_({ token: token, role: account.role, stores: account.stores, username: account.username });
  });
}

/** Trả về account gắn với token, hoặc null nếu hết hạn/không hợp lệ. Dùng nội bộ. */
function getAccountByToken_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get(CACHE_KEYS.TOKEN_PREFIX + token);
  if (raw) return JSON.parse(raw);
  // Cache ngắn hạn đã hết hạn — thử lưu trữ dài hạn (đăng nhập 1 lần trên thiết bị)
  try {
    var raw2 = PropertiesService.getScriptProperties().getProperty(CACHE_KEYS.TOKEN_PREFIX + token);
    if (!raw2) return null;
    var rec = JSON.parse(raw2);
    if (rec.exp && rec.exp < Date.now()) {
      PropertiesService.getScriptProperties().deleteProperty(CACHE_KEYS.TOKEN_PREFIX + token);
      return null;
    }
    CacheService.getScriptCache().put(CACHE_KEYS.TOKEN_PREFIX + token, JSON.stringify(rec.account), CACHE_TTL.TOKEN_SEC);
    return rec.account;
  } catch (e) { return null; }
}

/**
 * Lọc danh sách cửa hàng theo quyền của account — QLCH chỉ thấy cửa hàng
 * được gán, dù client cố tình gửi tham số store khác.
 */
function filterStoresByPermission_(account, requestedStores) {
  if (!account) return [];
  if (account.role === 'Admin' || account.stores === '*') return requestedStores;
  var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return requestedStores.filter(function (s) { return allowed.indexOf(s) !== -1; });
}

// ============================================================================
// 4. MASTER DATA (KHÔNG BAO GỒM DATA_DOC) — có cache 30 phút
// ============================================================================

/** Google Sheets locale VN trả số thập phân dạng "8,33" -> đổi về "8.33" để parseFloat không cắt mất phần lẻ. */
function fixDecimalCols_(rows, cols) {
  rows.forEach(function (r) {
cols.forEach(function (c) {
  var v = r[c];
  if (typeof v === 'string' && /^-?\d+,\d+$/.test(v.trim())) r[c] = v.trim().replace(',', '.');
});
  });
  return rows;
}


// ============================================================================
// V72 — CACHE MASTER DATA CÓ VERSION (sửa lỗi "lưu xong tải lại trang thì mất số liệu")
// Lỗi cũ: người A đang đọc sheet (mất vài giây) thì người B lưu kết ca và xoá cache; người A đọc xong
// vẫn ghi bản CŨ vào cache 3 giờ -> mọi lần tải lại trong 3 giờ đó đều thấy dữ liệu cũ.
// Cách sửa: mỗi lần ghi tăng version; chỉ cache khi version không đổi từ lúc bắt đầu đọc.
// ============================================================================
function getMasterVersion_() {
  try { return PropertiesService.getScriptProperties().getProperty('MASTER_VER') || '0'; } catch (e) { return '0'; }
}
function invalidateMasterCache_() {
  try { PropertiesService.getScriptProperties().setProperty('MASTER_VER', String(Date.now()) + '_' + Math.floor(Math.random() * 1000)); } catch (e) {}
  try { CacheService.getScriptCache().remove(CACHE_KEYS.MASTER_DATA); } catch (e) {}
}

function getSystemMasterData(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');

    var cache = CacheService.getScriptCache();
    var masterVer = getMasterVersion_();                       // V72: cache gắn version, chống ghi đè dữ liệu cũ
    var masterKey = CACHE_KEYS.MASTER_DATA + '_v' + masterVer;
    var cached = cache.get(masterKey);
    var master;
    if (cached) {
      master = JSON.parse(cached);
    } else {
      initSystemSheets();
      master = {
        storeSettings: readSheetAsObjects_(SHEET_NAMES.STORE_SETTINGS),
        chiPhi: readSheetAsObjects_(SHEET_NAMES.CHI_PHI),
        congNo: readSheetAsObjects_(SHEET_NAMES.CONG_NO),
        actionPlan: readSheetAsObjects_(SHEET_NAMES.ACTION_PLAN),
        ketCaCa: readSheetAsObjects_(SHEET_NAMES.KET_CA_CA),
        ketCaNgay: readSheetAsObjects_(SHEET_NAMES.KET_CA_NGAY),
        duKien: readSheetAsObjects_(SHEET_NAMES.DU_KIEN),
        khuyenMai: readSheetAsObjects_(SHEET_NAMES.KHUYEN_MAI),
        tonKhoSKU: readSheetAsObjects_(SHEET_NAMES.TON_KHO_SKU),
        goiYDatHang: readSheetAsObjects_(SHEET_NAMES.GOI_Y_DAT_HANG),
        mucTieu: readSheetAsObjects_(SHEET_NAMES.MUC_TIEU),
        ketCaAnh: readSheetAsObjects_(SHEET_NAMES.KET_CA_ANH),
        khuVuc: readSheetAsObjects_(SHEET_NAMES.KHU_VUC),
        kpiKhuVuc: readSheetAsObjects_(SHEET_NAMES.KPI_KHU_VUC),
        kpiTruongPhong: readSheetAsObjects_(SHEET_NAMES.KPI_TRUONG_PHONG),
        giaVonSKU: readSheetAsObjects_(SHEET_NAMES.GIA_VON_SKU),
        nhanVien: (ensureNhanVienIds_(), fixDecimalCols_(readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN), ['LuongGio'])),
        kpiNhanVien: readSheetAsObjects_(SHEET_NAMES.KPI_NHAN_VIEN),
        suaChuaPana: readSheetAsObjects_(SHEET_NAMES.SUA_CHUA_PANA),
        phuCap: fixDecimalCols_(readSheetAsObjects_(SHEET_NAMES.PHU_CAP), ['TongGioCong', 'SoTienPhuCap']),
        chiPhiCoDinhThang: readSheetAsObjects_(SHEET_NAMES.CHI_PHI_CO_DINH_THANG),
        congNhatNgay: fixDecimalCols_(readSheetAsObjects_(SHEET_NAMES.CONG_NHAT_NGAY), ['GioLam', 'LuongGio', 'ThanhTien']),
        doanhThuNgoaiKiot: readSheetAsObjects_(SHEET_NAMES.DOANH_THU_NGOAI_KIOT),
        sanPham: readSheetAsObjects_(SHEET_NAMES.SAN_PHAM),
        tonKhoDoiSoat: readSheetAsObjects_(SHEET_NAMES.TON_KHO_DOI_SOAT),
        tonKhoKetChuyen: readSheetAsObjects_(SHEET_NAMES.TON_KHO_KET_CHUYEN),
        banhSale: readSheetAsObjects_(SHEET_NAMES.BANH_SALE),
        banhSaleKiot: readSheetAsObjects_(SHEET_NAMES.BANH_SALE_KIOT),
        nopTien: readSheetAsObjects_(SHEET_NAMES.NOP_TIEN),
        heSoLe: readHeSoLeSafe_(),
        nhapHang: filterRecentNhapHang_(readSheetAsObjects_('Data_NhapHang')),
        xuatKhac: readSheetAsObjects_(SHEET_NAMES.XUAT_KHAC),
        tonKhongBill: readSheetAsObjects_('Data_TonKhongBill'),
        tonKhoKiot: readSheetAsObjects_('Data_TonKhoKiot'),
        targetDieuChinh: readSheetAsObjects_(SHEET_NAMES.TARGET_DIEU_CHINH),
        rawDataTotal: getDataDocSheet_().getLastRow() > 1 ? getDataDocSheet_().getLastRow() - 1 : 0
      };
      // Cache toàn bộ trừ dữ liệu hoá đơn (đã tách riêng theo kiến trúc bắt buộc)
      try {
        // V72: nếu trong lúc đọc sheet có người vừa ghi (version đổi) thì KHÔNG cache bản đã cũ này
        if (getMasterVersion_() === masterVer) cache.put(masterKey, JSON.stringify(master), CACHE_TTL.MASTER_DATA_SEC);
      } catch (e) {
        Logger.log('Không cache được master data (có thể vượt 100KB/entry): ' + e);
      }
    }

    // Lọc theo quyền cửa hàng ngay ở tầng trả kết quả — QLCH không thấy CH khác
    var allStores = master.storeSettings.map(function (s) { return s.Store_Name; });
    var visibleStores = filterStoresByPermission_(account, allStores);
    var visibleSet = {};
    visibleStores.forEach(function (s) { visibleSet[s] = true; });

    function keep(list, storeField) {
      if (account.role === 'Admin') return list;
      return list.filter(function (r) { return visibleSet[r[storeField]]; });
    }

    return ok_({
      role: account.role,
      stores: visibleStores,
      storeSettings: master.storeSettings.filter(function (s) { return account.role === 'Admin' || visibleSet[s.Store_Name]; }),
      chiPhi: keep(master.chiPhi, 'Store'),
      congNo: keep(master.congNo, 'Store'),
      actionPlan: keep(master.actionPlan, 'Store'),
      ketCaCa: keep(master.ketCaCa, 'Store'),
      ketCaNgay: keep(master.ketCaNgay, 'Store'),
      duKien: keep(master.duKien, 'Store'),
      khuyenMai: master.khuyenMai,
      tonKhoSKU: keep(master.tonKhoSKU, 'Store'),
      goiYDatHang: keep(master.goiYDatHang, 'Store'),
      mucTieu: keep(master.mucTieu, 'Store'),
      ketCaAnh: keep(master.ketCaAnh, 'Store'),
      // Khu vực/KPI liên quan thưởng tiền — chỉ trả về cho Admin, tránh lộ ra tài khoản QLCH.
      khuVuc: account.role === 'Admin' ? master.khuVuc : [],
      kpiKhuVuc: account.role === 'Admin' ? master.kpiKhuVuc : [],
      kpiTruongPhong: isVipAccount_(account) ? (master.kpiTruongPhong || []) : [],
      // Bảng giá vốn SKU không phải dữ liệu nhạy cảm — trả cho MỌI vai trò để QLCH cũng tự tính
      // được "Giá trị mua hàng trong tháng" của cửa hàng mình ngay trên trình duyệt.
      giaVonSKU: master.giaVonSKU,
      // Nhân viên & KPI hành vi — lọc theo quyền cửa hàng như Kết Ca, để QLCH quản lý đúng nhân viên của mình.
      nhanVien: keep(master.nhanVien, 'Store'),
      kpiNhanVien: keep(master.kpiNhanVien, 'Store'),
      suaChuaPana: keep(master.suaChuaPana, 'Store'),
      phuCap: keep(master.phuCap, 'Store'),
      chiPhiCoDinhThang: keep(master.chiPhiCoDinhThang, 'Store'),
      congNhatNgay: keep(master.congNhatNgay, 'Store'),
      doanhThuNgoaiKiot: keep(master.doanhThuNgoaiKiot, 'Store'),
      // Hệ số lương ngày lễ x2/x3 — áp dụng cả chuỗi, trả cho MỌI vai trò (trước đây thiếu dòng này nên tải lại là mất x2)
      heSoLe: master.heSoLe || [],
      // Danh mục sản phẩm + giá vốn: trả cho mọi vai trò để QLCH tự tính giá vốn trên trình duyệt.
      sanPham: master.sanPham || [],
      tonKhoDoiSoat: keep(master.tonKhoDoiSoat, 'Store'),
      tonKhoKetChuyen: keep(master.tonKhoKetChuyen, 'Store'),
      banhSale: keep(master.banhSale, 'Store'),
      banhSaleKiot: keep(master.banhSaleKiot || [], 'Store'),
      nopTien: keep(master.nopTien || [], 'Store'),
      nhapHang: keep(master.nhapHang || [], 'Store'),
      xuatKhac: keep(master.xuatKhac || [], 'Store'),
      tonKhongBill: keep(master.tonKhongBill || [], 'Store'),
      tonKhoKiot: keep(master.tonKhoKiot || [], 'Store'),
      targetDieuChinh: keep(master.targetDieuChinh || [], 'Store'),
      rawDataTotal: master.rawDataTotal
    });
  });
}

function readSheetAsObjects_(sheetName) {
  var sh = SS.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var range = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  var values = range.getDisplayValues(); // display values để giữ nguyên text đã ép '@'
  var header = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    var empty = true;
    for (var c = 0; c < header.length; c++) {
      row[header[c]] = values[i][c];
      if (String(values[i][c]).trim() !== '') empty = false;
    }
    if (!empty) out.push(row);
  }
  return out;
}

function getDataDocSheet_() {
  return getOrCreateSheet_(SHEET_NAMES.DATA_DOC);
}

// ============================================================================
// 5. TẢI DỮ LIỆU HOÁ ĐƠN THEO CHUNK (Data_Doc) — KHÔNG BAO GIỜ gộp vào master data
// ============================================================================

/**
 * offset/limit theo DÒNG DỮ LIỆU (không tính header). Trả {done, rows, nextOffset}.
 * Client gọi đệ quy tới khi done=true, có generation token riêng ở phía client
 * để huỷ vòng lặp cũ khi người dùng bấm "Làm mới" giữa chừng.
 */
function getRawDataChunk(token, offset, limit) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');

    limit = limit || RAW_DATA_CHUNK_SIZE;
    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    var totalDataRows = lastRow > 1 ? lastRow - 1 : 0;
    if (offset >= totalDataRows) {
      return ok_({ done: true, rows: [], nextOffset: offset, total: totalDataRows });
    }

    var startRow = offset + 2; // +1 header, +1 vì offset 0-based
    var numRows = Math.min(limit, totalDataRows - offset);
    var map = getHeaderMap_(sh);
    var docColIdx = map['Doc'];
    var storeColIdx = map['Store'];
    var values = sh.getRange(startRow, 1, numRows, sh.getLastColumn()).getValues();

    // Tính danh sách cửa hàng được phép 1 LẦN trước vòng lặp (thay vì split()/map() lại
    // hàng nghìn lần mỗi chunk cho tài khoản QLCH) — nguyên nhân chính khiến tải dữ liệu
    // chậm với tài khoản không phải Admin.
    // FIX: tài khoản có Stores = '*' (toàn chuỗi) phải được xem tất cả — đồng bộ với filterStoresByPermission_.
    // Trước đây role trống/khác 'Admin' + Stores '*' => allowedSet = {'*':true} => lọc sạch 100% hoá đơn => doanh thu 0đ.
    var allowedSet = null;
    var storesRaw = String(account.stores || '').trim();
    if (account.role !== 'Admin' && storesRaw !== '*') {
      allowedSet = {};
      storesRaw.split(',').forEach(function (s) { allowedSet[s.trim()] = true; });
    }

    var rows = [];
    for (var i = 0; i < values.length; i++) {
      var storeName = values[i][storeColIdx - 1];
      // Lọc theo quyền ngay tại nguồn — QLCH không tải được doc của CH khác dù sửa offset
      if (allowedSet && !allowedSet[storeName]) continue;
      try {
        var docJson = JSON.parse(values[i][docColIdx - 1]);
        rows.push(docJson);
      } catch (e) {
        // 1 dòng JSON hỏng không được làm sập cả chunk — bỏ qua và ghi log
        Logger.log('Bỏ qua dòng Data_Doc lỗi JSON tại row ' + (startRow + i) + ': ' + e);
      }
    }

    var nextOffset = offset + numRows;
    return ok_({ done: nextOffset >= totalDataRows, rows: rows, nextOffset: nextOffset, total: totalDataRows });
  });
}

// ============================================================================
// 6. IMPORT DỮ LIỆU KIOTVIET (chunk 300 dòng, LockService khi ghi)
// ============================================================================

/** Kiểm tra header file KiotViet đủ cột bắt buộc chưa. Gọi từ client trước khi import. */
function validateImportHeader(headerRow) {
  return safeRun_(function () {
    var missing = REQUIRED_IMPORT_COLUMNS.filter(function (c) { return headerRow.indexOf(c) === -1; });
    if (missing.length > 0) {
      return fail_('Thiếu cột bắt buộc: ' + missing.join(', ') + '. Vui lòng kiểm tra lại file export KiotViet.');
    }
    return ok_({ valid: true });
  });
}

/**
 * Nạp 1 lô (chunk) dòng đã được client phân tích sẵn từ Excel (mảng object theo
 * tên cột gốc KiotViet). Server chỉ chịu trách nhiệm chuẩn hoá + ghi an toàn.
 * rows: mảng các object { 'Chi nhánh':..., 'Mã hóa đơn':..., ... }
 */
function importDocChunk(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ inserted: 0, skipped: 0 });

    var lock = LockService.getScriptLock();
    var gotLock = lock.tryLock(20000);
    if (!gotLock) return fail_('Hệ thống đang bận ghi dữ liệu khác, vui lòng thử lại sau ít giây.');

    try {
      var sh = getDataDocSheet_();
      var out = [];
      var skipped = 0;
      var seqByInvoice = {};

      rows.forEach(function (r) {
        try {
          var branch = String(r['Chi nhánh'] || '').trim();
          var invoiceId = String(r['Mã hóa đơn'] || '').trim();
          var itemCode = String(r['Mã hàng'] || '').trim();
          var tsRaw = r['Thời gian'];
          if (!branch || !invoiceId || !tsRaw) { skipped++; return; }

          var tsParts = parseKiotVietTimestampParts_(tsRaw);
          if (!tsParts) { skipped++; return; }

          var ngay = tsParts.y + '-' + pad2Server_(tsParts.mo) + '-' + pad2Server_(tsParts.d);
          var monthKey = tsParts.y + '-' + pad2Server_(tsParts.mo);
          // Doanh thu hiển thị = Thành tiền (chưa VAT) + VAT hàng — đúng số tiền khách thực trả.
          var thanhTien = parseNumber_(r['Thành tiền']);
          var vatHang = parseNumber_(r['VAT hàng']);
          var revenue = thanhTien + vatHang;
          var seqKey = branch + '|' + invoiceId + '|' + itemCode;
          seqByInvoice[seqKey] = (seqByInvoice[seqKey] || 0) + 1;
          var seq = seqByInvoice[seqKey];
          var docId = branch + '|' + invoiceId + '|' + itemCode + '|' + seq;

          var docObj = {
            branch: branch,
            invoiceId: invoiceId,
            timestamp: ngay + ' ' + pad2Server_(tsParts.h) + ':' + pad2Server_(tsParts.mi) + ':00',
            day: ngay,
            dow: dowFromParts_(tsParts.y, tsParts.mo, tsParts.d), // 0=CN..6=Thứ 7
            hour: tsParts.h,
            monthKey: monthKey,
            customerName: r['Tên khách hàng'] || '',
            customerPhone: r['Điện thoại'] || '',
            priceTable: r['Bảng giá'] || '',
            salesChannel: r['Kênh bán'] || 'Trực tiếp',
            staffName: r['Người tạo'] || '',
            itemCode: itemCode,
            itemName: r['Tên hàng'] || '',
            qty: parseNumber_(r['Số lượng']),
            thanhTienTruocVat: thanhTien,
            vatHang: vatHang,
            giaGiamHang: parseNumber_(r['Giảm giá']),
            giamGiaPct: parseNumber_(r['Giảm giá %'] !== undefined ? r['Giảm giá %'] : (r['Giảm giá (%)'] !== undefined ? r['Giảm giá (%)'] : r['GG %'])),
            revenue: revenue,
            tienMat: parseNumber_(r['Tiền mặt']),
            the: parseNumber_(r['Thẻ']),
            vi: parseNumber_(r['Ví']),
            chuyenKhoan: parseNumber_(r['Chuyển khoản'])
          };

          out.push([docId, branch, ngay, monthKey, invoiceId, revenue, JSON.stringify(docObj), nowStr_()]);
        } catch (rowErr) {
          skipped++;
          Logger.log('Bỏ qua 1 dòng import lỗi: ' + rowErr);
        }
      });

      if (out.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, out.length, out[0].length).setValues(out);
        // Ép text cho Ngay(3), MonthKey(4), InvoiceId(5) — cột 1-based tương ứng
        forceTextFormat_(sh, [3, 4, 5], out.length, startRow);
      }

      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ inserted: out.length, skipped: skipped });
    } finally {
      lock.releaseLock();
    }
  });
}

function parseNumber_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Parse "Thời gian" KiotViet thành các THÀNH PHẦN NGÀY GIỜ THUẦN {y, mo, d, h, mi} —
 * KHÔNG dựng Date rồi đọc lại bằng getHours()/getDay(), vì cách đọc đó phụ thuộc múi giờ
 * mặc định của runtime (V8 Apps Script coi mọi Date theo cách khác Rhino cũ), dễ gây lệch
 * giờ/lệch ngày so với dữ liệu gốc trong Excel — đây chính là nguyên nhân khung giờ bị sai.
 * Trả về null nếu không parse được. mo: 1-12 (không phải 0-11).
 */
function parseKiotVietTimestampParts_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // Đọc bằng getUTC*: đối tượng Date do Sheets trả về qua getValues() luôn giữ đúng
    // con số ngày/giờ đã hiển thị trên ô tính theo UTC — tránh mọi lệch múi giờ runtime.
    return { y: raw.getUTCFullYear(), mo: raw.getUTCMonth() + 1, d: raw.getUTCDate(), h: raw.getUTCHours(), mi: raw.getUTCMinutes() };
  }
  // Excel serial date số thuần (trường hợp client đọc không kèm cellDates:true)
  if (typeof raw === 'number' && isFinite(raw)) {
    var epochMs = Date.UTC(1899, 11, 30);
    var d0 = new Date(epochMs + Math.round(raw * 86400000));
    if (isNaN(d0.getTime())) return null;
    return { y: d0.getUTCFullYear(), mo: d0.getUTCMonth() + 1, d: d0.getUTCDate(), h: d0.getUTCHours(), mi: d0.getUTCMinutes() };
  }
  var s = String(raw || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2})?:?(\d{1,2})?/);
  if (m) {
    return { y: parseInt(m[3], 10), mo: parseInt(m[2], 10), d: parseInt(m[1], 10), h: parseInt(m[4] || '0', 10), mi: parseInt(m[5] || '0', 10) };
  }
  var d2 = new Date(s);
  if (isNaN(d2.getTime())) return null;
  return { y: d2.getUTCFullYear(), mo: d2.getUTCMonth() + 1, d: d2.getUTCDate(), h: d2.getUTCHours(), mi: d2.getUTCMinutes() };
}

/** Thứ trong tuần (0=CN..6=Thứ7) tính bằng Date.UTC thuần — không phụ thuộc múi giờ runtime. */
function dowFromParts_(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}
function pad2Server_(n) { return (n < 10 ? '0' : '') + n; }

/** Xoá riêng các hoá đơn có mã bắt đầu "HDO" của 1 (Cửa hàng, Ngày) khỏi Data_Doc — giữ nguyên các hoá đơn khác trong ngày đó. */
function deleteHdoInvoicesByStoreDay(token, store, ngay) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(store) === -1) return fail_('Bạn không có quyền xoá dữ liệu cửa hàng này.');
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ deleted: 0 });
      var map = getHeaderMap_(sh);
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var keepRows = [];
      var deleted = 0;
      values.forEach(function (row) {
        var rowStore = row[map['Store'] - 1];
        var rowNgay = row[map['Ngay'] - 1];
        var invoiceId = row[map['InvoiceId'] - 1];
        var isHdo = /^HDO/i.test(String(invoiceId || '').trim());
        if (rowStore === store && rowNgay === ngay && isHdo) {
          deleted++;
        } else {
          keepRows.push(row);
        }
      });
      if (deleted > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) {
          sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          forceTextFormat_(sh, [3, 4, 5], keepRows.length, 2);
        }
      }
      logAudit_(account.username, 'XOA_HOA_DON_HDO', store + ' | ' + ngay, deleted + ' hoá đơn HDO bị xoá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ deleted: deleted });
    } finally {
      lock.releaseLock();
    }
  });
}


/**
 * Xoá TOÀN BỘ hoá đơn của danh sách (Cửa hàng, Ngày) trước khi nạp lại — dùng khi nạp đè file
 * KiotViet mới để tránh cộng dồn/trùng giảm giá & VAT với dữ liệu cũ. KHÔNG đụng tới Data_KetCa_Ca,
 * Data_KetCa_Ngay hay bất kỳ sheet Kết Ca nào — chỉ xoá đúng các dòng Data_Doc khớp Store+Ngay.
 * pairsJson: JSON.stringify([{store, ngay}, ...])
 */
function deleteDataDocByStoreDays(token, pairsJson) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var pairs;
    try { pairs = JSON.parse(pairsJson) || []; } catch (e) { return fail_('Dữ liệu (cửa hàng, ngày) không hợp lệ.'); }
    if (pairs.length === 0) return ok_({ deleted: 0 });
    var keySet = {};
    pairs.forEach(function (p) {
      if (account.role !== 'Admin') {
        var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
        if (allowed.indexOf(p.store) === -1) return;
      }
      keySet[p.store + '|' + p.ngay] = true;
    });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ deleted: 0 });
      var map = getHeaderMap_(sh);
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var keepRows = [];
      var deleted = 0;
      values.forEach(function (row) {
        var k = row[map['Store'] - 1] + '|' + row[map['Ngay'] - 1];
        if (keySet[k]) deleted++; else keepRows.push(row);
      });
      if (deleted > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) {
          sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          forceTextFormat_(sh, [3, 4, 5], keepRows.length, 2);
        }
      }
      logAudit_(account.username, 'XOA_DU_LIEU_TRUOC_KHI_NAP_LAI', Object.keys(keySet).join(' ; '), deleted + ' dòng hoá đơn cũ đã xoá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ deleted: deleted });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Xoá sạch toàn bộ Data_Doc — chỉ Admin. */
function clearAllDataDoc(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account || account.role !== 'Admin') return fail_('Chỉ Admin mới được xoá toàn bộ dữ liệu.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
      logAudit_(account.username, 'XOA_TOAN_BO_DATA_DOC', 'Data_Doc', 'Xoá toàn bộ ' + Math.max(0, lastRow - 1) + ' dòng');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ message: 'Đã xoá toàn bộ Data_Doc.' });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Trả về bảng phủ dữ liệu theo ngày (calendar grid) — đếm số hoá đơn theo store|ngày. */
function getDataCoverage(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({});
    var map = getHeaderMap_(sh);
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var allowedSet = null;
    if (account.role !== 'Admin') {
      allowedSet = {};
      String(account.stores || '').split(',').forEach(function (s) { allowedSet[s.trim()] = true; });
    }
    var coverage = {}; // { store: { ngay: count } }
    values.forEach(function (row) {
      var store = row[map['Store'] - 1];
      var ngay = row[map['Ngay'] - 1];
      if (allowedSet && !allowedSet[store]) return;
      coverage[store] = coverage[store] || {};
      coverage[store][ngay] = (coverage[store][ngay] || 0) + 1;
    });
    return ok_(coverage);
  });
}

/** Xoá toàn bộ Ca Sáng/Ca Tối/Tiền Két của 1 (Cửa hàng, Ngày) — dùng cho sửa/xoá ở bảng Tổng hợp tháng. */
function deleteKetCaDay(token, store, ngay) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var deleted = 0;
      [SHEET_NAMES.KET_CA_CA, SHEET_NAMES.KET_CA_NGAY].forEach(function (sheetName) {
        var sh = SS.getSheetByName(sheetName);
        if (!sh) return;
        var lastRow = sh.getLastRow();
        if (lastRow < 2) return;
        var map = getHeaderMap_(sh);
        var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
        var keepRows = [];
        values.forEach(function (row) {
          if (row[map['Store'] - 1] === store && row[map['Ngay'] - 1] === ngay) deleted++;
          else keepRows.push(row);
        });
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
      });
      logAudit_(account.username, 'XOA_KET_CA_NGAY', store + ' | ' + ngay, deleted + ' dòng bị xoá');
      invalidateMasterCache_();
      return ok_({ deleted: deleted });
    } finally { lock.releaseLock(); }
  });
}

/** Hàm CRUD tổng quát theo Key_Id/Id — upsert nếu key đã tồn tại, thêm mới nếu chưa. */
function upsertRowByKey_(sheetName, keyField, rowObj) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
  try {
    var sh = getOrCreateSheet_(sheetName);
    ensureSchema_(sh, SHEET_SCHEMAS[sheetName]);
    var map = getHeaderMap_(sh);
    var keyColIdx = map[keyField];
    if (!rowObj[keyField]) rowObj[keyField] = genId_(sheetName);
    rowObj.SavedAt = nowStr_();

    var lastRow = sh.getLastRow();
    var foundRow = -1;
    if (lastRow > 1 && keyColIdx) {
      var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i][0]) === String(rowObj[keyField])) { foundRow = i + 2; break; }
      }
    }

    var schema = SHEET_SCHEMAS[sheetName];
    var targetRow = foundRow > 0 ? foundRow : sh.getLastRow() + 1;
    // Ghi đúng theo TIÊU ĐỀ CỘT THẬT của sheet (không giả định thứ tự cột = thứ tự schema); giữ nguyên các cột lạ.
    var sheetWidth = Math.max(sh.getLastColumn(), schema.length);
    var rowValues = (foundRow > 0)
      ? sh.getRange(targetRow, 1, 1, sheetWidth).getValues()[0]
      : new Array(sheetWidth).fill('');
    schema.forEach(function (col) {
      var ci = map[col];
        if (ci) {
        if (rowObj.hasOwnProperty(col)) rowValues[ci - 1] = rowObj[col];
        else if (foundRow < 0) rowValues[ci - 1] = '';   // dòng mới mới để trống; dòng cũ GIỮ NGUYÊN
      }
    });

    // FIX: ép định dạng text TRƯỚC khi ghi. Ghi trước rồi ép sau thì với dòng MỚI, Google Sheets đã tự đổi
    // chuỗi ngày (VD "2026-09-15") thành kiểu Date -> hiển thị ra số serial hoặc dd/MM/yyyy, làm client so sánh tháng sai.
    var textCols = TEXT_FORMAT_COLUMNS[sheetName] || [];
    var colIdxs = textCols.map(function (c) { return map[c]; }).filter(Boolean);
    forceTextFormat_(sh, colIdxs, 1, targetRow);
    sh.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

    invalidateMasterCache_();
    return ok_({ key: rowObj[keyField], row: targetRow, updated: foundRow > 0 });
  } finally {
    lock.releaseLock();
  }
}

function deleteRowByKey_(sheetName, keyField, keyValue) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
  try {
    var sh = SS.getSheetByName(sheetName);
    if (!sh) return ok_({ deleted: 0 });
    var map = getHeaderMap_(sh);
    var keyColIdx = map[keyField];
    var lastRow = sh.getLastRow();
    if (lastRow < 2 || !keyColIdx) return ok_({ deleted: 0 });
    var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(keyValue)) {
        sh.deleteRow(i + 2);
        invalidateMasterCache_();
        return ok_({ deleted: 1 });
      }
    }
    return ok_({ deleted: 0 });
  } finally {
    lock.releaseLock();
  }
}

// --- Chi phí tháng ---
function saveChiPhiThang(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = upsertRowByKey_(SHEET_NAMES.CHI_PHI, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_CHI_PHI', rowObj.Store + ' | ' + rowObj.Thang, JSON.stringify(rowObj));
    return result;
  });
}
function deleteChiPhi(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.CHI_PHI, 'Key_Id', keyId);
    if (result.success) logAudit_(account.username, 'XOA_CHI_PHI', keyId, '');
    return result;
  });
}

// --- Công nợ ---
function saveCongNo(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = upsertRowByKey_(SHEET_NAMES.CONG_NO, 'Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_CONG_NO', rowObj.TenKhachHang || '', JSON.stringify(rowObj));
    return result;
  });
}
function deleteCongNo(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.CONG_NO, 'Id', id);
    if (result.success) logAudit_(account.username, 'XOA_CONG_NO', id, '');
    return result;
  });
}

// --- Kế hoạch hành động ---
function saveActionPlan(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.CreatedAt) rowObj.CreatedAt = nowStr_();
    return upsertRowByKey_(SHEET_NAMES.ACTION_PLAN, 'Id', rowObj);
  });
}
function deleteActionPlan(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    return deleteRowByKey_(SHEET_NAMES.ACTION_PLAN, 'Id', id);
  });
}

// --- Kết ca (theo ca sáng/tối) ---
function saveKetCaCa(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Ngay + '|' + rowObj.Ca;
    if (String(rowObj.ChiTietKhac || '').length > 49000) return fail_('Chi tiết thu/chi của ca quá dài (vượt giới hạn 50.000 ký tự của ô Google Sheets) nên chưa được lưu. Hãy rút gọn ghi chú hoặc gộp bớt dòng.');
    var result = upsertRowByKey_(SHEET_NAMES.KET_CA_CA, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_KET_CA', rowObj.Key_Id, '');
    return result;
  });
}

// --- Kết ca (tổng ngày) ---
function saveKetCaNgay(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Ngay;
    return upsertRowByKey_(SHEET_NAMES.KET_CA_NGAY, 'Key_Id', rowObj);
  });
}

// --- Dự kiến chi phí/doanh thu tháng sau ---
function saveDuKien(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Thang;
    return upsertRowByKey_(SHEET_NAMES.DU_KIEN, 'Key_Id', rowObj);
  });
}

/** Upload ảnh đối soát (base64) lên Drive, trả về URL xem trực tiếp. */
function uploadReconciliationImage(token, base64Data, mimeType, fileName) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var folderName = '9Sach_AnhDoiSoat';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return ok_({ url: 'https://drive.google.com/uc?id=' + file.getId() });
  });
}
/** Upload 1 ảnh tiền mặt / ảnh Noti (base64) lên Drive + ghi 1 dòng lịch sử vào Data_KetCa_Anh. */
function uploadKetCaAnh(token, base64Data, mimeType, fileName, store, ngay, loai) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var folderName = '9Sach_AnhKetCa';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?id=' + file.getId();

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.KET_CA_ANH);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.KET_CA_ANH]);
      var id = genId_('ANH');
      var uploadedAt = nowStr_();
      var startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, 1, 8).setValues([[id, store, ngay, loai, url, fileName, uploadedAt, account.username]]);
      forceTextFormat_(sh, [3], 1, startRow);
      logAudit_(account.username, 'UPLOAD_ANH_KET_CA', store + ' | ' + ngay + ' | ' + loai, fileName);
      invalidateMasterCache_();
      return ok_({ id: id, url: url, fileName: fileName, uploadedAt: uploadedAt });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Xoá 1 ảnh khỏi lịch sử (chỉ gỡ khỏi danh sách hiển thị, không xoá file trên Drive). */
function deleteKetCaAnh(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.KET_CA_ANH, 'Id', id);
    if (result.success) logAudit_(account.username, 'XOA_ANH_KET_CA', id, '');
    return result;
  });
}
// ============================================================================
// 8. AUDIT LOG (tối thiểu — mở rộng đầy đủ ở Giai đoạn 4)
// ============================================================================

function logAudit_(user, action, target, detail) {
  try {
    var sh = getOrCreateSheet_(SHEET_NAMES.AUDIT_LOG);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.AUDIT_LOG]);
    sh.appendRow([genId_('LOG'), nowStr_(), user, action, target, detail]);
  } catch (e) {
    Logger.log('Ghi audit log thất bại (không ảnh hưởng thao tác chính): ' + e);
  }
}

// ============================================================================
// 9. QUẢN TRỊ HỆ THỐNG (chỉ Admin)
// ============================================================================

function requireAdmin_(token) {
  var account = getAccountByToken_(token);
  if (!account) return { ok: false, resp: fail_('Phiên đăng nhập đã hết hạn.') };
  if (account.role !== 'Admin') return { ok: false, resp: fail_('Chỉ Admin mới có quyền thực hiện thao tác này.') };
  return { ok: true, account: account };
}

/**
 * Chẩn đoán hệ thống từng bước có đo thời gian — giúp biết bước nào treo/lỗi
 * thay vì chỉ báo lỗi chung chung.
 */
function runSystemDiagnostics(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;

    var steps = [];
    function timeStep(label, fn) {
      var t0 = Date.now();
      try {
        var result = fn();
        steps.push({ label: label, ok: true, ms: Date.now() - t0, detail: result });
      } catch (e) {
        steps.push({ label: label, ok: false, ms: Date.now() - t0, detail: String(e) });
      }
    }

    timeStep('Kết nối Spreadsheet', function () { return SS.getName(); });
    timeStep('Khởi tạo/kiểm tra sheet hệ thống', function () { return initSystemSheets(); });
    timeStep('Đọc Data_Doc (đếm dòng)', function () { return getDataDocSheet_().getLastRow(); });
    timeStep('Đọc Users_V2', function () { return readSheetAsObjects_(SHEET_NAMES.USERS).length + ' tài khoản'; });
    timeStep('Kiểm tra lệch cột header', function () { return checkHeaderIntegrity_(); });
    timeStep('Kiểm tra cache CacheService', function () {
      var c = CacheService.getScriptCache();
      c.put('DIAG_TEST', '1', 5);
      return c.get('DIAG_TEST') === '1' ? 'OK' : 'LỖI CACHE';
    });

    return ok_({ steps: steps });
  });
}

/** Phát hiện lệch cột header — cột thực tế khác thứ tự/tên so với schema chuẩn. */
function checkHeaderIntegrity_() {
  var issues = [];
  Object.keys(SHEET_SCHEMAS).forEach(function (name) {
    var sh = SS.getSheetByName(name);
    if (!sh) { issues.push(name + ': sheet chưa tồn tại'); return; }
    var expected = SHEET_SCHEMAS[name];
    var lastCol = sh.getLastColumn();
    var actual = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); }) : [];
    for (var i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) {
        issues.push(name + ': cột ' + (i + 1) + ' mong đợi "' + expected[i] + '" nhưng thấy "' + (actual[i] || '(trống)') + '"');
      }
    }
  });
  return issues;
}

function checkHeaderIntegrityPublic(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    return ok_({ issues: checkHeaderIntegrity_() });
  });
}

/**
 * ============================================================================
 * SỬA DỮ LIỆU CŨ — GIẢM GIÁ & VAT (Hoá Đơn Có Chiết Khấu)
 * Chỉ đụng vào cột "Doc" (JSON chi tiết dòng hoá đơn) trong sheet Data_Doc.
 * KHÔNG đụng vào Data_KetCa_Ca, Data_KetCa_Ngay hay bất kỳ sheet Kết Ca nào.
 * ============================================================================
 */

/** Quét Data_Doc theo đúng 1 ngày, so sánh Giảm giá đã lưu (nếu có) với Giảm giá
 * tính lại theo giá niêm yết hiện tại trong Danh Mục Sản Phẩm — liệt kê các dòng
 * lệch để xem trước, gom theo hoá đơn. Không sửa gì ở bước này. */
function previewChietKhauMismatch(token, ngay) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!ngay) return fail_('Vui lòng chọn ngày cần kiểm tra.');

    var spRows = readSheetAsObjects_(SHEET_NAMES.SAN_PHAM);
    var giaBanByCode = {};
    spRows.forEach(function (r) {
      if (r.ItemCode) giaBanByCode[String(r.ItemCode).trim()] = parseFloat(r.GiaBan) || 0;
    });

    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({ groups: [], totalGroups: 0, totalMismatch: 0 });

    var map = getHeaderMap_(sh);
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var byInvoice = {};
    var totalMismatch = 0;

    values.forEach(function (row) {
      var rowNgay = row[map['Ngay'] - 1];
      if (rowNgay !== ngay) return;
      var docObj;
      try { docObj = JSON.parse(row[map['Doc'] - 1]); } catch (e) { return; }

      var giaBan = giaBanByCode[String(docObj.itemCode || '').trim()] || 0;
      if (!giaBan) return; // không có giá niêm yết để đối chiếu -> bỏ qua, không kết luận sai

      var qty = parseFloat(docObj.qty) || 0;
      var thanhTien = parseFloat(docObj.thanhTienTruocVat) || 0;
      var vat = parseFloat(docObj.vatHang) || 0;
      var recomputed = Math.max(0, giaBan * qty - thanhTien);
      var stored = (docObj.giaGiamHang === undefined || docObj.giaGiamHang === null)
        ? null : (parseFloat(docObj.giaGiamHang) || 0);

      var lyDo = '';
      if (stored === null) {
        if (recomputed > 0) lyDo = 'Chưa có Giảm giá đã lưu (dữ liệu nạp trước khi có cột Giảm giá)';
      } else if (Math.abs(stored - vat) < 1 && vat > 0 && Math.abs(stored - recomputed) > 500) {
        lyDo = 'Nghi ngờ VAT bị ghi nhầm vào Giảm giá';
      } else if (Math.abs(stored - recomputed) > 500) {
        lyDo = 'Giảm giá đã lưu khác với tính lại theo giá niêm yết hiện tại';
      }
      if (!lyDo) return;

      totalMismatch++;
      var key = docObj.branch + '|' + docObj.invoiceId;
      var inv = byInvoice[key] || (byInvoice[key] = {
        store: docObj.branch, invoiceId: docObj.invoiceId, ngay: rowNgay,
        timestamp: docObj.timestamp, items: []
      });
      inv.items.push({
        itemName: docObj.itemName, qty: qty, thanhTien: thanhTien, vat: vat,
        stored: stored, recomputed: recomputed, lyDo: lyDo
      });
    });

    var groups = Object.keys(byInvoice).map(function (k) { return byInvoice[k]; })
      .sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });

    return ok_({ groups: groups.slice(0, 300), totalGroups: groups.length, totalMismatch: totalMismatch });
  });
}

/**
 * Ghi lại Giảm giá cho các hoá đơn đã chọn (theo Cửa hàng|Mã hóa đơn) — tính lại từ
 * giá niêm yết hiện tại trong Danh Mục Sản Phẩm, KHÔNG đụng vào VAT (vatHang giữ
 * nguyên) và KHÔNG đụng vào bất kỳ sheet Kết Ca nào.
 */
function repairChietKhauInvoices(token, invoiceKeys) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!invoiceKeys || invoiceKeys.length === 0) return ok_({ updated: 0 });

    var spRows = readSheetAsObjects_(SHEET_NAMES.SAN_PHAM);
    var giaBanByCode = {};
    spRows.forEach(function (r) {
      if (r.ItemCode) giaBanByCode[String(r.ItemCode).trim()] = parseFloat(r.GiaBan) || 0;
    });

    var keySet = {};
    invoiceKeys.forEach(function (k) { keySet[k] = true; });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ updated: 0 });
      var map = getHeaderMap_(sh);
      var docColIdx = map['Doc'];
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var updated = 0;

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var docObj;
        try { docObj = JSON.parse(row[docColIdx - 1]); } catch (e) { continue; }
        var key = docObj.branch + '|' + docObj.invoiceId;
        if (!keySet[key]) continue;

        var giaBan = giaBanByCode[String(docObj.itemCode || '').trim()] || 0;
        if (!giaBan) continue;

        var qty = parseFloat(docObj.qty) || 0;
        var thanhTien = parseFloat(docObj.thanhTienTruocVat) || 0;
        docObj.giaGiamHang = Math.max(0, giaBan * qty - thanhTien);
        // vatHang GIỮ NGUYÊN — không đụng tới, tránh nhầm lẫn VAT với Giảm giá.

        sh.getRange(i + 2, docColIdx).setValue(JSON.stringify(docObj));
        updated++;
      }

      logAudit_(guard.account.username, 'SUA_GIAM_GIA_VAT_DU_LIEU_CU', invoiceKeys.length + ' hoá đơn', updated + ' dòng đã cập nhật Giảm giá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ updated: updated });
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Sửa lại TOÀN BỘ cột "Giảm giá" (giaGiamHang) trong Data_Doc cho MỌI ngày đã nạp — không giới
 * hạn theo 1 ngày như hàm cũ. Với mỗi dòng có Mã hàng tìm được Giá bán niêm yết trong Danh Mục
 * Sản Phẩm, tính lại từ đầu: Giảm giá = max(0, Giá bán niêm yết × SL − Thành tiền chưa VAT).
 * VAT (vatHang) LUÔN được giữ nguyên, không đụng tới trong bất kỳ trường hợp nào — đảm bảo
 * Giảm giá và VAT tách bạch hoàn toàn, sửa luôn cả các dòng cũ bị nhầm VAT thành Giảm giá lẫn
 * các dòng chưa từng có Giảm giá. Không đụng tới dữ liệu Kết Ca.
 */
function repairAllChietKhauVatData(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;

    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({ updated: 0, skipped: 0, scanned: 0, message: 'Không có dữ liệu.' });

    var map = getHeaderMap_(sh);
    var docColIdx = map['Doc'];
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var scanned = 0;
    var missingGiaGiamCol = 0;

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var docObj;
      try { docObj = JSON.parse(row[docColIdx - 1]); } catch (e) { continue; }
      scanned++;
      if (docObj.giaGiamHang === undefined || docObj.giaGiamHang === null) missingGiaGiamCol++;
    }

    logAudit_(guard.account.username, 'QUET_KIEM_TRA_GIAM_GIA_VAT', 'Data_Doc',
      scanned + ' dòng đã quét, ' + missingGiaGiamCol + ' dòng chưa có Giảm giá (dữ liệu nạp trước khi có cột Giảm giá)');

    return ok_({
      updated: 0,
      skipped: scanned,
      scanned: scanned,
      message: 'Đã ngừng tự động tính lại Giảm giá theo công thức Giá niêm yết × SL − Thành tiền, vì công thức này sai với các dòng combo/tặng kèm/khuyến mãi (giá bán thực tế không khớp giá niêm yết trong Danh Mục Sản Phẩm). Hệ thống hiện luôn lấy đúng cột "Giảm giá" và "VAT hàng" ngay từ file KiotViet khi nạp, không tự tính tay nữa. Quét được ' + scanned + ' dòng, trong đó ' + missingGiaGiamCol + ' dòng nạp trước khi có cột Giảm giá (không có số liệu gốc để đối chiếu). Muốn sửa một hoá đơn cụ thể, vào bảng "Hoá Đơn Có Chiết Khấu" ở tab Lợi Nhuận Ngày, xem đúng hoá đơn đó rồi dùng nút sửa riêng lẻ (repairChietKhauInvoices) — không áp dụng hàng loạt cho toàn bộ dữ liệu nữa.'
    });
  });
}

/** Vá 1 lần: gán Id cho các dòng nhân viên bị thiếu Id trong Data_NhanVien (do thêm/sửa trực tiếp trên Sheet, không qua form web app) — chỉ Admin. */
function repairMissingNhanVienIds(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = SS.getSheetByName(SHEET_NAMES.NHAN_VIEN);
    if (!sh) return fail_('Không tìm thấy sheet Data_NhanVien.');
    var map = getHeaderMap_(sh);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({ fixed: 0, message: 'Không có dữ liệu.' });
    var idRange = sh.getRange(2, map['Id'], lastRow - 1, 1);
    var ids = idRange.getValues();
    var fixed = 0;
    var out = ids.map(function (r) {
      var v = String(r[0] || '').trim();
      if (!v) { fixed++; return [genId_('NV')]; }
      return [v];
    });
    idRange.setNumberFormat('@').setValues(out);
    logAudit_(guard.account.username, 'VA_THIEU_ID_NHAN_VIEN', SHEET_NAMES.NHAN_VIEN, fixed + ' dòng đã gán Id mới');
    invalidateMasterCache_();
    bumpDataVersion_();
    return ok_({ fixed: fixed, message: 'Đã vá ' + fixed + ' dòng thiếu Id.' });
  });
}
/** Tự gán Id cho dòng nhân viên còn trống Id (do thêm/sửa trực tiếp trên Sheet). Chạy mỗi lần dựng master data — không cần "Vá" thủ công. */
function ensureNhanVienIds_() {
  try {
    var sh = SS.getSheetByName(SHEET_NAMES.NHAN_VIEN);
    if (!sh || sh.getLastRow() < 2) return 0;
    var map = getHeaderMap_(sh);
    if (!map['Id'] || !map['HoTen']) return 0;
    var n = sh.getLastRow() - 1;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return 0; // bận -> lần dựng sau sẽ gán
    try {
      var idRange = sh.getRange(2, map['Id'], n, 1);
      var ids = idRange.getValues();
      var names = sh.getRange(2, map['HoTen'], n, 1).getValues();
      var fixed = 0;
      var out = ids.map(function (r, i) {
        var v = String(r[0] || '').trim();
        if (!v && String(names[i][0] || '').trim()) { fixed++; return [genId_('NV')]; }
        return [v];
      });
      if (fixed > 0) {
        idRange.setNumberFormat('@').setValues(out);
        logAudit_('system', 'TU_GAN_ID_NHAN_VIEN', SHEET_NAMES.NHAN_VIEN, fixed + ' dòng được tự gán Id');
      }
      return fixed;
    } finally { lock.releaseLock(); }
  } catch (e) { return 0; }
}
/** Gắn lại giờ công (Data_CongNhatNgay) từ 1 mã nhân viên cũ/đã xoá sang nhân viên hiện có — chỉ Admin. */
function relinkCongNhatNhanVien(token, oldId, newId) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    oldId = String(oldId || '').trim();
    newId = String(newId || '').trim();
    if (!oldId || !newId || oldId === newId) return fail_('Thiếu mã nhân viên cũ / mới.');
    var exists = readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN).some(function (r) { return String(r.Id || '').trim() === newId; });
    if (!exists) return fail_('Không tìm thấy nhân viên mới trong Data_NhanVien.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.CONG_NHAT_NGAY);
      if (!sh || sh.getLastRow() < 2) return fail_('Không có dữ liệu chấm công.');
      var map = getHeaderMap_(sh), n = sh.getLastRow() - 1;
      var idCol = map['NhanVienId'], keyCol = map['Key_Id'], ngayCol = map['Ngay'], storeCol = map['Store'];
      if (!idCol || !ngayCol || !storeCol) return fail_('Sheet Data_CongNhatNgay thiếu cột NhanVienId / Ngay / Store.');
      var ids = sh.getRange(2, idCol, n, 1).getDisplayValues();
      var ngays = sh.getRange(2, ngayCol, n, 1).getDisplayValues();
      var stores = sh.getRange(2, storeCol, n, 1).getDisplayValues();
      var keys = keyCol ? sh.getRange(2, keyCol, n, 1).getDisplayValues() : null;
      var have = {}, i;
      for (i = 0; i < n; i++) {
        if (String(ids[i][0]).trim() === newId) have[stores[i][0] + '|' + ngays[i][0]] = true;
      }
      var moved = 0, dup = 0;
      for (i = 0; i < n; i++) {
        if (String(ids[i][0]).trim() !== oldId) continue;
        if (have[stores[i][0] + '|' + ngays[i][0]]) { dup++; continue; }
        ids[i][0] = newId;
        if (keys && String(keys[i][0]).indexOf(oldId) !== -1) keys[i][0] = String(keys[i][0]).split(oldId).join(newId);
        moved++;
      }
      if (moved > 0) {
        sh.getRange(2, idCol, n, 1).setNumberFormat('@').setValues(ids);
        if (keys) sh.getRange(2, keyCol, n, 1).setNumberFormat('@').setValues(keys);
      }
      logAudit_(guard.account.username, 'GAN_LAI_GIO_CONG', oldId + ' -> ' + newId, moved + ' dòng, ' + dup + ' dòng trùng ngày bỏ qua');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ moved: moved, dup: dup, message: 'Đã gắn lại ' + moved + ' lượt chấm công.' + (dup ? ' Bỏ qua ' + dup + ' lượt vì nhân viên đích đã có giờ công cùng ngày.' : '') });
    } finally { lock.releaseLock(); }
  });
}

/** Tự sửa lệch cột header — ghi lại đúng header chuẩn ở dòng 1 theo schema. Cảnh báo: chỉ sửa header, không dịch chuyển dữ liệu. */
function repairSheetColumnOrder(token, sheetName) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = SS.getSheetByName(sheetName);
    if (!sh) return fail_('Không tìm thấy sheet ' + sheetName);
    var schema = SHEET_SCHEMAS[sheetName];
    if (!schema) return fail_('Không có schema chuẩn cho sheet này.');
    sh.getRange(1, 1, 1, schema.length).setValues([schema]);
    logAudit_(guard.account.username, 'SUA_LECH_COT', sheetName, 'Ghi lại header chuẩn');
    return ok_({ message: 'Đã ghi lại header chuẩn cho ' + sheetName + '. Kiểm tra lại dữ liệu để đảm bảo khớp cột.' });
  });
}

/** Kiểm tra kích thước Data_Doc, cảnh báo nếu nghi trùng lặp bất thường. */
function checkDataDocSize(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = getDataDocSheet_();
    var total = Math.max(0, sh.getLastRow() - 1);
    var map = getHeaderMap_(sh);
    var docIds = total > 0 ? sh.getRange(2, map['DocId'], total, 1).getValues().map(function (r) { return r[0]; }) : [];
    var uniqueCount = new Set(docIds).size;
    var dupSuspect = total - uniqueCount;
    return ok_({
      totalRows: total,
      uniqueDocId: uniqueCount,
      suspectedDuplicates: dupSuspect,
      warning: dupSuspect > 0 ? 'Phát hiện ' + dupSuspect + ' DocId trùng lặp — nên chạy "Dọn trùng lặp".' : null
    });
  });
}

/** Dọn trùng lặp Data_Doc theo chữ ký store|ngày|invoiceId|itemCode|revenue. */
function dedupeDataDoc(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ removed: 0 });
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var seen = {};
      var keepRows = [];
      var removed = 0;
      values.forEach(function (row) {
        // row: DocId, Store, Ngay, MonthKey, InvoiceId, Revenue, Doc, ImportedAt
        var sig = row[1] + '|' + row[2] + '|' + row[4] + '|' + row[5];
        try {
          var docObj = JSON.parse(row[6]);
          sig += '|' + docObj.itemCode;
        } catch (e) { /* giữ sig gốc nếu JSON lỗi */ }
        if (seen[sig]) { removed++; return; }
        seen[sig] = true;
        keepRows.push(row);
      });
      if (removed > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) {
          sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          forceTextFormat_(sh, [3, 4, 5], keepRows.length, 2);
        }
      }
      logAudit_(guard.account.username, 'DON_TRUNG_LAP', 'Data_Doc', removed + ' dòng bị xoá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ removed: removed, remaining: keepRows.length });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Sửa lỗi ngày/tháng bị Google Sheets tự convert — quét lại và ép text. */
function fixDateColumns(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var fixed = 0;
    Object.keys(TEXT_FORMAT_COLUMNS).forEach(function (sheetName) {
      var sh = SS.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      TEXT_FORMAT_COLUMNS[sheetName].forEach(function (colName) {
        var colIdx = map[colName];
        if (!colIdx) return;
        var range = sh.getRange(2, colIdx, lastRow - 1, 1);
        var values = range.getValues();
        var needsFix = values.some(function (r) { return r[0] instanceof Date; });
        if (needsFix) {
          var fixedValues = values.map(function (r) {
            if (r[0] instanceof Date) {
              var fmt = colName.indexOf('Thang') !== -1 ? 'yyyy-MM' : 'yyyy-MM-dd';
              return [Utilities.formatDate(r[0], 'Asia/Ho_Chi_Minh', fmt)];
            }
            return r;
          });
          range.setNumberFormat('@').setValues(fixedValues);
          fixed += fixedValues.length;
        }
      });
    });
    logAudit_(guard.account.username, 'SUA_LOI_NGAY_THANG', 'multiple sheets', fixed + ' ô đã sửa');
    invalidateMasterCache_();
    return ok_({ message: 'Đã kiểm tra và sửa ' + fixed + ' ô ngày/tháng bị Google Sheets tự convert.' });
  });
}

/** Migrate 1 lần từ Data_Tho (29 cột thô cũ) sang Data_Doc (document-oriented). */
function migrateFromDataTho(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var oldSh = SS.getSheetByName('Data_Tho');
    if (!oldSh) return fail_('Không tìm thấy sheet Data_Tho cũ — có thể đã migrate rồi hoặc chưa từng tồn tại.');

    var lastRow = oldSh.getLastRow();
    if (lastRow < 2) return ok_({ migrated: 0, message: 'Data_Tho không có dữ liệu để chuyển.' });

    var header = oldSh.getRange(1, 1, 1, oldSh.getLastColumn()).getValues()[0];
    var values = oldSh.getRange(2, 1, lastRow - 1, oldSh.getLastColumn()).getValues();
    var rowsAsObjects = values.map(function (row) {
      var obj = {};
      header.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });

    // Tái sử dụng logic importDocChunk theo lô 300 dòng
    var totalMigrated = 0;
    for (var i = 0; i < rowsAsObjects.length; i += IMPORT_CHUNK_SIZE) {
      var chunk = rowsAsObjects.slice(i, i + IMPORT_CHUNK_SIZE);
      var result = importDocChunk(token, chunk);
      if (result.success) totalMigrated += result.data.inserted;
    }

    logAudit_(guard.account.username, 'MIGRATE_DATA_THO', 'Data_Tho -> Data_Doc', totalMigrated + ' dòng đã chuyển');
    bumpDataVersion_();
    return ok_({ migrated: totalMigrated, message: 'Đã migrate ' + totalMigrated + ' dòng từ Data_Tho sang Data_Doc. Kiểm tra kỹ trước khi xoá sheet Data_Tho cũ.' });
  });
}

/** Chẩn đoán độ phủ dữ liệu Data_Doc theo tháng — liệt kê dòng không xác định được ngày. */
function diagnoseMonthCoverage(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({ byMonth: {}, unknownDateRows: 0 });
    var map = getHeaderMap_(sh);
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getDisplayValues();
    var byMonth = {};
    var unknown = 0;
    values.forEach(function (row) {
      var monthKey = row[map['MonthKey'] - 1];
      if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) { unknown++; return; }
      byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
    });
    return ok_({ byMonth: byMonth, unknownDateRows: unknown });
  });
}

/** Cấu hình chi phí cố định mặc định theo mẫu tên cửa hàng (seed rule theo từ khoá). */
function seedDefaultCostRules(token, rules) {
  // rules: [{ keyword: 'Cần Thơ', matBang: 15000000, internet: 500000 }, ...]
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = getOrCreateSheet_(SHEET_NAMES.STORE_SETTINGS);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.STORE_SETTINGS]);
    var storeRows = readSheetAsObjects_(SHEET_NAMES.STORE_SETTINGS);
    var updated = 0;
    storeRows.forEach(function (store, idx) {
      var matched = rules.filter(function (r) { return store.Store_Name.indexOf(r.keyword) !== -1; })[0];
      if (matched) {
        sh.getRange(idx + 2, 2, 1, 2).setValues([[matched.matBang, matched.internet]]);
        updated++;
      }
    });
    logAudit_(guard.account.username, 'SEED_CHI_PHI_MAC_DINH', 'Store_Settings', updated + ' cửa hàng đã cập nhật');
    invalidateMasterCache_();
    return ok_({ updated: updated });
  });
}

/** Quản lý tài khoản — Admin thêm/sửa/xoá user trong Users_V2. */
function saveUser(token, userObj) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.USERS);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.USERS]);
      var lastRow = sh.getLastRow();
      var usernames = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
      var idx = usernames.indexOf(userObj.Username);
      var rowValues = [userObj.Username, userObj.Password, userObj.Role, userObj.Stores];
      if (idx === -1) {
        sh.appendRow(rowValues);
      } else {
        sh.getRange(idx + 2, 1, 1, 4).setValues([rowValues]);
      }
      logAudit_(guard.account.username, 'LUU_TAI_KHOAN', userObj.Username, userObj.Role + ' | ' + userObj.Stores);
      return ok_({ message: 'Đã lưu tài khoản ' + userObj.Username });
    } finally {
      lock.releaseLock();
    }
  });
}

function deleteUser(token, username) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var result = deleteRowByKey_(SHEET_NAMES.USERS, 'Username', username);
    if (result.success) logAudit_(guard.account.username, 'XOA_TAI_KHOAN', username, '');
    return result;
  });
}

function listUsers(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    return ok_(readSheetAsObjects_(SHEET_NAMES.USERS).map(function (u) {
      return { Username: u.Username, Role: u.Role, Stores: u.Stores }; // không trả Password ra client
    }));
  });
}

/** Đánh dấu 1 cửa hàng đã đóng cửa + ngày đóng — chỉ Admin. */
function saveStoreClosure(token, storeName, daDongCua, ngayDongCua) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.STORE_SETTINGS);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.STORE_SETTINGS]);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return fail_('Không tìm thấy danh sách cửa hàng.');
      var names = sh.getRange(2, map['Store_Name'], lastRow - 1, 1).getValues();
      var rowIdx = -1;
      for (var i = 0; i < names.length; i++) { if (String(names[i][0]) === storeName) { rowIdx = i + 2; break; } }
      if (rowIdx === -1) return fail_('Không tìm thấy cửa hàng ' + storeName);
      sh.getRange(rowIdx, map['DaDongCua']).setValue(daDongCua ? 'TRUE' : '');
      sh.getRange(rowIdx, map['NgayDongCua']).setNumberFormat('@').setValue(daDongCua ? (ngayDongCua || '') : '');
      logAudit_(guard.account.username, 'CAP_NHAT_DONG_CUA', storeName, 'DaDongCua=' + daDongCua + ' NgayDongCua=' + ngayDongCua);
      invalidateMasterCache_();
      return ok_({ message: 'Đã cập nhật trạng thái cửa hàng ' + storeName });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Ghi 1 dòng lịch sử nạp file (gọi sau khi client nạp xong toàn bộ 1 file). */
function logImportHistory_(user, fileName, inserted, skipped) {
  try {
    var sh = getOrCreateSheet_(SHEET_NAMES.IMPORT_HISTORY);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.IMPORT_HISTORY]);
    sh.appendRow([genId_('IMP'), fileName, nowStr_(), inserted, skipped, user]);
  } catch (e) {
    Logger.log('Ghi lịch sử nạp file thất bại (không ảnh hưởng thao tác chính): ' + e);
  }
}
function recordImportHistory(token, fileName, inserted, skipped) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    logImportHistory_(account.username, fileName, inserted, skipped);
    return ok_({ message: 'Đã ghi lịch sử nạp file.' });
  });
}
function getImportHistory(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var rows = readSheetAsObjects_(SHEET_NAMES.IMPORT_HISTORY);
    rows.sort(function (a, b) { return String(b.ImportedAt).localeCompare(String(a.ImportedAt)); });
    return ok_(rows);
  });
}
function deleteImportHistoryRow(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    return deleteRowByKey_(SHEET_NAMES.IMPORT_HISTORY, 'Id', id);
  });
}
function clearImportHistory(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.IMPORT_HISTORY);
      var lastRow = sh.getLastRow();
      if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
      return ok_({ message: 'Đã xoá lịch sử nạp file.' });
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Quét toàn bộ Data_Doc và trả về danh sách NHÓM dòng nghi trùng lặp (cùng chữ ký
 * store|ngày|mã hoá đơn|thành tiền|mã hàng) để hiển thị cho người dùng xác nhận
 * TRƯỚC khi thực sự xoá — không xoá gì ở bước này.
 */
function previewDuplicateDataDoc(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return ok_({ groups: [], totalGroups: 0, totalDuplicateRows: 0 });
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var seen = {};
    var totalDup = 0;
    values.forEach(function (row) {
      var sig = row[1] + '|' + row[2] + '|' + row[4] + '|' + row[5];
      var itemCode = '';
      try {
        var docObj = JSON.parse(row[6]);
        sig += '|' + docObj.itemCode;
        itemCode = docObj.itemCode;
      } catch (e) { /* giữ sig gốc nếu JSON lỗi */ }
      if (!seen[sig]) {
        seen[sig] = { store: row[1], ngay: row[2], invoiceId: row[4], itemCode: itemCode, revenue: row[5], count: 1 };
      } else {
        seen[sig].count++;
        totalDup++;
      }
    });
    var groups = Object.keys(seen).map(function (k) { return seen[k]; }).filter(function (g) { return g.count > 1; });
    groups.sort(function (a, b) { return b.count - a.count; });
    return ok_({ groups: groups.slice(0, 200), totalGroups: groups.length, totalDuplicateRows: totalDup });
  });
}

// ============================================================================
// GIAI ĐOẠN 9 — LƯU LINK GOOGLE SHEET RIÊNG THEO TỪNG TÀI KHOẢN
// ============================================================================
/** Trả về các link Google Sheet đã lưu của tài khoản đang đăng nhập, dạng {ketCa:'...', loiNhuanNgay:'...'}. */
function getUserSheetLinks(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var sh = getOrCreateSheet_(SHEET_NAMES.USER_SETTINGS);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.USER_SETTINGS]);
    var rows = readSheetAsObjects_(SHEET_NAMES.USER_SETTINGS);
    var rec = rows.filter(function (r) { return r.Username === account.username; })[0];
    var links = {};
    if (rec && rec.SheetLinks) {
      try { links = JSON.parse(rec.SheetLinks) || {}; } catch (e) { links = {}; }
    }
    return ok_(links);
  });
}
/** Lưu 1 link Google Sheet cho đúng tài khoản đang đăng nhập, theo key (VD 'ketCa', 'loiNhuanNgay'). */
function saveUserSheetLink(token, key, url) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.USER_SETTINGS);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.USER_SETTINGS]);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var rowIdx = -1;
      var links = {};
      if (lastRow > 1) {
        var usernames = sh.getRange(2, map['Username'], lastRow - 1, 1).getValues();
        for (var i = 0; i < usernames.length; i++) {
          if (String(usernames[i][0]) === account.username) { rowIdx = i + 2; break; }
        }
      }
      if (rowIdx > 0) {
        var existingVal = sh.getRange(rowIdx, map['SheetLinks']).getValue();
        try { links = existingVal ? JSON.parse(existingVal) : {}; } catch (e) { links = {}; }
      }
      links[key] = url;
      if (rowIdx > 0) {
        sh.getRange(rowIdx, map['SheetLinks']).setValue(JSON.stringify(links));
        sh.getRange(rowIdx, map['SavedAt']).setValue(nowStr_());
      } else {
        sh.appendRow([account.username, JSON.stringify(links), nowStr_()]);
      }
      return ok_({ message: 'Đã lưu link.' });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Thêm 1 cửa hàng mới vào Store_Settings — chỉ Admin. Tự xuất hiện ở mọi bộ lọc sau khi làm mới dữ liệu. */
function saveNewStore(token, storeName) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    storeName = String(storeName || '').trim();
    if (!storeName) return fail_('Vui lòng nhập tên cửa hàng.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.STORE_SETTINGS);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.STORE_SETTINGS]);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var existingNames = lastRow > 1 ? sh.getRange(2, map['Store_Name'], lastRow - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
      if (existingNames.indexOf(storeName) !== -1) return fail_('Cửa hàng "' + storeName + '" đã tồn tại trong hệ thống.');
      sh.appendRow([storeName, '', '', '', '']);
      logAudit_(guard.account.username, 'THEM_CUA_HANG_MOI', storeName, '');
      invalidateMasterCache_();
      return ok_({ message: 'Đã thêm cửa hàng "' + storeName + '".' });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================================
// ============================================================================================
// GIAI ĐOẠN 5 — 8.x KHU VỰC & THƯỞNG KPI KHU VỰC
// ============================================================================================
/** Tạo/sửa khu vực (tên + danh sách cửa hàng) — chỉ Admin. */
function saveKhuVuc(token, rowObj) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var result = upsertRowByKey_(SHEET_NAMES.KHU_VUC, 'Id', rowObj);
    if (result.success) logAudit_(guard.account.username, 'LUU_KHU_VUC', rowObj.TenKhuVuc || '', rowObj.Stores || '');
    return result;
  });
}
function deleteKhuVuc(token, id) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var result = deleteRowByKey_(SHEET_NAMES.KHU_VUC, 'Id', id);
    if (result.success) logAudit_(guard.account.username, 'XOA_KHU_VUC', id, '');
    return result;
  });
}
/** Lưu KPI cá nhân (nhập tay) + số lần vi phạm cho 1 khu vực/tháng — chỉ Admin. */
function saveKpiKhuVuc(token, rowObj) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.KhuVucId + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.KPI_KHU_VUC, 'Key_Id', rowObj);
    if (result.success) logAudit_(guard.account.username, 'LUU_KPI_KHU_VUC', rowObj.Key_Id, 'KpiCaNhan=' + rowObj.KpiCaNhan + ' ViPham=' + rowObj.ViPham);
    return result;
  });
}

// ============================================================================================
// ============================================================================================
// GIAI ĐOẠN 6 — NHÂN VIÊN BÁN HÀNG & THƯỞNG KPI HÀNH VI CÁ NHÂN
// (Thưởng nền theo thâm niên × KPI doanh số cửa hàng hòa vốn × Đánh giá hành vi phục vụ)
// ============================================================================================
/** Tạo/sửa 1 nhân viên bán hàng thuộc 1 cửa hàng — QLCH chỉ thêm/sửa được nhân viên cửa hàng mình. */
function normalizeNameServer_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function saveNhanVien(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền thêm nhân viên cho cửa hàng này.');
    }
    var existingRows = readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN);
    var normName = nameKeyServer_(rowObj.HoTen);
    var dup = existingRows.filter(function (r) {
      return r.Store === rowObj.Store && nameKeyServer_(r.HoTen) === normName && r.Id !== rowObj.Id;
    })[0];
    if (dup) return fail_('Nhân viên "' + rowObj.HoTen + '" đã tồn tại tại cửa hàng ' + rowObj.Store + '.');
    // Giữ nguyên Lương/giờ đã lưu trước đó nếu lần lưu này (VD: form "Sửa nhân viên") không gửi
    // kèm trường LuongGio — tránh bị ghi đè thành rỗng mỗi khi chỉ sửa tên/cửa hàng/trạng thái.
    if (rowObj.Id && (rowObj.LuongGio === undefined || rowObj.LuongGio === null || rowObj.LuongGio === '')) {
      var existingRec = existingRows.filter(function (r) { return r.Id === rowObj.Id; })[0];
      if (existingRec && existingRec.LuongGio !== undefined && existingRec.LuongGio !== '') {
        rowObj.LuongGio = existingRec.LuongGio;
      }
    }
    if (rowObj.Id && !existingRows.some(function (r) { return String(r.Id) === String(rowObj.Id); })) {
      return fail_('Không tìm thấy nhân viên Id ' + rowObj.Id + ' trong Data_NhanVien — hãy tải lại trang rồi thử lại.');
    }
    var isNewEmployee_ = !rowObj.Id;
    var result = upsertRowByKey_(SHEET_NAMES.NHAN_VIEN, 'Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'LUU_NHAN_VIEN', rowObj.Store + ' | ' + rowObj.HoTen, 'ThangBatDau=' + rowObj.ThangBatDau);
      if (isNewEmployee_) {
        var rl_ = autoRelinkGioCongByName_(result.data.key, rowObj.Store, rowObj.HoTen);
        result.data.relinked = rl_.moved;
      }
      var rlAll_ = autoRelinkAllOrphans_();
      if (rlAll_.moved) result.data.relinked = (result.data.relinked || 0) + rlAll_.moved;
      bumpDataVersion_();
    }
    return result;
  });
}
function deleteNhanVien(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var rows = readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN);
      var rec = rows.filter(function (r) { return r.Id === id; })[0];
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (!rec || allowed.indexOf(rec.Store) === -1) return fail_('Bạn không có quyền xoá nhân viên này.');
    }
    try {
      stampDeletedNhanVien_(readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN).filter(function (r) { return r.Id === id; }));
    } catch (eTomb_) {}
    var result = deleteRowByKey_(SHEET_NAMES.NHAN_VIEN, 'Id', id);
    if (result.success) {
      logAudit_(account.username, 'XOA_NHAN_VIEN', id, '');
      bumpDataVersion_();
    }
    return result;
  });
}

/** Xoá nhiều nhân viên cùng lúc — 1 lock duy nhất cho nhanh, dùng khi tick chọn hàng loạt. */
function deleteNhanVienBatch(token, ids) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!ids || ids.length === 0) return ok_({ deleted: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.NHAN_VIEN);
      if (!sh) return ok_({ deleted: 0 });
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ deleted: 0 });
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var idSet = {};
      ids.forEach(function (id) { idSet[id] = true; });
      var allowedStores = account.role === 'Admin' ? null : String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      var keepRows = [], deleted = 0, tomb = [];
      values.forEach(function (row) {
        var id = row[map['Id'] - 1];
        var store = row[map['Store'] - 1];
        var allowedOk = !allowedStores || allowedStores.indexOf(store) !== -1;
        if (idSet[id] && allowedOk) { deleted++; tomb.push({ Id: id, Store: store, HoTen: row[map['HoTen'] - 1] }); return; }
        keepRows.push(row);
      });
      if (deleted > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
      }
      stampDeletedNhanVien_(tomb);
      logAudit_(account.username, 'XOA_NHIEU_NHAN_VIEN', ids.join(','), deleted + ' nhân viên bị xoá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ deleted: deleted });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Lưu chấm điểm hành vi (9 tiêu chí dạng JSON + điểm quản lý tổng quan 0-10) cho 1 nhân viên/tháng. */
function saveKpiNhanVien(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền chấm điểm nhân viên cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.NhanVienId + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.KPI_NHAN_VIEN, 'Key_Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'LUU_KPI_NHAN_VIEN', rowObj.Key_Id, 'DiemQuanLy=' + rowObj.DiemQuanLy);
      bumpDataVersion_();
    }
    return result;
  });
}
/** Lưu/cập nhật phụ cấp cho 1 nhân viên/tháng — QLCH chỉ được thao tác nhân viên cửa hàng mình. */
function savePhuCapNhanVien(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền cập nhật phụ cấp nhân viên cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.NhanVienId + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.PHU_CAP, 'Key_Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'LUU_PHU_CAP_NV', rowObj.Key_Id, 'LoaiPhuCap=' + rowObj.LoaiPhuCap + ' SoTienPhuCap=' + rowObj.SoTienPhuCap);
      bumpDataVersion_();
    }
    return result;
  });
}

/** Lưu hàng loạt Tổng Giờ Công (từ file chấm công up lên) — giữ nguyên LoaiPhuCap/SoTienPhuCap đã lưu trước đó nếu batch này chỉ cập nhật giờ công, 1 lock cho nhanh. */
function saveGioCongBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.PHU_CAP);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.PHU_CAP]);
      var map = getHeaderMap_(sh);
      var keyColIdx = map['Key_Id'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.PHU_CAP];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.NhanVienId || !rowObj.Thang) return;
        rowObj.Key_Id = rowObj.NhanVienId + '|' + rowObj.Thang;
        rowObj.SavedAt = nowStr_();
        var foundRow = existingKeys[String(rowObj.Key_Id)];
        if (foundRow && (rowObj.LoaiPhuCap === undefined || rowObj.LoaiPhuCap === '')) {
          var existingVals = sh.getRange(foundRow, 1, 1, schema.length).getValues()[0];
          schema.forEach(function (col, idx) {
            if ((col === 'LoaiPhuCap' || col === 'SoTienPhuCap') && (rowObj[col] === undefined || rowObj[col] === '')) {
              rowObj[col] = existingVals[idx];
            }
          });
        }
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
          forceTextFormat_(sh, [map['Thang']], 1, foundRow);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
        forceTextFormat_(sh, [map['Thang']], appended.length, startRow);
      }
      logAudit_(account.username, 'LUU_GIO_CONG_BATCH', SHEET_NAMES.PHU_CAP, saved + ' dòng đã lưu');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Lưu hàng loạt SL bán Sữa Chua/Panna theo ngày — dùng cho tab Thống Kê Sữa Chua & Panna, 1 lock cho nhanh. */
function saveSuaChuaPanaBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.SUA_CHUA_PANA);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.SUA_CHUA_PANA]);
      var map = getHeaderMap_(sh);
      var keyColIdx = map['Key_Id'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.SUA_CHUA_PANA];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Ngay;
        rowObj.SavedAt = nowStr_();
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        var foundRow = existingKeys[String(rowObj.Key_Id)];
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
          forceTextFormat_(sh, [map['Ngay']], 1, foundRow);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
        forceTextFormat_(sh, [map['Ngay']], appended.length, startRow);
      }
      logAudit_(account.username, 'LUU_SUA_CHUA_PANA_BATCH', SHEET_NAMES.SUA_CHUA_PANA, saved + ' dòng đã lưu');
      invalidateMasterCache_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================================
// ============================================================================================
// BẢNG GIÁ VỐN THEO SKU — áp dụng chung toàn hệ thống, dùng để tự tính Giá vốn hàng bán
// ============================================================================================
/** Lưu hàng loạt giá vốn đơn vị theo SKU cùng lúc — chỉ Admin, 1 lock duy nhất cho nhanh. */
function saveGiaVonSKUBatch(token, rows) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.GIA_VON_SKU);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.GIA_VON_SKU]);
      var map = getHeaderMap_(sh);
      var keyColIdx = map['ItemCode'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.GIA_VON_SKU];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.ItemCode) return;
        rowObj.SavedAt = nowStr_();
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        var foundRow = existingKeys[String(rowObj.ItemCode)];
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
      }
      logAudit_(guard.account.username, 'LUU_GIA_VON_SKU_BATCH', SHEET_NAMES.GIA_VON_SKU, saved + ' SKU đã lưu');
      invalidateMasterCache_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================================
// ============================================================================================
// GIAI ĐOẠN 3 — 7.3 GỢI Ý SẢN LƯỢNG ĐẶT HÀNG / SẢN XUẤT THEO NGÀY
// ============================================================================================
// 3 sheet mới: Data_TonKhoSKU, Data_GoiYDatHang, Data_KhuyenMai — schema & text-format cột đã
// khai báo ở mục 0. Toàn bộ phép tính dự báo (baseline DOW, growthFactor, safety stock...) chạy
// Ở CLIENT bằng GD.rawData đã tải sẵn — server ở đây CHỈ lo lưu/đọc cấu hình (tồn kho, khuyến mãi,
// lịch sử gợi ý đã lưu) để không phải round-trip cho mỗi lần đổi bộ lọc/ngày dự báo.
// ============================================================================================

// --- Tồn kho SKU theo ngày (nhập tay, có thể để trống — hệ thống vẫn chạy được không cần) ---
function saveTonKhoSKU(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Ngay;
    var tonCuoi = (parseFloat(rowObj.TonDauNgay) || 0) + (parseFloat(rowObj.NhapTrongNgay) || 0);
    if (rowObj.TonCuoiNgay === '' || rowObj.TonCuoiNgay === undefined || rowObj.TonCuoiNgay === null) {
      rowObj.TonCuoiNgay = tonCuoi;
    }
    var result = upsertRowByKey_(SHEET_NAMES.TON_KHO_SKU, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_TON_KHO_SKU', rowObj.Key_Id, '');
    return result;
  });
}
function deleteTonKhoSKU(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.TON_KHO_SKU, 'Key_Id', keyId);
    if (result.success) logAudit_(account.username, 'XOA_TON_KHO_SKU', keyId, '');
    return result;
  });
}

// --- Gợi ý đặt hàng đã lưu (SL hệ thống gợi ý + SL người dùng thực đặt) ---
// Dùng làm lịch sử để tính độ chính xác dự báo (MAPE) — client tự đối chiếu với doanh số thực tế sau đó.
function saveGoiYDatHang(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Ngay;
    var result = upsertRowByKey_(SHEET_NAMES.GOI_Y_DAT_HANG, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_GOI_Y_DAT_HANG', rowObj.Key_Id,
      'SlGoiY=' + rowObj.SlGoiY + ' SlThucDat=' + rowObj.SlThucDat);
    return result;
  });
}
/** Lưu hàng loạt gợi ý cùng lúc (khi bấm "Lưu SL Thực Đặt" cho cả bảng) — dùng 1 lock duy nhất cho nhanh. */
function saveGoiYDatHangBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.GOI_Y_DAT_HANG);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.GOI_Y_DAT_HANG]);
      var map = getHeaderMap_(sh);
      var keyColIdx = map['Key_Id'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.GOI_Y_DAT_HANG];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Ngay;
        rowObj.SavedAt = nowStr_();
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        var foundRow = existingKeys[String(rowObj.Key_Id)];
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
          forceTextFormat_(sh, [map['Ngay']], 1, foundRow);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
        forceTextFormat_(sh, [map['Ngay']], appended.length, startRow);
      }
      logAudit_(account.username, 'LUU_GOI_Y_DAT_HANG_BATCH', SHEET_NAMES.GOI_Y_DAT_HANG, saved + ' dòng đã lưu');
      invalidateMasterCache_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Lưu hàng loạt tồn kho SKU (dùng cho bảng tồn đầu/cuối kỳ theo từng sản phẩm) — 1 lock duy nhất cho nhanh. */
function saveTonKhoSKUBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.TON_KHO_SKU);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.TON_KHO_SKU]);
      var map = getHeaderMap_(sh);
      var keyColIdx = map['Key_Id'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.TON_KHO_SKU];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Ngay;
        rowObj.SavedAt = nowStr_();
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        var foundRow = existingKeys[String(rowObj.Key_Id)];
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
          forceTextFormat_(sh, [map['Ngay']], 1, foundRow);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
        forceTextFormat_(sh, [map['Ngay']], appended.length, startRow);
      }
      logAudit_(account.username, 'LUU_TON_KHO_SKU_BATCH', SHEET_NAMES.TON_KHO_SKU, saved + ' dòng đã lưu');
      invalidateMasterCache_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

// --- Khuyến mãi / sự kiện (dùng để loại nhiễu baseline VÀ nhân hệ số cho ngày dự báo có sự kiện) ---
function saveKhuyenMai(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.HeSoSuKien) rowObj.HeSoSuKien = 1.3;
    var result = upsertRowByKey_(SHEET_NAMES.KHUYEN_MAI, 'Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_KHUYEN_MAI', rowObj.TenSuKien || '', JSON.stringify(rowObj));
    return result;
  });
}
function deleteKhuyenMai(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.KHUYEN_MAI, 'Id', id);
    if (result.success) logAudit_(account.username, 'XOA_KHUYEN_MAI', id, '');
    return result;
  });
}

/**
 * Xuất phiếu đặt hàng theo cửa hàng dưới dạng dữ liệu có cấu trúc để client dựng Excel bằng SheetJS
 * (giữ đúng nguyên tắc không round-trip file nhị phân qua Apps Script). Hàm này chỉ ghi lại lịch sử
 * gợi ý đã xuất (phục vụ audit), việc tạo file .xlsx thực hiện ở client.
 */
function logXuatPhieuDatHang(token, store, ngay, soLuongDong) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    logAudit_(account.username, 'XUAT_PHIEU_DAT_HANG', store + ' | ' + ngay, soLuongDong + ' dòng SKU');
    return ok_({ message: 'Đã ghi log xuất phiếu.' });
  });
}

// ============================================================================================
// ============================================================================================
// GIAI ĐOẠN 4 — 8.x MỤC TIÊU DOANH THU (dùng cho Phân Tích Chuyên Sâu + dự phóng hoàn thành)
// ============================================================================================
// RFM, cảnh báo hết hàng real-time và benchmark cửa hàng đều tính hoàn toàn ở CLIENT từ
// GD.rawData + GD.master.tonKhoSKU đã tải sẵn (không cần thêm sheet/API). Mục tiêu doanh thu
// là dữ liệu người dùng NHẬP TAY nên cần 1 sheet + CRUD riêng dưới đây.
// ============================================================================================
function saveMucTieu(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.MUC_TIEU, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_MUC_TIEU', rowObj.Key_Id, 'MucTieuDoanhThu=' + rowObj.MucTieuDoanhThu);
    return result;
  });
}
function deleteMucTieu(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.MUC_TIEU, 'Key_Id', keyId);
    if (result.success) logAudit_(account.username, 'XOA_MUC_TIEU', keyId, '');
    return result;
  });
}
/** Ghi kết ca nhiều cửa hàng (mỗi cửa hàng 1 sheet) vào 1 Google Sheet đích do người dùng dán link. */
function writeKetCaSheetsToGoogleSheet(token, sheetUrl, sheetsPayload) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!sheetUrl || !sheetsPayload || sheetsPayload.length === 0) return fail_('Thiếu link Google Sheet hoặc dữ liệu để ghi.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var targetSS;
      try {
        targetSS = SpreadsheetApp.openByUrl(sheetUrl);
      } catch (e) {
        return fail_('Không mở được Google Sheet — kiểm tra lại link và đảm bảo tài khoản chạy script có quyền chỉnh sửa file đó.');
      }
      var written = 0;
      sheetsPayload.forEach(function (sp) {
        var safeName = String(sp.name || 'CuaHang').substring(0, 95);
        var sh = targetSS.getSheetByName(safeName);
        if (sh) { sh.clear(); sh.clearFormats(); } else { sh = targetSS.insertSheet(safeName); }
        if (sp.aoa && sp.aoa.length > 0) {
          var numRows = sp.aoa.length, numCols = sp.aoa[0].length;
          kcPutGrid_(sh, 1, 1, sp.aoa);
          formatKetCaSheetColors_(sh, numRows, numCols);
        }
        written++;
      });
      logAudit_(account.username, 'GHI_KET_CA_GOOGLE_SHEET', sheetUrl, written + ' sheet đã ghi');
      return ok_({ written: written, url: targetSS.getUrl() });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Tô màu 1 sheet Kết Ca vừa ghi — cấu trúc dòng CỐ ĐỊNH (xem buildKetCaMonthAOA_ ở client):
 * dòng 1 = header; dòng 2-18 = Ca Sáng (17 dòng); dòng 19-35 = Ca Tối (17 dòng);
 * dòng 36-42 = 7 dòng đối chiếu toàn chuỗi; dòng 43 = Tiền Két. */
function formatKetCaSheetColors_(sh, numRows, numCols) {
  var GREEN_DARK = '#0a2a1c', GREEN = '#146c43', GREEN_LIGHT = '#eafaf1', GREEN_LIGHT2 = '#c9ecd9';
  var YELLOW_LIGHT = '#fff8ec', YELLOW_LIGHT2 = '#ffe6b8', GOLD = '#fff3c4', GOLD2 = '#ffe28a';
  sh.getRange(1, 1, 1, numCols).setBackground(GREEN).setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  function paintBlock(startRow, numBlockRows, bg, bgFirstCol) {
    if (startRow > numRows) return;
    var rows = Math.min(numBlockRows, numRows - startRow + 1);
    if (rows <= 0) return;
    sh.getRange(startRow, 1, rows, numCols).setBackground(bg);
    sh.getRange(startRow, 1, rows, 1).setBackground(bgFirstCol).setFontWeight('bold');
  }
  	paintBlock(2, 20, GREEN_LIGHT, GREEN_LIGHT2);
  paintBlock(22, 20, YELLOW_LIGHT, YELLOW_LIGHT2);
  	paintBlock(42, 7, GOLD, GOLD2);
  	if (numRows >= 49) {
    sh.getRange(49, 1, 1, numCols).setBackground(GREEN_DARK).setFontColor('#ffffff').setFontWeight('bold');
  }
  sh.getRange(1, 1, numRows, numCols).setBorder(true, true, true, true, true, true, '#b7c2ba', SpreadsheetApp.BorderStyle.SOLID);
  if (numCols > 2) sh.getRange(2, 2, numRows - 1, numCols - 1).setNumberFormat('#,##0');
  sh.autoResizeColumns(1, Math.min(numCols, 30));
}
/** Dọn hàng loạt các dòng override giá vốn bị lưu nhầm giá trị 0 — chỉ Admin. */
function clearZeroGiaVonOverrides(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.GIA_VON_SKU);
      if (!sh || sh.getLastRow() < 2) return ok_({ removed: 0 });
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var keepRows = [], removed = 0;
      values.forEach(function (row) {
        var donGiaVon = parseFloat(row[map['DonGiaVon'] - 1]) || 0;
        if (donGiaVon <= 0) { removed++; return; }
        keepRows.push(row);
      });
      if (removed > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
      }
      logAudit_(guard.account.username, 'DON_GIA_VON_0', SHEET_NAMES.GIA_VON_SKU, removed + ' dòng bị xoá');
      invalidateMasterCache_();
      return ok_({ removed: removed });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Ghi bảng Thống Kê Sữa Chua & Panna (1 cửa hàng/tháng) vào 1 sheet trong Google Sheet đích, có màu. */
function writeSuaChuaPanaToGoogleSheet(token, sheetUrl, sheetName, aoa) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!sheetUrl || !aoa || aoa.length === 0) return fail_('Thiếu link Google Sheet hoặc dữ liệu để ghi.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var targetSS;
      try {
        targetSS = SpreadsheetApp.openByUrl(sheetUrl);
      } catch (e) {
        return fail_('Không mở được Google Sheet — kiểm tra lại link và đảm bảo tài khoản chạy script có quyền chỉnh sửa file đó.');
      }
      var safeName = String(sheetName || 'SuaChua_Panna').substring(0, 95);
      var sh = targetSS.getSheetByName(safeName);
      if (sh) { sh.clear(); sh.clearFormats(); } else { sh = targetSS.insertSheet(safeName); }
      var numRows = aoa.length, numCols = aoa[0].length;
      sh.getRange(1, 1, numRows, numCols).setValues(aoa);
      sh.getRange(1, 1, 1, numCols).setBackground('#146c43').setFontColor('#ffffff').setFontWeight('bold');
      if (numRows >= 2) sh.getRange(2, 1, 1, numCols).setBackground('#eafaf1');
      if (numRows >= 3) sh.getRange(3, 1, 1, numCols).setBackground('#fff8ec');
      if (numRows >= 4) sh.getRange(4, 1, 1, numCols).setBackground('#0a2a1c').setFontColor('#ffffff').setFontWeight('bold');
      sh.getRange(1, 1, numRows, numCols).setBorder(true, true, true, true, true, true, '#b7c2ba', SpreadsheetApp.BorderStyle.SOLID);
      sh.setFrozenRows(1);
      sh.setFrozenColumns(2);
      sh.autoResizeColumns(1, Math.min(numCols, 30));
      logAudit_(account.username, 'GHI_SUACHUAPANA_GOOGLE_SHEET', sheetUrl, safeName);
      return ok_({ url: targetSS.getUrl(), sheetName: safeName });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Tồn kho theo file "Xuất nhập tồn chi tiết" KiotViet — mỗi (Cửa hàng, Tháng, Mã hàng) 1 dòng. */
var TKK_NAME_ = 'Data_TonKhoKiot';
var TKK_SCHEMA_ = ['Key_Id', 'Store', 'Thang', 'ItemCode', 'ItemName', 'TonDau', 'Nhap', 'XuatBan', 'XuatHuy', 'XuatKhac', 'TonCuoi', 'FileName', 'SavedAt', 'NhapTra', 'XuatTra', 'ImportId'];

function saveTonKhoKiotBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    SHEET_SCHEMAS[TKK_NAME_] = TKK_SCHEMA_;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(TKK_NAME_);
      ensureSchema_(sh, TKK_SCHEMA_);
      var map = getHeaderMap_(sh);
      ['Key_Id', 'Thang', 'ItemCode'].forEach(function (c) {
        if (map[c]) sh.getRange(2, map[c], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
      });

      rows = rows.filter(function (r) { return r.Store && r.Thang && r.ItemCode && khoCanEditStore_(account, r.Store); });
      var currentImportId = String((rows[0] && rows[0].ImportId) || '');
      if (rows.length === 0) return ok_({ saved: 0 });

      // (MỚI) Thay thế toàn bộ: xoá HẾT dòng cũ của đúng (Cửa hàng, Tháng) có trong lô này trước khi
      // ghi dòng mới — tránh sản phẩm cũ không còn trong file mới bị tồn lại sai lệch. KHÔNG đụng
      // Data_TonKhoDoiSoat / Data_TonKhoKetChuyen (kiểm kê & kết chuyển vẫn được giữ nguyên).
      var comboSet = {};
      rows.forEach(function (r) { comboSet[r.Store + '|' + r.Thang] = true; });
      var lastRow = sh.getLastRow();
      var removedOld = 0;
      if (lastRow > 1) {
        var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
        var keepRows = [];
        values.forEach(function (row) {
          var combo = row[map['Store'] - 1] + '|' + row[map['Thang'] - 1];
          var oldImportId = String(row[map['ImportId'] - 1] || '');
          var rowImportId = map['ImportId'] ? String(row[map['ImportId'] - 1]) : '';
          if (comboSet[combo] && rowImportId !== currentImportId) removedOld++; else keepRows.push(row);
        });
        if (removedOld > 0) {
          if (keepRows.length > 0) sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          var tail = (lastRow - 1) - keepRows.length;
          if (tail > 0) sh.getRange(2 + keepRows.length, 1, tail, sh.getLastColumn()).clearContent();
        }
      }

      var appended = [], saved = 0;
      rows.forEach(function (r) {
        r.Key_Id = r.Store + '|' + r.Thang + '|' + r.ItemCode;
        r.SavedAt = nowStr_();
        var maxCol = Math.max.apply(null, Object.keys(map).map(function (c) { return map[c]; }));
        var lineVals = [];
        for (var z = 0; z < maxCol; z++) lineVals.push('');
        Object.keys(map).forEach(function (c) { lineVals[map[c] - 1] = r.hasOwnProperty(c) ? r[c] : ''; });
        appended.push(lineVals);
        saved++;
      });
      if (appended.length > 0) sh.getRange(sh.getLastRow() + 1, 1, appended.length, appended[0].length).setValues(appended);
      logAudit_(account.username, 'NAP_TON_KHO_KIOT', TKK_NAME_, saved + ' dòng (đã thay thế ' + removedOld + ' dòng cũ cùng Cửa hàng/Tháng)');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved, removedOld: removedOld });
    } finally { lock.releaseLock(); }
  });
}
/* ============================================================================
 * NẠP 1 LẦN — ĐIỆN NƯỚC THÁNG 09/2026 (lấy từ báo cáo lợi nhuận tháng 08)
 * ============================================================================ */
function xemTruocDienNuocThang9() { seedDienNuocThang_(true); }
function napDienNuocThang9() { seedDienNuocThang_(false); }

function seedDienNuocThang_(dryRun) {
  var THANG = '2026-09';
  var DATA = [
    { ten: '69 Đội Cấn',   re: /\b69\b|doi can/,           tien: 1200000 },
    { ten: 'Bạc Liêu',     re: /bac lieu/,                 tien: 1600000 },
    { ten: 'Long Biên',    re: /long bien/,                tien: 1360000 },
    { ten: 'Cà Mau',       re: /ca mau/,                   tien: 1200000 },
    { ten: 'Mỹ Tho',       re: /my tho/,                   tien: 470000 },
    { ten: 'BMT',          re: /\bbmt\b|buon ma thuot/,    tien: 613000 },
    { ten: '124 Mậu Thân', re: /\b124\b|mau than/,         tien: 2710000 },
    { ten: 'Quận 5',       re: /quan\s*5\b/,               tien: 3892000 },
    { ten: '49 Hàng Bài',  re: /49\s*hb|\b49\b|hang bai/,  tien: 1768000 }
  ];
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  var stores = readSheetAsObjects_(SHEET_NAMES.STORE_SETTINGS)
    .map(function (s) { return String(s.Store_Name || '').trim(); })
    .filter(Boolean);

  // Mỗi dòng phải khớp ĐÚNG 1 cửa hàng, nếu 0 hoặc >1 thì bỏ qua và báo trong nhật ký
  var plan = [];
  DATA.forEach(function (d) {
    var hits = stores.filter(function (s) { return d.re.test(norm(s)); });
    if (hits.length === 1) plan.push({ store: hits[0], tien: d.tien });
    Logger.log((hits.length === 1 ? 'OK      ' : 'BỎ QUA  ') + d.ten + ' → ' +
      (hits.length ? hits.join(' ; ') : '(không khớp cửa hàng nào)') + ' | ' + d.tien);
  });

  if (dryRun) { Logger.log('XEM TRƯỚC — chưa ghi gì. Nếu các dòng OK đúng cửa hàng thì chạy napDienNuocThang9.'); return; }
  if (plan.length === 0) { Logger.log('Không có cửa hàng nào khớp — dừng.'); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('Hệ thống đang bận, chạy lại sau.'); return; }
  try {
    var sh = getOrCreateSheet_(SHEET_NAMES.CHI_PHI);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.CHI_PHI]);
    var schema = SHEET_SCHEMAS[SHEET_NAMES.CHI_PHI];
    var map = getHeaderMap_(sh);
    var lastRow = sh.getLastRow();
    var rowOf = {};
    if (lastRow > 1) {
      sh.getRange(2, map['Key_Id'], lastRow - 1, 1).getValues()
        .forEach(function (k, i) { rowOf[String(k[0])] = i + 2; });
    }
    plan.forEach(function (p) {
      var key = p.store + '|' + THANG;
      var r = rowOf[key];
      if (r) { // đã có dòng chi phí tháng này -> chỉ sửa đúng ô Điện nước, giữ nguyên các ô khác
        sh.getRange(r, map['DienNuoc']).setValue(p.tien);
        sh.getRange(r, map['SavedAt']).setValue(nowStr_());
      } else {
        r = sh.getLastRow() + 1;
        var obj = { Key_Id: key, Store: p.store, Thang: THANG, DienNuoc: p.tien, SavedAt: nowStr_() };
        forceTextFormat_(sh, [map['Thang']], 1, r);
        sh.getRange(r, 1, 1, schema.length).setValues([schema.map(function (c) { return obj.hasOwnProperty(c) ? obj[c] : ''; })]);
        rowOf[key] = r;
      }
    });
    invalidateMasterCache_();
    bumpDataVersion_(); // buộc mọi trình duyệt tải lại, tránh cache cũ ghi đè mất số điện nước
    logAudit_('script', 'NAP_DIEN_NUOC_THANG_9', THANG, plan.length + ' cửa hàng');
    Logger.log('Đã ghi Điện nước tháng ' + THANG + ' cho ' + plan.length + ' cửa hàng.');
  } finally {
    lock.releaseLock();
  }
}
/** Chạy 1 lần: xoá giờ công nạp theo THÁNG (Data_PhuCap.TongGioCong) — giữ nguyên nhân viên, phụ cấp, chấm công theo ngày. */
function xoaGioCongThangTrungLap() {
  var sh = SS.getSheetByName(SHEET_NAMES.PHU_CAP);
  if (!sh || sh.getLastRow() < 2) { Logger.log('Data_PhuCap không có dữ liệu.'); return; }
  var map = getHeaderMap_(sh);
  if (!map['TongGioCong']) { Logger.log('Không thấy cột TongGioCong.'); return; }
  var rng = sh.getRange(2, map['TongGioCong'], sh.getLastRow() - 1, 1);
  var cleared = rng.getValues().filter(function (r) { return String(r[0]).trim() !== ''; }).length;
  rng.clearContent();
  invalidateMasterCache_();
  bumpDataVersion_();
  logAudit_('script', 'XOA_GIO_CONG_THANG_TRUNG_LAP', SHEET_NAMES.PHU_CAP, cleared + ' ô giờ công đã xoá');
  Logger.log('Đã xoá ' + cleared + ' ô giờ công theo tháng. Nhân viên và phụ cấp giữ nguyên.');
}
/** GIAI ĐOẠN 12 — ĐĂNG NHẬP 1 LẦN TRÊN THIẾT BỊ. CacheService tối đa vài tiếng là hết hạn,
 * nên lưu thêm bản dài hạn ở PropertiesService (tự kiểm tra hạn bằng field exp, không dùng TTL). */
var LONG_TOKEN_DAYS = 90;
function saveLongLivedToken_(token, account) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      CACHE_KEYS.TOKEN_PREFIX + token,
      JSON.stringify({ account: account, exp: Date.now() + LONG_TOKEN_DAYS * 24 * 60 * 60 * 1000 })
    );
  } catch (e) {
    Logger.log('Không lưu được long-lived token (không ảnh hưởng đăng nhập hiện tại): ' + e);
  }
}
/** Client gọi hàm này khi mở lại trang, kèm token đã lưu ở localStorage, để tự vào thẳng trang chủ. */
function validateToken(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    return ok_({ role: account.role, stores: account.stores, username: account.username });
  });
}
// ============================================================================
// GIAI ĐOẠN 13 — ĐỀ XUẤT ĐIỀU CHỈNH TARGET THEO MÙA CAO ĐIỂM / THẤP ĐIỂM
// ============================================================================
function saveTargetDieuChinh(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.TARGET_DIEU_CHINH, 'Key_Id', rowObj);
    if (result.success) { logAudit_(account.username, 'LUU_TARGET_DIEU_CHINH', rowObj.Key_Id, 'PhanTramDieuChinh=' + rowObj.PhanTramDieuChinh); bumpDataVersion_(); }
    return result;
  });
}
function deleteTargetDieuChinh(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.TARGET_DIEU_CHINH, 'Key_Id', keyId);
    if (result.success) { logAudit_(account.username, 'XOA_TARGET_DIEU_CHINH', keyId, ''); bumpDataVersion_(); }
    return result;
  });
}
/**
 * SỬA LỖI: "VAT bị ghi nhầm thành Giảm giá".
 * ----------------------------------------------------------------------------
 * NGUYÊN NHÂN: Nút "Sửa Toàn Bộ Dữ Liệu Giảm Giá / VAT Cũ" (repairAllChietKhauVatData)
 * tính lại Giảm giá bằng công thức:
 *      Giảm giá = Giá bán niêm yết (Danh Mục Sản Phẩm) × SL − Thành tiền chưa VAT
 * Nhưng "Giá bán niêm yết" trong Danh Mục Sản Phẩm là giá ĐÃ GỒM VAT, nên với các
 * dòng KHÔNG hề có giảm giá thật, công thức trên luôn cho ra kết quả đúng bằng VAT
 * → hệ thống tự ghi đè cột Giảm giá = VAT một cách sai lệch.
 *
 * HÀM NÀY: Quét lại toàn bộ Data_Doc, với dòng nào có Giảm giá đã lưu gần bằng
 * đúng VAT của dòng đó (chênh lệch < 1đ, và VAT > 0) → đặt lại Giảm giá = 0.
 * Các dòng có Giảm giá THẬT SỰ khác VAT rõ rệt (ví dụ giảm 190.000đ mà VAT = 0)
 * sẽ được GIỮ NGUYÊN, không đụng tới.
 * VAT (vatHang) và dữ liệu Kết Ca KHÔNG bị đụng tới trong bất kỳ trường hợp nào.
 *
 * LƯU Ý: Với các dòng dữ liệu cũ chưa từng có trường Giảm giá (nạp trước khi cột
 * này tồn tại), hàm cũng đặt về 0 vì không còn cách nào lấy lại đúng số gốc trong
 * file Excel đã nạp trước đây — đây là lựa chọn an toàn nhất (không giảm giá thay
 * vì đoán sai bằng công thức lỗi).
 * ----------------------------------------------------------------------------
 * CÁCH CHẠY 1 LẦN (không cần nạp lại file):
 *   - Cách A: Dán hàm này vào Code.gs, lưu lại, vào tab Quản Trị Hệ Thống trên web
 *     app, thay nút cũ bằng nút mới gọi đúng hàm fixGiaGiamBiNhamThanhVAT (xem file
 *     hướng dẫn phần Index.html đi kèm).
 *   - Cách B (nhanh, không cần sửa giao diện): Trong Apps Script editor, chọn hàm
 *     "chayFixGiaGiamBiNhamThanhVAT_MotLan" ở thanh chọn hàm trên cùng rồi bấm ▶ Run.
 *     Lần đầu sẽ được yêu cầu cấp quyền — chấp nhận rồi chạy lại. Xem kết quả ở
 *     "Executions" hoặc View > Logs (Ctrl+Enter).
 */
function fixGiaGiamBiNhamThanhVAT(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getDataDocSheet_();
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ updated: 0, scanned: 0 });

      var map = getHeaderMap_(sh);
      var docColIdx = map['Doc'];
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var updated = 0;

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var docObj;
        try { docObj = JSON.parse(row[docColIdx - 1]); } catch (e) { continue; }

        var vat = parseFloat(docObj.vatHang) || 0;
        var stored = (docObj.giaGiamHang === undefined || docObj.giaGiamHang === null)
          ? null : (parseFloat(docObj.giaGiamHang) || 0);

        var isBug = (stored === null && vat > 0) ||
                    (stored !== null && vat > 0 && Math.abs(stored - vat) <= 2);

        if (!isBug) continue;
        if (stored === 0) continue; // đã đúng sẵn — bỏ qua cho nhanh

        docObj.giaGiamHang = 0;
        // vatHang GIỮ NGUYÊN tuyệt đối.
        sh.getRange(i + 2, docColIdx).setValue(JSON.stringify(docObj));
        updated++;
      }

      logAudit_(guard.account.username, 'SUA_GIAM_GIA_NHAM_VAT', 'Data_Doc',
        updated + ' dòng đã đặt lại Giảm giá = 0 (do trùng VAT)');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ updated: updated, scanned: values.length });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Chạy nhanh trực tiếp trong Apps Script editor (không qua web app) — dùng tài khoản Admin cứng để bỏ qua kiểm tra token. */
function chayFixGiaGiamBiNhamThanhVAT_MotLan() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Hệ thống đang bận, thử lại sau.'); return; }
  try {
    var sh = getDataDocSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) { Logger.log('Không có dữ liệu.'); return; }
    var map = getHeaderMap_(sh);
    var docColIdx = map['Doc'];
    var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var updated = 0;
    for (var i = 0; i < values.length; i++) {
      var docObj;
      try { docObj = JSON.parse(values[i][docColIdx - 1]); } catch (e) { continue; }
      var vat = parseFloat(docObj.vatHang) || 0;
      var stored = (docObj.giaGiamHang === undefined || docObj.giaGiamHang === null)
        ? null : (parseFloat(docObj.giaGiamHang) || 0);
      var isBug = (stored === null && vat > 0) || (stored !== null && vat > 0 && Math.abs(stored - vat) <= 2);
      if (!isBug || stored === 0) continue;
      docObj.giaGiamHang = 0;
      sh.getRange(i + 2, docColIdx).setValue(JSON.stringify(docObj));
      updated++;
    }
    invalidateMasterCache_();
    bumpDataVersion_();
    Logger.log('Đã sửa ' + updated + '/' + values.length + ' dòng. Mở lại web app (F5) để thấy số mới.');
  } finally {
    lock.releaseLock();
  }
}
/**
 * BÁO CÁO ĐỐI SOÁT TOÀN BỘ TRẢ HÀNG NHẬP — chỉ đọc, không sửa gì.
 * Xuất ra sheet "BaoCao_ThnDoiSoat": mỗi dòng = 1 (mã phiếu + mã hàng),
 * kèm tổng SL hiện tại, số dòng, SL chờ/đã xác nhận, và chi tiết từng dòng.
 */
function thnBaoCaoDoiSoat() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ['Data_BanhSale', SHEET_NAMES.XUAT_KHAC];
  var groups = {};

  sheetNames.forEach(function (sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var ghiChu = String(row[col['GhiChu']] || '');
      var m = ghiChu.match(/^THN:(\S+)\s*\|\s*(CHO|XN)\s*\|/);
      if (!m) continue;
      var maPhieu = m[1], trangThai = m[2];
      var itemCode = row[col['ItemCode']];
      var key = maPhieu + '|' + itemCode;
      if (!groups[key]) {
        groups[key] = { maPhieu: maPhieu, store: row[col['Store']], itemCode: itemCode, itemName: row[col['ItemName']], rows: [] };
      }
      groups[key].rows.push({
        sheet: sheetName, row: i + 1, keyId: row[col['Key_Id']],
        sl: parseFloat(row[col['SoLuong']]) || 0, trangThai: trangThai
      });
    }
  });

  var out = ss.getSheetByName('BaoCao_ThnDoiSoat');
  if (out) out.clear(); else out = ss.insertSheet('BaoCao_ThnDoiSoat');
  var header = ['Mã phiếu', 'Cửa hàng', 'Mã hàng', 'Tên hàng', 'Tổng SL hiện tại', 'Số dòng', 'SL Chờ XN', 'SL Đã XN', 'Chi tiết (sheet:row:KeyId:SL:TrạngThái)'];
  var rows = [header];
  Object.keys(groups).sort().forEach(function (k) {
    var g = groups[k];
    var tong = 0, cho = 0, xn = 0;
    var chiTiet = g.rows.map(function (r) {
      tong += r.sl;
      if (r.trangThai === 'CHO') cho += r.sl; else xn += r.sl;
      return r.sheet + ':' + r.row + ':' + r.keyId + ':' + r.sl + ':' + r.trangThai;
    }).join(' | ');
    rows.push([g.maPhieu, g.store, g.itemCode, g.itemName, tong, g.rows.length, cho, xn, chiTiet]);
  });
  out.getRange(1, 1, rows.length, header.length).setValues(rows);
  out.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#146c43').setFontColor('#ffffff');
  out.setFrozenRows(1);
  out.autoResizeColumns(1, header.length);
  Logger.log('Đã tạo báo cáo tại sheet "BaoCao_ThnDoiSoat" — ' + (rows.length - 1) + ' nhóm (phiếu + sản phẩm).');
}

/**
 * SỬA LẠI ĐÚNG SỐ LƯỢNG cho từng (mã phiếu + mã hàng), theo số ĐÚNG bạn cung cấp
 * (lấy từ file KiotViet gốc). CHỈ xóa/giảm ở các dòng "Đã xác nhận" (XN) — KHÔNG BAO GIỜ
 * đụng vào dòng "Chờ xác nhận" (CHO). Nếu gặp trường hợp không rõ ràng, chỉ CẢNH BÁO
 * trong log, không tự làm gì cả.
 *
 * danhSach: [{ maPhieu: 'THN006012.01', itemCode: 'SP001', soLuongDung: 2 }, ...]
 * (lấy itemCode chính xác từ cột "Mã hàng" trong sheet BaoCao_ThnDoiSoat ở trên)
 */
/**
 * Sửa lại đúng số lượng cho từng (mã phiếu + mã hàng), theo số ĐÚNG được cung cấp.
 * CHỈ xóa/giảm ở các dòng "Đã xác nhận" (XN) — KHÔNG BAO GIỜ đụng dòng "Chờ xác nhận" (CHO).
 * Có LockService để an toàn khi chạy đồng thời với người dùng đang xác nhận trên web app.
 * danhSach: [{ maPhieu, itemCode, soLuongDung }, ...]
 */
function thnSuaSoLuongDung(danhSach) {
  if (!danhSach || !danhSach.length) {
    Logger.log('LỖI: thnSuaSoLuongDung() cần được gọi kèm danh sách sửa.');
    return [];
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) { return ['Hệ thống đang bận ghi dữ liệu khác, vui lòng thử lại sau ít phút.']; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNames = ['Data_BanhSale', SHEET_NAMES.XUAT_KHAC];
    var sheetData = {};
    sheetNames.forEach(function (sheetName) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) return;
      var data = sh.getDataRange().getValues();
      var headers = data[0];
      var col = {};
      headers.forEach(function (h, i) { col[h] = i; });
      sheetData[sheetName] = { sh: sh, col: col, data: data };
    });

    var report = [];
    var deletePlan = {};
    var reducePlan = [];

    danhSach.forEach(function (spec) {
      var maPhieu = String(spec.maPhieu).trim();
      var itemCode = String(spec.itemCode).trim();
      var target = parseFloat(spec.soLuongDung);
      var matched = [];

      sheetNames.forEach(function (sheetName) {
        var sd = sheetData[sheetName];
        if (!sd) return;
        for (var i = 1; i < sd.data.length; i++) {
          var row = sd.data[i];
          var ghiChu = String(row[sd.col['GhiChu']] || '');
          var m = ghiChu.match(/^THN:(\S+)\s*\|\s*(CHO|XN)\s*\|/);
          if (!m || m[1] !== maPhieu) continue;
          if (String(row[sd.col['ItemCode']]).trim() !== itemCode) continue;
          matched.push({ sheetName: sheetName, rowNumber: i + 1, sl: parseFloat(row[sd.col['SoLuong']]) || 0, trangThai: m[2], keyId: row[sd.col['Key_Id']] });
        }
      });

      if (matched.length === 0) { report.push(maPhieu + ' | ' + itemCode + ' → KHÔNG TÌM THẤY dòng nào, bỏ qua.'); return; }
      var currentTotal = matched.reduce(function (s, r) { return s + r.sl; }, 0);
      if (Math.abs(currentTotal - target) < 1e-9) { report.push(maPhieu + ' | ' + itemCode + ' → Đã đúng (' + target + '), không sửa.'); return; }
      if (currentTotal < target) { report.push(maPhieu + ' | ' + itemCode + ' → CẢNH BÁO: hiện có ' + currentTotal + ', THIẾU so với ' + target + '. Không tự sửa, cần kiểm tra tay.'); return; }

      var excess = currentTotal - target;
      var xnRows = matched.filter(function (r) { return r.trangThai === 'XN'; }).sort(function (a, b) { return a.sl - b.sl; });

      var localDelete = [], localReduce = null;
      for (var k = 0; k < xnRows.length && excess > 1e-9; k++) {
        var r = xnRows[k];
        if (r.sl <= excess + 1e-9) { localDelete.push(r); excess -= r.sl; }
        else { localReduce = { r: r, newSl: r.sl - excess }; excess = 0; }
      }
      if (excess > 1e-9) {
        report.push(maPhieu + ' | ' + itemCode + ' → CẢNH BÁO: dư ' + (currentTotal - target) + ' nhưng dòng "Đã xác nhận" không đủ bù — phần dư nằm ở dòng "Chờ xác nhận". Không tự sửa, cần kiểm tra tay.');
        return;
      }

      localDelete.forEach(function (r) { (deletePlan[r.sheetName] = deletePlan[r.sheetName] || []).push(r.rowNumber); });
      if (localReduce) reducePlan.push({ sheetName: localReduce.r.sheetName, rowNumber: localReduce.r.rowNumber, newSl: localReduce.newSl });

      report.push(maPhieu + ' | ' + itemCode + ' → Xóa ' + localDelete.length + ' dòng đã xác nhận' +
        (localReduce ? ' + giảm 1 dòng từ ' + localReduce.r.sl + ' xuống ' + localReduce.newSl : '') + ' để đưa tổng về đúng ' + target + '.');
    });

    reducePlan.forEach(function (p) {
      var sd = sheetData[p.sheetName], col = sd.col, sh = sd.sh;
      sh.getRange(p.rowNumber, col['SoLuong'] + 1).setValue(p.newSl);
      if (p.sheetName === 'Data_BanhSale') {
        var giaSale = parseFloat(sh.getRange(p.rowNumber, col['GiaSale'] + 1).getValue()) || 0;
        var giaVon = parseFloat(sh.getRange(p.rowNumber, col['GiaVonDonVi'] + 1).getValue()) || 0;
        var giaBanGoc = parseFloat(sh.getRange(p.rowNumber, col['GiaBanGoc'] + 1).getValue()) || 0;
        sh.getRange(p.rowNumber, col['ThanhTienSale'] + 1).setValue(p.newSl * giaSale);
        sh.getRange(p.rowNumber, col['ThanhTienGiaVon'] + 1).setValue(p.newSl * giaVon);
        sh.getRange(p.rowNumber, col['LoiNhuanSale'] + 1).setValue(p.newSl * (giaSale - giaVon));
        sh.getRange(p.rowNumber, col['GiaGiamTong'] + 1).setValue(p.newSl * Math.max(0, giaBanGoc - giaSale));
      } else {
        var loai = sh.getRange(p.rowNumber, col['Loai'] + 1).getValue();
        var vonDv = parseFloat(sh.getRange(p.rowNumber, col['GiaVonDonVi'] + 1).getValue()) || 0;
        sh.getRange(p.rowNumber, col['ThanhTienGiaVon'] + 1).setValue(loai === 'TraTiktok' ? 0 : p.newSl * vonDv);
      }
    });

    Object.keys(deletePlan).forEach(function (sheetName) {
      var sd = sheetData[sheetName];
      var rows = Array.from(new Set(deletePlan[sheetName])).sort(function (a, b) { return b - a; });
      rows.forEach(function (r) { sd.sh.deleteRow(r); });
      report.push('Đã xóa ' + rows.length + ' dòng trong ' + sheetName + ': ' + rows.join(', '));
    });

    invalidateMasterCache_();
    bumpDataVersion_();
    report.forEach(function (line) { Logger.log(line); });
    return report;
  } finally {
    lock.releaseLock();
  }
}

// Đã gỡ bỏ mục "Đối soát hàng nhập" trên web (thnGetBaoCaoDoiSoat, thnSuaMotNhomWeb).
// Nếu cần đối soát thủ công, chạy thnBaoCaoDoiSoat() trực tiếp trong Apps Script Editor
// (Run > thnBaoCaoDoiSoat) — kết quả xuất ra sheet "BaoCao_ThnDoiSoat", không hiện trên web.
/**
 * Xác nhận 1 đơn vị/phần số lượng của dòng Trả Hàng Nhập MỘT CÁCH AN TOÀN (atomic).
 * Luôn đọc số lượng THẬT SỰ đang có trong sheet ngay tại thời điểm ghi (trong cùng 1
 * Lock) — không dùng số lượng mà trình duyệt gửi lên (có thể đã cũ do bấm nhanh nhiều
 * thẻ liên tiếp) — để không bao giờ trừ sai khi nhiều đơn vị của cùng 1 dòng gốc được
 * xác nhận gần như đồng thời.
 */
function thnXacNhanDonViAnToan(token, params) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var pendingSheetName = params.pendingSheet === 'bs' ? SHEET_NAMES.BANH_SALE : SHEET_NAMES.XUAT_KHAC;
    var confirmedSheetName = params.confirmedRow.type === 'bs' ? SHEET_NAMES.BANH_SALE : SHEET_NAMES.XUAT_KHAC;
    var slXacNhan = parseFloat(params.slXacNhan) || 0;
    if (slXacNhan <= 0) return fail_('Số lượng xác nhận không hợp lệ.');

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận ghi dữ liệu khác, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(pendingSheetName);
      if (!sh) return fail_('Không tìm thấy sheet ' + pendingSheetName);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var pendingRow = -1, currentSl = 0;
      if (lastRow > 1) {
        var keys = sh.getRange(2, map['Key_Id'], lastRow - 1, 1).getValues();
        for (var i = 0; i < keys.length; i++) {
          if (String(keys[i][0]) === String(params.pendingKey)) { pendingRow = i + 2; break; }
        }
      }
      if (pendingRow === -1) {
        return fail_('Dòng chờ xác nhận này không còn — có thể vừa được xác nhận xong ở thẻ khác. Vui lòng tải lại phiếu.');
      }
      currentSl = parseFloat(sh.getRange(pendingRow, map['SoLuong']).getValue()) || 0;
      if (slXacNhan > currentSl + 1e-9) {
        return fail_('Số lượng còn lại hiện tại chỉ là ' + currentSl + ' (đã bị xác nhận bớt ở thẻ khác) — vui lòng tải lại phiếu trước khi xác nhận tiếp.');
      }

      var confirmedObj = params.confirmedRow.obj;
      confirmedObj.Key_Id = params.confirmedKeyId;

      // Chống xác nhận trùng (double-click / bấm nhanh nhiều lần / mạng chậm gửi lại
      // request) — nếu dòng "Đã xác nhận" với đúng Key_Id này ĐÃ tồn tại thì coi như
      // yêu cầu này đã xử lý xong từ trước, KHÔNG trừ thêm lần nữa vào dòng chờ xác
      // nhận. Đây là nguyên nhân chính gây lệch kho khi xác nhận nhiều lần liên tiếp.
      var confirmedShCheck = SS.getSheetByName(confirmedSheetName);
      if (confirmedShCheck) {
        var confirmedMapCheck = getHeaderMap_(confirmedShCheck);
        var confirmedLastRowCheck = confirmedShCheck.getLastRow();
        if (confirmedLastRowCheck > 1 && confirmedMapCheck['Key_Id']) {
          var confirmedKeysCheck = confirmedShCheck.getRange(2, confirmedMapCheck['Key_Id'], confirmedLastRowCheck - 1, 1).getValues();
          for (var ci = 0; ci < confirmedKeysCheck.length; ci++) {
            if (String(confirmedKeysCheck[ci][0]) === String(confirmedObj.Key_Id)) {
              return ok_({ remain: currentSl, daXuLyTruocDo: true });
            }
          }
        }
      }

      confirmedObj.SoLuong = slXacNhan;
      var resConfirm = upsertRowByKey_(confirmedSheetName, 'Key_Id', confirmedObj);
      if (!resConfirm.success) return resConfirm;

      var remain = currentSl - slXacNhan;
      if (remain <= 1e-9) {
        sh.deleteRow(pendingRow);
      } else {
        sh.getRange(pendingRow, map['SoLuong']).setValue(remain);
        if (map['ThanhTienSale'] && map['GiaSale']) {
          var giaSale = parseFloat(sh.getRange(pendingRow, map['GiaSale']).getValue()) || 0;
          sh.getRange(pendingRow, map['ThanhTienSale']).setValue(remain * giaSale);
        }
        if (map['ThanhTienGiaVon'] && map['GiaVonDonVi']) {
          var giaVon = parseFloat(sh.getRange(pendingRow, map['GiaVonDonVi']).getValue()) || 0;
          sh.getRange(pendingRow, map['ThanhTienGiaVon']).setValue(remain * giaVon);
        }
        if (map['LoiNhuanSale'] && map['GiaSale'] && map['GiaVonDonVi']) {
          var gs2 = parseFloat(sh.getRange(pendingRow, map['GiaSale']).getValue()) || 0;
          var gv2 = parseFloat(sh.getRange(pendingRow, map['GiaVonDonVi']).getValue()) || 0;
          sh.getRange(pendingRow, map['LoiNhuanSale']).setValue(remain * (gs2 - gv2));
        }
      }

      logAudit_(account.username, 'THN_XAC_NHAN_DON_VI_AN_TOAN', params.pendingKey,
        'Xác nhận ' + slXacNhan + '/' + currentSl + ', còn lại ' + Math.max(0, remain));
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ remain: Math.max(0, remain) });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Đặt lại TOÀN BỘ 1 nhóm (mã phiếu + mã hàng) về đúng 1 dòng "Chờ xác nhận" duy nhất.
 * Xóa hết mọi dòng cũ (cả Chờ XN và Đã XN) của nhóm này, tạo lại 1 dòng sạch với SL đúng.
 * AN TOÀN với "Trả TikTok" (không có doanh thu/chi phí). CẢNH BÁO nếu là Hủy/Khác đã tính
 * chi phí hoặc Bánh Sale đã ghi nhận doanh thu — vẫn thực hiện nhưng trả về cảnh báo rõ ràng.
 */
function thnResetNhomChoXacNhan(token, maPhieu, itemCode, soLuongDung) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sheetNames = ['Data_BanhSale', SHEET_NAMES.XUAT_KHAC];
      var template = null, canhBao = [];
      var deletePlan = {};

      sheetNames.forEach(function (sheetName) {
        var sh = SS.getSheetByName(sheetName);
        if (!sh || sh.getLastRow() < 2) return;
        var data = sh.getDataRange().getValues();
        var headers = data[0], col = {};
        headers.forEach(function (h, i) { col[h] = i; });
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          var ghiChu = String(row[col['GhiChu']] || '');
          var m = ghiChu.match(/^THN:(\S+)\s*\|\s*(CHO|XN)\s*\|(.*)$/);
          if (!m || m[1] !== maPhieu) continue;
          if (String(row[col['ItemCode']]).trim() !== String(itemCode).trim()) continue;
          if (!template) template = { sheetName: sheetName, col: col, row: row.slice(), noteRest: m[3] };
          if (m[2] === 'XN') {
            if (sheetName === 'Data_BanhSale' && (parseFloat(row[col['ThanhTienSale']]) || 0) > 0) {
              canhBao.push('Đã xóa 1 dòng Bánh Sale ĐÃ ghi nhận doanh thu ' + row[col['ThanhTienSale']] + 'đ.');
            }
            if (sheetName === SHEET_NAMES.XUAT_KHAC && row[col['Loai']] !== 'TraTiktok' && (parseFloat(row[col['ThanhTienGiaVon']]) || 0) > 0) {
              canhBao.push('Đã xóa 1 dòng "' + row[col['Loai']] + '" ĐÃ ghi nhận chi phí giá vốn ' + row[col['ThanhTienGiaVon']] + 'đ.');
            }
          }
          (deletePlan[sheetName] = deletePlan[sheetName] || []).push(i + 1);
        }
      });

      if (!template) return fail_('Không tìm thấy dòng nào khớp mã phiếu + mã hàng này.');

      Object.keys(deletePlan).forEach(function (sheetName) {
        var sh = SS.getSheetByName(sheetName);
        var rows = Array.from(new Set(deletePlan[sheetName])).sort(function (a, b) { return b - a; });
        rows.forEach(function (r) { sh.deleteRow(r); });
      });

      var sheetName = template.sheetName, col = template.col, row = template.row;
      var newRow = row.slice();
      newRow[col['GhiChu']] = 'THN:' + maPhieu + ' | CHO |' + template.noteRest;
      newRow[col['SoLuong']] = soLuongDung;
      newRow[col['Key_Id']] = genId_(sheetName === 'Data_BanhSale' ? 'SALE' : 'XK');
      newRow[col['SavedAt']] = nowStr_();
      if (sheetName === 'Data_BanhSale') {
        var giaVon = parseFloat(row[col['GiaVonDonVi']]) || 0;
        newRow[col['GiaSale']] = '';
        newRow[col['ThanhTienSale']] = 0;
        newRow[col['ThanhTienGiaVon']] = soLuongDung * giaVon;
        newRow[col['LoiNhuanSale']] = 0;
        newRow[col['GiaGiamTong']] = 0;
        newRow[col['DaGhiNhanChiPhi']] = false;
      } else {
        var loai = row[col['Loai']];
        var giaVon2 = parseFloat(row[col['GiaVonDonVi']]) || 0;
        newRow[col['LyDo']] = 'Chờ xác nhận';
        newRow[col['ThanhTienGiaVon']] = loai === 'TraTiktok' ? 0 : soLuongDung * giaVon2;
        newRow[col['DaGhiNhanChiPhi']] = false;
      }
      var sh2 = SS.getSheetByName(sheetName);
      sh2.getRange(sh2.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);

      logAudit_(guard.account.username, 'THN_RESET_NHOM', maPhieu + ' | ' + itemCode, 'SL mới=' + soLuongDung + (canhBao.length ? ' | ' + canhBao.join(' ') : ''));
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ message: 'Đã đặt lại — 1 dòng "Chờ xác nhận" duy nhất, SL=' + soLuongDung + '. Vào Kết Ca xác nhận lại.', canhBao: canhBao });
    } finally {
      lock.releaseLock();
    }
  });
}
function thnXacNhanNhieuDonViAnToan(token, payload) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!payload || !payload.units || !payload.units.length) return fail_('Không có đơn vị nào để xác nhận.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var pendingSheetName = payload.pendingSheet === 'bs' ? SHEET_NAMES.BANH_SALE : SHEET_NAMES.XUAT_KHAC;
      var sh = SS.getSheetByName(pendingSheetName);
      if (!sh) return fail_('Không tìm thấy dữ liệu gốc.');
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var foundRow = -1;
      if (lastRow >= 2) {
        var keys = sh.getRange(2, map['Key_Id'], lastRow - 1, 1).getValues();
        for (var i = 0; i < keys.length; i++) {
          if (String(keys[i][0]) === String(payload.pendingKey)) { foundRow = i + 2; break; }
        }
      }
      if (foundRow < 0) return fail_('Dòng gốc không còn tồn tại — có thể đã bị xử lý ở nơi khác, vui lòng tải lại phiếu.');

      var currentSl = parseFloat(sh.getRange(foundRow, map['SoLuong']).getValue()) || 0;
      var sumUnits = 0;
      payload.units.forEach(function (u) { sumUnits += parseFloat(u.obj.SoLuong) || 0; });
      if (Math.abs(sumUnits - currentSl) > 1e-9) {
        return fail_('Số lượng trên hệ thống hiện là ' + currentSl + ' nhưng bạn đang xác nhận ' + sumUnits +
          ' — có thể dữ liệu vừa bị thay đổi ở nơi khác. Vui lòng đóng và mở lại phiếu này rồi xác nhận lại.');
      }

      sh.deleteRow(foundRow);

      payload.units.forEach(function (u) {
        var targetSheetName = u.type === 'bs' ? SHEET_NAMES.BANH_SALE : SHEET_NAMES.XUAT_KHAC;
        if (!u.obj.Key_Id) u.obj.Key_Id = genId_(u.type === 'bs' ? 'SALE' : 'XK');
        u.obj.DaGhiNhanChiPhi = u.obj.DaGhiNhanChiPhi || false;
        upsertRowByKey_(targetSheetName, 'Key_Id', u.obj);
      });

      logAudit_(account.username, 'XAC_NHAN_NHIEU_DON_VI', payload.pendingKey,
        payload.units.length + ' đơn vị, tổng SL=' + sumUnits);
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: payload.units.length });
    } finally {
      lock.releaseLock();
    }
  });
}
// ============================================================================
// V50 — HỆ SỐ LƯƠNG NGÀY LỄ (x1 / x2 / x3) THEO NGÀY, ÁP DỤNG CHO CẢ CHUỖI
// Sheet riêng Data_HeSoLe (tự tạo lần đầu lưu). Không đụng tới Data_CongNhatNgay.
// ============================================================================
var HESO_LE_SHEET_NAME_ = 'Data_HeSoLe';
var HESO_LE_SCHEMA_ = ['Ngay', 'HeSo', 'GhiChu', 'SavedAt', 'User'];

/** Đọc an toàn: chưa có sheet thì trả mảng rỗng (không làm hỏng getSystemMasterData). */
function readHeSoLeSafe_() {
  try { return readSheetAsObjects_(HESO_LE_SHEET_NAME_); } catch (e) { return []; }
}

/** Lưu hệ số lương của 1 ngày (1 = ngày thường, 2 = x2, 3 = x3). Chỉ Admin được đổi vì áp dụng cho cả chuỗi. */
function saveHeSoLe(token, ngay, heSo, ghiChu) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    if (account.role !== 'Admin' && account.stores !== '*') return fail_('Chỉ tài khoản Admin mới được đổi hệ số lương ngày lễ (áp dụng cho cả chuỗi).');
    ngay = String(ngay || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return fail_('Ngày không hợp lệ: ' + ngay);
    var hs = parseFloat(String(heSo == null ? '' : heSo).replace(',', '.'));
    if (!(hs >= 1 && hs <= 5)) return fail_('Hệ số lương phải từ 1 đến 5.');

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(HESO_LE_SHEET_NAME_);
      ensureSchema_(sh, HESO_LE_SCHEMA_);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var foundRow = -1;
      if (lastRow > 1) {
        var keys = sh.getRange(2, map['Ngay'], lastRow - 1, 1).getDisplayValues();
        for (var i = 0; i < keys.length; i++) {
          if (String(keys[i][0]).trim() === ngay) { foundRow = i + 2; break; }
        }
      }
      var rowObj = { Ngay: ngay, HeSo: hs, GhiChu: String(ghiChu || ''), SavedAt: nowStr_(), User: account.username };
      var rowValues = HESO_LE_SCHEMA_.map(function (col) { return rowObj[col]; });
      var targetRow = foundRow > 0 ? foundRow : sh.getLastRow() + 1;
      forceTextFormat_(sh, [map['Ngay']], 1, targetRow);   // giữ "2026-09-02" là text, không bị đổi thành Date
      sh.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      logAudit_(account.username, 'LUU_HE_SO_LUONG_LE', ngay, 'HeSo=' + hs);
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ ngay: ngay, heSo: hs });
    } finally {
      lock.releaseLock();
    }
  });
}
/* ============================================================================
 * V51 — Nhớ nhân viên đã xoá (Id -> Cửa hàng + Họ tên) để khi THÊM LẠI đúng Họ tên + Cửa hàng
 * thì giờ công cũ (Data_CongNhatNgay) tự gắn về Id mới — không cần bấm "Gắn lại giờ công".
 * (dán ở CUỐI Code.gs)
 * ============================================================================ */
var TOMB_SHEET_ = 'Data_NhanVienDaXoa';
var TOMB_SCHEMA_ = ['OldId', 'Store', 'HoTen', 'HoTenNorm', 'DeletedAt'];

/** Khoá so khớp tên: không phân biệt hoa/thường, dấu tiếng Việt, khoảng trắng thừa. */
function nameKeyServer_(name) {
  var s = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return s.replace(/đ/g, 'd');
}

/** Ghi lại nhân viên sắp bị xoá. recs = [{Id, Store, HoTen}]. Lỗi ở đây không được làm hỏng thao tác xoá. */
function stampDeletedNhanVien_(recs) {
  try {
    var list = (recs || []).filter(function (r) { return r && r.Id && String(r.HoTen || '').trim(); });
    if (!list.length) return;
    var sh = getOrCreateSheet_(TOMB_SHEET_);
    ensureSchema_(sh, TOMB_SCHEMA_);
    var rows = list.map(function (r) {
      return [String(r.Id), String(r.Store || '').trim(), String(r.HoTen).trim(), nameKeyServer_(r.HoTen), nowStr_()];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, TOMB_SCHEMA_.length).setNumberFormat('@').setValues(rows);
  } catch (e) { Logger.log('stampDeletedNhanVien_: ' + e); }
}

/** Gọi sau khi THÊM nhân viên mới: tìm các Id cũ đã xoá cùng Cửa hàng + Họ tên -> chuyển giờ công sang newId. */
function autoRelinkGioCongByName_(newId, store, hoTen) {
  var out = { moved: 0, dup: 0 };
  try {
    newId = String(newId || '').trim(); store = String(store || '').trim();
    var key = nameKeyServer_(hoTen);
    var ts = SS.getSheetByName(TOMB_SHEET_);
    if (!newId || !key || !ts || ts.getLastRow() < 2) return out;
    var tv = ts.getRange(2, 1, ts.getLastRow() - 1, TOMB_SCHEMA_.length).getDisplayValues();
    var oldIds = {}, keepTomb = [];
    tv.forEach(function (r) {
      var oid = String(r[0]).trim();
      if (String(r[1]).trim() === store && String(r[3]) === key && oid && oid !== newId) oldIds[oid] = true;
      else keepTomb.push(r);
    });
    var olds = Object.keys(oldIds);
    if (!olds.length) return out;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return out;   // bận -> vẫn còn nút "Gắn lại giờ công" thủ công
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.CONG_NHAT_NGAY);
      if (sh && sh.getLastRow() >= 2) {
        var map = getHeaderMap_(sh), n = sh.getLastRow() - 1;
        var idCol = map['NhanVienId'], keyCol = map['Key_Id'], ngayCol = map['Ngay'], storeCol = map['Store'];
        if (idCol && ngayCol && storeCol) {
          var ids = sh.getRange(2, idCol, n, 1).getDisplayValues();
          var ngays = sh.getRange(2, ngayCol, n, 1).getDisplayValues();
          var stores = sh.getRange(2, storeCol, n, 1).getDisplayValues();
          var keys = keyCol ? sh.getRange(2, keyCol, n, 1).getDisplayValues() : null;
          var have = {}, i;
          for (i = 0; i < n; i++) {
            if (String(ids[i][0]).trim() === newId) have[stores[i][0] + '|' + ngays[i][0]] = true;
          }
          for (i = 0; i < n; i++) {
            var oid = String(ids[i][0]).trim();
            if (!oldIds[oid]) continue;
            var hk = stores[i][0] + '|' + ngays[i][0];
            if (have[hk]) { out.dup++; continue; }
            ids[i][0] = newId;
            if (keys && String(keys[i][0]).indexOf(oid) !== -1) keys[i][0] = String(keys[i][0]).split(oid).join(newId);
            have[hk] = true;
            out.moved++;
          }
          if (out.moved > 0) {
            sh.getRange(2, idCol, n, 1).setNumberFormat('@').setValues(ids);
            if (keys) sh.getRange(2, keyCol, n, 1).setNumberFormat('@').setValues(keys);
          }
        }
      }
      // Gỡ các dòng "đã xoá" vừa xử lý xong
      ts.getRange(2, 1, ts.getLastRow() - 1, TOMB_SCHEMA_.length).clearContent();
      if (keepTomb.length) ts.getRange(2, 1, keepTomb.length, TOMB_SCHEMA_.length).setNumberFormat('@').setValues(keepTomb);
    } finally { lock.releaseLock(); }
    if (out.moved > 0) {
      logAudit_('system', 'TU_GAN_LAI_GIO_CONG', newId + ' <- ' + olds.join(','), out.moved + ' dòng, ' + out.dup + ' trùng ngày bỏ qua');
      invalidateMasterCache_();
    }
  } catch (e) { Logger.log('autoRelinkGioCongByName_: ' + e); }
  return out;
}
/** Tự gắn lại TOÀN BỘ giờ công mồ côi: nhân viên hiện có mà từng có bản ghi "đã xoá" cùng Cửa hàng + Họ tên -> chuyển giờ công về Id hiện tại. */
function autoRelinkAllOrphans_() {
  var out = { moved: 0 };
  try {
    var ts = SS.getSheetByName(TOMB_SHEET_);
    if (!ts || ts.getLastRow() < 2) return out;
    var tv = ts.getRange(2, 1, ts.getLastRow() - 1, TOMB_SCHEMA_.length).getDisplayValues();
    var tombKeys = {};
    tv.forEach(function (r) { tombKeys[String(r[1]).trim() + '|' + String(r[3])] = true; });
    readSheetAsObjects_(SHEET_NAMES.NHAN_VIEN).forEach(function (e) {
      var id = String(e.Id || '').trim();
      if (!id) return;
      if (!tombKeys[String(e.Store || '').trim() + '|' + nameKeyServer_(e.HoTen)]) return;
      out.moved += autoRelinkGioCongByName_(id, e.Store, e.HoTen).moved;
    });
    if (out.moved > 0) {
      invalidateMasterCache_();
      bumpDataVersion_();
    }
  } catch (err) { Logger.log('autoRelinkAllOrphans_: ' + err); }
  return out;
}

/** Client gọi 1 lần khi thấy giờ công mồ côi. */
function autoRelinkOrphansNow(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var r = autoRelinkAllOrphans_();
    return ok_({ moved: r.moved });
  });
}

// ============================================================================
// V51 — Bánh sale theo Kiot (chỉ ghi thông tin) + Nộp tiền mặt về công ty
// ============================================================================
/** Lưu thông tin bánh sale (ngày nhập, ngày rã đông, trạng thái...) — KHÔNG ảnh hưởng doanh thu/tồn kho. */
function saveBanhSaleKiotBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || !rows.length) return ok_({ saved: 0 });
    var saved = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.Store || !r.Ngay || !r.ItemCode) continue;
      r.Key_Id = r.Store + '|' + r.Ngay + '|' + r.ItemCode + '|' + r.GiamPct;
      r.NguoiCapNhat = account.username;
      var res = upsertRowByKey_(SHEET_NAMES.BANH_SALE_KIOT, 'Key_Id', r);
      if (!res.success) return res;
      saved++;
    }
    return ok_({ saved: saved });
  });
}

/** Ghi nhận tiền mặt nộp về công ty trong ngày (SoTien = 0 để huỷ). Số này cộng vào Noti của NGÀY HÔM SAU. */
function saveNopTien(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rowObj || !rowObj.Store || !rowObj.Ngay) return fail_('Thiếu cửa hàng hoặc ngày.');
    rowObj.Key_Id = rowObj.Store + '|' + rowObj.Ngay;
    rowObj.NguoiNop = account.username;
    // V63: tick "Công ty lấy tiền mặt trực tiếp (không chuyển khoản)" → Noti ngày hôm sau KHÔNG cộng khoản này
    rowObj.CtyLayTm = (rowObj.CtyLayTm === true || String(rowObj.CtyLayTm) === '1' || String(rowObj.CtyLayTm).toLowerCase() === 'true') ? 1 : '';
    logAudit_(account.username, 'NOP_TIEN', rowObj.Key_Id, String(rowObj.SoTien) + (rowObj.CtyLayTm ? ' | CTY_LAY_TM' : ''));
    return upsertRowByKey_(SHEET_NAMES.NOP_TIEN, 'Key_Id', rowObj);
  });
}

// ============================================================================
// V57 — Ghi Kết Ca nhiều cửa hàng vào Google Sheet có định dạng giống file Excel
// Client gọi theo từng nhóm sheet (mỗi lần vài cửa hàng) để không quá thời gian.
// ============================================================================
var KC_GS_THEME_ = {
  green: ['#146c43', '#dcfce7'], blue: ['#1d4ed8', '#dbeafe'], orange: ['#c2410c', '#ffedd5'], teal: ['#0f766e', '#ccfbf1'],
  sang: ['#15803d', '#ecfdf5'], toi: ['#b45309', '#fffbeb'], slate: ['#475569', '#f1f5f9']
};
function writeKetCaStyledToGoogleSheet(token, sheetUrl, sheets) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!sheetUrl || !sheets || sheets.length === 0) return fail_('Thiếu link Google Sheet hoặc dữ liệu để ghi.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var ss;
      try { ss = SpreadsheetApp.openByUrl(sheetUrl); }
      catch (e) { return fail_('Không mở được Google Sheet — kiểm tra lại link và đảm bảo tài khoản chạy script có quyền chỉnh sửa file đó.'); }
      var written = 0;
      sheets.forEach(function (sp) { if (sp && sp.tpl) writeKetCaTemplateSheet_(ss, sp); else writeKetCaStyledSheet_(ss, sp); written++; });
      SpreadsheetApp.flush();
      logAudit_(account.username, 'GHI_KET_CA_GOOGLE_SHEET', sheetUrl, written + ' sheet đã ghi (định dạng mới)');
      return ok_({ written: written, url: ss.getUrl() });
    } finally {
      lock.releaseLock();
    }
  });
}
function writeKetCaStyledSheet_(ss, sp) {
  var name = String(sp.name || 'CuaHang').substring(0, 95), nD = sp.days.length, nC = nD + 2;
  var sh = ss.getSheetByName(name);
  if (sh) { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); sh.clear(); sh.clearFormats(); } else { sh = ss.insertSheet(name); }
  var HEAD = 4, nR = HEAD + sp.rows.length;
  if (sh.getMaxColumns() < nC) sh.insertColumnsAfter(sh.getMaxColumns(), nC - sh.getMaxColumns());
  if (sh.getMaxRows() < nR + 1) sh.insertRowsAfter(sh.getMaxRows(), nR + 1 - sh.getMaxRows());
  var MONEY = '#,##0;-#,##0;""', FONT = 'Calibri';
  var vals = [], bg = [], fc = [], fw = [], nf = [], ha = [], wrap = [];
  function blank(v, b, f, w, n, h, wr) {
    var a = []; for (var i = 0; i < nC; i++) a.push(v); return a;
  }
  function pushRow(v, b, f, w, n, h, wr) { vals.push(v); bg.push(b); fc.push(f); fw.push(w); nf.push(n); ha.push(h); wrap.push(wr); }
  function fillArr(x) { var a = []; for (var i = 0; i < nC; i++) a.push(x); return a; }
  // 0 tiêu đề, 1 phụ đề
  var t = fillArr(''); t[0] = sp.title;
  pushRow(t, fillArr('#0a2a1c'), fillArr('#ffffff'), fillArr('bold'), fillArr('@'), fillArr('left'), fillArr(false));
  var s = fillArr(''); s[0] = sp.sub;
  pushRow(s, fillArr('#146c43'), fillArr('#ffffff'), fillArr('bold'), fillArr('@'), fillArr('left'), fillArr(false));
  // 2-3 tiêu đề ngày + thứ
  var h1 = ['NỘI DUNG / NGÀY'], h2 = [''], b1 = ['#334155'], b2 = ['#334155'];
  sp.days.forEach(function (d) { var c = d.wd === 'CN' ? '#b91c1c' : (d.wd === 'T7' ? '#9a3412' : '#334155'); h1.push(d.d); h2.push(d.wd); b1.push(c); b2.push(c); });
  h1.push('TỔNG THÁNG'); h2.push(''); b1.push('#0a2a1c'); b2.push('#0a2a1c');
  pushRow(h1, b1, fillArr('#ffffff'), fillArr('bold'), fillArr('0'), fillArr('center'), fillArr(false));
  pushRow(h2, b2, fillArr('#ffffff'), fillArr('normal'), fillArr('@'), fillArr('center'), fillArr(false));
  var sectionRows = [], textRows = [], cur = KC_GS_THEME_.slate;
  sp.rows.forEach(function (rw, i) {
    var rowIdx = HEAD + i;                       // chỉ số 0-based của dòng trong lưới
    if (rw.k === 'section') {
      cur = KC_GS_THEME_[rw.theme] || KC_GS_THEME_.slate;
      var v = fillArr(''); v[0] = rw.label;
      pushRow(v, fillArr(cur[0]), fillArr('#ffffff'), fillArr('bold'), fillArr('@'), fillArr('left'), fillArr(false));
      sectionRows.push(rowIdx); return;
    }
    var isTot = rw.k === 'total', isSub = rw.k === 'sub', isText = rw.kind === 'text';
    var base = isTot ? cur[1] : (rw.tint === 'amber' ? '#fef3c7' : (isSub ? '#f8fafc' : '#ffffff'));
    var v2 = [(rw.indent ? '    ' : '') + rw.label], b = [base], f = [isTot ? cur[0] : '#1e293b'], w = [(isTot || isSub) ? 'bold' : 'normal'], n = ['@'], h = ['left'], wr = [true];
    for (var c = 0; c < nD; c++) {
      var x = rw.vals[c], isNum = typeof x === 'number' || (typeof x === 'string' && x.charAt(0) === '=');
      v2.push(x === undefined ? '' : x);
      b.push((!isNum && !isText && !isTot && !isSub && (x === '' ) && !sp.days[c].has) ? '#f1f5f9' : base);
      f.push('#1e293b'); w.push(isTot ? 'bold' : 'normal'); n.push(isNum ? (rw.kind === 'int' ? '0' : MONEY) : '@'); h.push(isText ? 'left' : 'right'); wr.push(isText);
    }
    v2.push(rw.tot === undefined ? '' : rw.tot); b.push(isTot ? cur[0] : cur[1]); f.push(isTot ? '#ffffff' : cur[0]); w.push('bold');
    n.push((typeof rw.tot === 'number' || (typeof rw.tot === 'string' && rw.tot.charAt(0) === '=')) ? MONEY : '@'); h.push('right'); wr.push(false);
    pushRow(v2, b, f, w, n, h, wr);
    if (isText) textRows.push(rowIdx);
  });
  var rng = sh.getRange(1, 1, vals.length, nC);
  rng.setNumberFormats(nf);
  kcPutGrid_(sh, 1, 1, vals);
  rng.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw).setHorizontalAlignments(ha).setWrapStrategies(wrap.map(function (r) {
    return r.map(function (x) { return x ? SpreadsheetApp.WrapStrategy.WRAP : SpreadsheetApp.WrapStrategy.OVERFLOW; });
  }));
  rng.setFontFamily(FONT).setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(1, 1, 1, nC).setFontSize(16);
  sh.getRange(2, 1, 1, nC).setFontSize(10);
  sectionRows.forEach(function (r) { sh.getRange(r + 1, 1, 1, nC).setFontSize(11); sh.getRange(r + 1, 1, 1, nC).merge(); });
  sh.getRange(1, 1, 1, nC).merge(); sh.getRange(2, 1, 1, nC).merge();
  sh.getRange(3, 1, 2, 1).merge(); sh.getRange(3, nC, 2, 1).merge();
  var body = sh.getRange(3, 1, vals.length - 2, nC);
  body.setBorder(true, true, true, true, true, true, '#d5dde5', SpreadsheetApp.BorderStyle.SOLID);
  // độ rộng cột / chiều cao dòng
  sh.setColumnWidth(1, 430); sh.setColumnWidths(2, nD, 88); sh.setColumnWidth(nC, 115);
  sh.setRowHeight(1, 40); sh.setRowHeight(2, 24); sh.setRowHeights(3, 2, 22);
  sp.rows.forEach(function (rw, i) {
    var r = HEAD + i + 1;
    if (rw.k === 'section') sh.setRowHeight(r, 28);
    else if (rw.kind === 'text') sh.setRowHeight(r, 70);
    else sh.setRowHeight(r, (rw.k === 'total') ? 26 : 22);
  });
  sh.setFrozenRows(HEAD); sh.setFrozenColumns(1); sh.setHiddenGridlines(true);
}

// ============================================================================
// V59 — GHI KẾT CA VÀO GOOGLE SHEET THEO ĐÚNG FILE MẪU "Kết Ca Tháng 10"
// Mọi sheet cửa hàng đều đi qua CÙNG 1 bảng style + 1 bộ công thức → không còn sheet đúng / sheet sai.
// Cấu trúc cố định: dòng 1 = thứ, dòng 2 = ngày, dòng 3-22 Ca Sáng, 23-42 Ca Tối, 43-55 tổng hợp/đối chiếu/két.
// ============================================================================
// Mỗi dòng: [A.fill, A.font, B.fill, B.font, B.bold, AG.fill, AG.font]  (lấy trực tiếp từ file mẫu)
var KC_TPL_STYLE_ = [
  ["#FFE599","#FF0000","#FFE599","#000000",1,"#FFE599","#000000"],["#EFEFEF","#000000","#EFEFEF","#000000",1,"#EFEFEF","#FF0000"],
  [null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#FF0000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#FF0000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#FF0000",null,"#000000",0,"#FFF2CC","#FF0000"],["#FFE599","#FF0000","#FFE599","#000000",1,"#FFE599","#FF0000"],
  [null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  ["#FFF2CC","#000000","#FFF2CC","#000000",1,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],[null,"#000000",null,"#000000",0,"#FFF2CC","#FF0000"],
  [null,"#0000FF",null,"#0000FF",0,"#FFF2CC","#0000FF"],["#FFF2CC","#000000","#FFF2CC","#000000",1,"#FFF2CC","#FF0000"],
  ["#FFE599","#FF0000","#FFE599","#000000",1,"#FFE599","#FF0000"],["#FFE599","#FF0000","#FFE599","#000000",1,"#FFE599","#FF0000"],
  [null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#FF0000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#FF0000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#FF0000",null,"#000000",0,"#C9DAF8","#FF0000"],["#A4C2F4","#FF0000","#A4C2F4","#000000",1,"#A4C2F4","#FF0000"],
  [null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  ["#C9DAF8","#000000","#C9DAF8","#000000",1,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],[null,"#000000",null,"#000000",0,"#C9DAF8","#FF0000"],
  [null,"#0000FF",null,"#0000FF",0,"#C9DAF8","#0000FF"],["#C9DAF8","#000000","#C9DAF8","#000000",1,"#C9DAF8","#FF0000"],
  ["#A4C2F4","#FF0000","#A4C2F4","#000000",1,"#A4C2F4","#0000FF"],["#A4C2F4","#FF0000","#A4C2F4","#000000",1,"#A4C2F4","#FF0000"],
  ["#EFEFEF","#000000","#EFEFEF","#000000",1,"#EFEFEF","#000000"],["#F3F3F3","#000000","#F3F3F3","#000000",1,"#F3F3F3","#000000"],
  ["#EAD1DC","#FF0000","#EAD1DC","#FF0000",1,"#EAD1DC","#FF0000"],["#EAD1DC","#FF0000","#EAD1DC","#FF0000",1,"#EAD1DC","#FF0000"],
  ["#EAD1DC","#FF0000","#EAD1DC","#FF0000",1,"#EAD1DC","#FF0000"],["#EAD1DC","#FF0000","#EAD1DC","#FF0000",1,"#EAD1DC","#FF0000"],
  ["#D5A6BD","#000000","#D5A6BD","#000000",1,"#D5A6BD","#000000"],["#D5A6BD","#000000","#D5A6BD","#000000",1,"#D5A6BD","#000000"],
  ["#D5A6BD","#000000","#D5A6BD","#000000",1,"#D5A6BD","#000000"],["#C27BA0","#000000","#C27BA0","#000000",1,"#C27BA0","#000000"],
  ["#C27BA0","#000000","#C27BA0","#000000",1,"#C27BA0","#000000"],["#A64D79","#FFFFFF","#A64D79","#FFFFFF",1,"#A64D79","#FFFFFF"],
  ["#A64D79","#FFFFFF","#A64D79","#FFFFFF",1,"#A64D79","#FFFFFF"]
];

// Nhãn cột A (dòng 3..55) — đúng như file mẫu
var KC_TPL_LABELS_ = {
  3: 'Tiền mặt', 4: 'Chuyển khoản Kiot', 5: 'Chuyển khoản Noti CTY - SHIP', 6: 'Shopee (Ví)',
  7: 'Dư ck Noti (Khách đặt bánh trước, ck dư)', 8: 'Thiếu ck Noti (Khách đặt bánh trước)', 9: 'Tiền mặt nộp về Noti CTY',
  10: '📍TỔNG DOANH THU CA SÁNG', 11: 'Chi hộ ship SỈ công ty', 12: 'Chi hộ ship LẺ công ty',
  13: 'Chi hộ ĐIỆN, NƯỚC, RÁC, WIFI... tháng trước', 14: 'Chi hộ TIKTOK', 15: '📍TỔNG CHI HỘ CÔNG TY',
  16: 'Chi SHIP LẺ cửa hàng', 17: 'Chi SHIP SỈ cửa hàng', 18: 'Chi khác (Đá, Hỗ trợ ship free khách lẻ,...)', 19: 'Lý do chi cụ thể',
  20: '📍TỔNG CHI PHÍ CỬA HÀNG', 21: '📍TỔNG CHI CA SÁNG', 22: '📍TỔNG TM CA SÁNG CÒN LẠI',
  23: 'Tiền mặt', 24: 'Chuyển khoản Kiot', 25: 'Chuyển khoản Noti CTY - SHIP', 26: 'Shopee (Ví)',
  27: 'Dư ck Noti (Khách đặt bánh trước, ck dư)', 28: 'Thiếu ck Noti (Khách đặt bánh trước)', 29: 'Tiền mặt nộp về Noti CTY',
  30: '📍TỔNG DOANH THU CA TỐI', 31: 'Chi hộ ship SỈ công ty', 32: 'Chi hộ ship LẺ công ty',
  33: 'Chi hộ ĐIỆN, NƯỚC, RÁC, WIFI... tháng trước', 34: 'Chi hộ TIKTOK', 35: '📍TỔNG CHI HỘ CÔNG TY',
  36: 'Chi SHIP LẺ cửa hàng', 37: 'Chi SHIP SỈ cửa hàng', 38: 'Chi khác (Đá, Hỗ trợ ship free khách lẻ,...)', 39: 'Lý do chi cụ thể',
  40: '📍TỔNG CHI PHÍ CỬA HÀNG', 41: '📍TỔNG CHI CA TỐI', 42: '📍TỔNG TM CA TỐI CÒN LẠI',
  43: '📍TIỀN MẶT NỘP VỀ NOTI công ty', 44: '📍TỔNG TIỀN MẶT 2 CA (Sau chi)', 45: 'Tổng D.THU 2 ca trên KIOT',
  46: 'Tổng T.MẶT 2 ca trên KIOT (TM + Acb Bánh)', 47: 'Tổng C.KHOẢN 2 ca trên KIOT', 48: 'Tổng VÍ 2 ca trên KIOT',
  49: 'Tổng Noti nhận (DƯ do ck trước, ck dư)', 50: 'Tổng Noti nhận (THIẾU do ck trước)', 51: 'Tổng Noti nhận (DƯ + THIẾU)',
  52: 'Tổng CHI HỘ công ty/ ngày', 53: 'Tổng CHI PHÍ cửa hàng/ ngày', 54: '📍TỔNG CHI 2 CA', 55: '📍TIỀN KÉT CỬA HÀNG'
};

// Công thức từng ngày ({c} = chữ cột). Dòng không có ở đây = ô nhập tay/dữ liệu.
var KC_TPL_FORMULAS_ = {
  10: '=({c}3+{c}4+{c}6+{c}8)',
  15: '=SUM({c}11:{c}14)',
  20: '=SUM({c}16:{c}19)',
  21: '={c}15+{c}20',
  22: '={c}3-{c}21',
  30: '=({c}23+{c}24+{c}26+{c}28)',
  35: '=SUM({c}31:{c}34)',
  40: '=SUM({c}36:{c}39)',
  41: '={c}35+{c}40',
  42: '={c}23-{c}41',
  43: '={c}9+{c}29',
  44: '={c}22+{c}42',
  45: '={c}30+{c}10',
  46: '={c}23+{c}3',
  47: '={c}24+{c}4',
  48: '={c}26+{c}6',
  49: '={c}4+{c}5+{c}7+{c}9+{c}24+{c}25+{c}27+{c}29',
  50: '={c}47-{c}8-{c}28',
  51: '={c}49-{c}8-{c}28',
  52: '={c}15+{c}35',
  53: '={c}20+{c}40',
  54: '={c}52+{c}53'
};



/** Dò dấu ngăn cách đối số công thức mà file Sheet này CHẤP NHẬN (',' hay ';') bằng 1 ô thử, rồi nhớ kết quả. */
var KC_SEP_ = null;
function kcFormulaSep_(sh) {
  if (KC_SEP_) return KC_SEP_;
  var sep = ',', cell = null;
  try {
    cell = sh.getRange(1, sh.getMaxColumns());
    cell.setFormula('=IF(TRUE,1,2)'); SpreadsheetApp.flush();
    if (cell.getValue() !== 1) {
      cell.setFormula('=IF(TRUE;1;2)'); SpreadsheetApp.flush();
      if (cell.getValue() === 1) sep = ';';
    }
  } catch (e) {}
  try { if (cell) cell.clearContent(); } catch (e2) {}
  KC_SEP_ = sep;
  return sep;
}
/** Đổi dấu phẩy ngăn cách đối số thành ';' (chỉ ngoài chuỗi "...") nếu file Sheet yêu cầu. */
function kcLocalizeFormula_(f, sep) {
  if (sep === ',') return f;
  var out = '', inQ = false, i, ch;
  for (i = 0; i < f.length; i++) {
    ch = f.charAt(i);
    if (ch === '"') inQ = !inQ;
    out += (ch === ',' && !inQ) ? ';' : ch;
  }
  return out;
}

/** GHI LƯỚI GIÁ TRỊ + CÔNG THỨC AN TOÀN THEO NGÔN NGỮ SHEET.
 * Lý do: setValues() với chuỗi bắt đầu bằng "=" bị Google Sheet phân tích theo LOCALE của file (Việt Nam dùng
 * dấu phẩy làm số thập phân, dấu ; làm ngăn cách đối số) => các công thức có dấu phẩy như =DATE(2026,10,1),
 * =IF(WEEKDAY(B2)=1,"Chủ Nhật",...) bị #ERROR!. setFormulas() luôn dùng cú pháp chuẩn (dấu phẩy, tên hàm tiếng Anh)
 * nên chạy đúng ở mọi locale và xuất Excel không lỗi.
 * Cách làm: setValues 1 lần cho phần giá trị (ô công thức để trống), rồi setFormulas theo từng khối chữ nhật. */
function kcPutGrid_(sh, row0, col0, grid) {
  var nR = grid.length;
  if (!nR) return;
  var nC = grid[0].length, plain = [], blocks = [], open = {}, r, c, sep = kcFormulaSep_(sh);
  for (r = 0; r < nR; r++) {
    var pr = [], runs = [], c0 = -1, cur = [], newOpen = {};
    for (c = 0; c < nC; c++) {
      var v = grid[r][c];
      if (typeof v === 'string' && v.length > 1 && v.charAt(0) === '=') {
        pr.push('');
        if (c0 < 0) c0 = c;
        cur.push(kcLocalizeFormula_(v, sep));
      } else {
        pr.push(v);
        if (c0 >= 0) { runs.push({ c0: c0, f: cur }); c0 = -1; cur = []; }
      }
    }
    if (c0 >= 0) runs.push({ c0: c0, f: cur });
    runs.forEach(function (run) {
      var key = run.c0 + ':' + run.f.length, b = open[key];
      if (b) { b.rows.push(run.f); } else { b = { r: r, c0: run.c0, rows: [run.f] }; blocks.push(b); }
      newOpen[key] = b;
    });
    open = newOpen;
    plain.push(pr);
  }
  sh.getRange(row0, col0, nR, nC).setValues(plain);
  blocks.forEach(function (b) {
    sh.getRange(row0 + b.r, col0 + b.c0, b.rows.length, b.rows[0].length).setFormulas(b.rows);
  });
}

function kcColLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Đưa sheet về trạng thái SẠCH HOÀN TOÀN trước khi ghi: gỡ merge, xoá nội dung + định dạng + validation +
 * conditional format + banding, hiện lại dòng/cột ẩn, bỏ freeze. Trả về phần nhập tay cần giữ lại (nếu sheet đã theo mẫu). */
function kcPrepareTemplateSheet_(ss, name) {
  var sh = ss.getSheetByName(name), keep = null;
  if (!sh) sh = ss.insertSheet(name);
  else {
    try {
      if (String(sh.getRange('AJ2').getValue()) === 'SẢN PHẨM') {
        keep = { prod: sh.getRange('AJ3:AM6').getValues(), utils: sh.getRange('AK23:AK26').getValues() };
      }
    } catch (e) { keep = null; }
  }
  var needCols = 50, needRows = 70;
  if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  var all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  try { all.breakApart(); } catch (e) {}
  all.clear();
  try { all.clearDataValidations(); } catch (e) {}
  try { sh.setConditionalFormatRules([]); } catch (e) {}
  try { sh.getBandings().forEach(function (b) { b.remove(); }); } catch (e) {}
  try { sh.showRows(1, sh.getMaxRows()); sh.showColumns(1, sh.getMaxColumns()); } catch (e) {}
  sh.setFrozenRows(0); sh.setFrozenColumns(0);
  return { sh: sh, keep: keep };
}

// ============================================================================
// V60 — GIAO DIỆN FILE XUẤT KẾT CA THEO FILE MẪU "MAU_KetCa_NhieuCuaHang_xem_thu.xlsx"
// Chỉ đổi: màu, bố cục, kích thước, kiểu chữ, viền. GIỮ NGUYÊN: nhãn, công thức, số liệu, vị trí dòng/cột.
// Bảng màu: dải tiêu đề #0A2A1C · thứ trong tuần #334155 / T7 #9A3412 / CN #B91C1C · Ca Sáng #15803D · Ca Tối #B45309
//           Kiot #146C43 · Noti #1D4ED8 · Chi #C2410C · Tiền mặt/Két #0F766E · Ghi chú #475569 · Viền #D5DDE5 · Chữ Calibri
// ============================================================================
var KC_TPL_THEME_ = {
  sang:   { d: '#15803D', t: '#ECFDF5' }, toi:    { d: '#B45309', t: '#FFFBEB' }, green:  { d: '#146C43', t: '#DCFCE7' },
  blue:   { d: '#1D4ED8', t: '#DBEAFE' }, orange: { d: '#C2410C', t: '#FFEDD5' }, teal:   { d: '#0F766E', t: '#CCFBF1' },
  slate:  { d: '#475569', t: '#F1F5F9' }
};
var KC_TPL_SUB_ = { 10: 1, 15: 1, 20: 1, 21: 1, 30: 1, 35: 1, 40: 1, 41: 1 };   // dòng tổng phụ (nền xám nhạt, chữ đậm)
var KC_TPL_TOT_ = { 22: 1, 42: 1, 44: 1, 45: 1, 51: 1, 54: 1 };                 // dòng tổng chính (nền theo khối, chữ đậm)
function kcTplThemeOfRow_(r) {
  if (r <= 22) return KC_TPL_THEME_.sang;
  if (r <= 42) return KC_TPL_THEME_.toi;
  if (r <= 44) return KC_TPL_THEME_.teal;
  if (r <= 48) return KC_TPL_THEME_.green;
  if (r <= 51) return KC_TPL_THEME_.blue;
  if (r <= 54) return KC_TPL_THEME_.orange;
  return KC_TPL_THEME_.teal;
}

function writeKetCaTemplateSheet_(ss, sp) {
  var name = String(sp.name || 'CuaHang').substring(0, 95);
  var prep = kcPrepareTemplateSheet_(ss, name), sh = prep.sh, keep = prep.keep;
  var ym = String(sp.monthKey).split('-'), Y = parseInt(ym[0], 10), Mo = parseInt(ym[1], 10);
  var nD = parseInt(sp.nDays, 10) || new Date(Y, Mo, 0).getDate();
  var LASTROW = 55, NC = 33;                    // A..AG
  var IN = sp.inputs || {}, EX = sp.extra || {};
  var FONT = 'Calibri', BORDER_CLR = '#D5DDE5', INK = '#1E293B', MONEY = '#,##0;-#,##0;"";""';
  var HEAD_DARK = '#0A2A1C', HEAD_SLATE = '#334155';
  var vals = [], bg = [], fc = [], fw = [], nf = [], ha = [], fs = [];
  var r, c;
  function arr(v) { var a = []; for (var i = 0; i < NC; i++) a.push(v); return a; }
  function wdColor(day) { var w = new Date(Y, Mo - 1, day).getDay(); return w === 0 ? '#B91C1C' : (w === 6 ? '#9A3412' : HEAD_SLATE); }

  for (r = 1; r <= LASTROW; r++) {
    var v = arr(''), b = arr('#FFFFFF'), f = arr(INK), w = arr('normal'), n = arr(MONEY), h = arr('right'), z = arr(11);
    if (r === 1) {
      // dải tiêu đề + thứ trong tuần (giữ nguyên công thức thứ ở B1..)
      b = arr(HEAD_SLATE); f = arr('#FFFFFF'); w = arr('bold'); n = arr('General'); h = arr('center'); z = arr(10);
      v[0] = sp.store || name; b[0] = HEAD_DARK; z[0] = 18; h[0] = 'left'; n[0] = '@';
      for (c = 1; c <= nD; c++) { var cl1 = kcColLetter_(c + 1); v[c] = '=IF(WEEKDAY(' + cl1 + '2)=1,"Chủ Nhật","Thứ "&WEEKDAY(' + cl1 + '2))'; b[c] = wdColor(c); }
      b[NC - 1] = HEAD_DARK;
    } else if (r === 2) {
      b = arr(HEAD_SLATE); f = arr('#FFFFFF'); w = arr('bold'); n = arr('General'); h = arr('center'); z = arr(11);
      v[0] = 'Nội dung/Ngày'; h[0] = 'left'; v[NC - 1] = 'TỔNG'; b[NC - 1] = HEAD_DARK;
      for (c = 1; c <= nD; c++) { v[c] = '=DATE(' + Y + ',' + Mo + ',' + c + ')'; n[c] = 'dd/MM/yyyy'; b[c] = wdColor(c); }
    } else {
      var th = kcTplThemeOfRow_(r), isTot = !!KC_TPL_TOT_[r], isSub = !!KC_TPL_SUB_[r], isText = (r === 19 || r === 39);
      var rowBg = isTot ? th.t : (isSub ? '#F8FAFC' : '#FFFFFF');
      b = arr(rowBg); f = arr(INK); w = arr(isTot ? 'bold' : 'normal');
      // cột A (nhãn)
      v[0] = KC_TPL_LABELS_[r] || ''; f[0] = isTot ? th.d : INK; w[0] = (isTot || isSub) ? 'bold' : 'normal'; n[0] = '@'; h[0] = 'left';
      var fm = KC_TPL_FORMULAS_[r];
      for (c = 1; c <= nD; c++) {
        if (fm) v[c] = fm.replace(/\{c\}/g, kcColLetter_(c + 1));
        else { var x = IN[r] ? IN[r][c - 1] : ''; v[c] = (x === undefined || x === null || x === 0) ? '' : x; }
        if (isText) { h[c] = 'left'; n[c] = '@'; z[c] = 9.5; }
      }
      // cột AG (TỔNG THÁNG) — giữ nguyên công thức
      if (r === 55) v[NC - 1] = '=IFERROR(LOOKUP(2,1/(B55:AF55<>""),B55:AF55),"")';
      else if (!isText) v[NC - 1] = '=SUM(B' + r + ':AF' + r + ')';
      b[NC - 1] = isTot ? th.d : th.t; f[NC - 1] = isTot ? '#FFFFFF' : th.d; w[NC - 1] = 'bold'; h[NC - 1] = 'right';
      if (isText) { n[NC - 1] = '@'; }
    }
    vals.push(v); bg.push(b); fc.push(f); fw.push(w); nf.push(n); ha.push(h); fs.push(z);
  }
  var rng = sh.getRange(1, 1, LASTROW, NC);
  rng.setNumberFormats(nf);
  kcPutGrid_(sh, 1, 1, vals);                 // công thức ghi bằng setFormulas → không lỗi #ERROR! theo locale

  // ---- KIỂM TRA SAU KHI GHI: nếu dòng Thứ/Ngày hoặc ô TỔNG Tiền két vẫn lỗi → ghi giá trị tĩnh để KHÔNG BAO GIỜ hiện #ERROR! ----
  try {
    SpreadsheetApp.flush();
    var chk = sh.getRange(1, 2, 2, nD).getDisplayValues(), bad = false;
    chk.forEach(function (rw) { rw.forEach(function (x) { if (String(x).charAt(0) === '#') bad = true; }); });
    if (bad) {
      var wdN = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'], r1 = [], r2 = [];
      for (c = 1; c <= nD; c++) { var dt = new Date(Y, Mo - 1, c); r1.push(wdN[dt.getDay()]); r2.push(dt); }
      sh.getRange(1, 2, 1, nD).setNumberFormat('@').setValues([r1]);
      sh.getRange(2, 2, 1, nD).setNumberFormat('dd/MM/yyyy').setValues([r2]);
    }
    var agv = String(sh.getRange(55, NC).getDisplayValue());
    if (agv.charAt(0) === '#') {
      var lastKet = '', kv = IN[55] || [];
      for (c = 0; c < kv.length; c++) if (kv[c] !== '' && kv[c] != null) lastKet = kv[c];
      sh.getRange(55, NC).setValue(lastKet);
    }
  } catch (eChk) {}
  rng.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw).setHorizontalAlignments(ha).setFontSizes(fs);
  rng.setFontFamily(FONT).setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(1, 1).setHorizontalAlignment('left').setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  sh.getRange(1, 2, 2, NC - 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  [19, 39].forEach(function (rr) { sh.getRange(rr, 2, 1, NC - 2).setVerticalAlignment('top'); });
  rng.setBorder(true, true, true, true, true, true, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);

  // chiều cao dòng: tiêu đề 40/26 · dòng thường 22 · dòng tổng 26 · "Lý do chi" 48
  sh.setRowHeights(1, LASTROW, 22);
  sh.setRowHeight(1, 40); sh.setRowHeight(2, 26);
  for (r = 3; r <= LASTROW; r++) if (KC_TPL_TOT_[r] || KC_TPL_SUB_[r]) sh.setRowHeight(r, 26);
  sh.setRowHeight(19, 48); sh.setRowHeight(39, 48);

  // ---- vùng phải: khớp Kiot / Noti / Cửa hàng chi ----
  function box(a1, text, fill, color) {
    var g = sh.getRange(a1); g.merge();
    g.setValue(text).setBackground(fill).setFontColor(color).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP).setFontFamily(FONT).setFontSize(11)
      .setBorder(true, true, true, true, null, null, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);
  }
  box('AH45:AH48', 'KHỚP KIOT 100%', KC_TPL_THEME_.green.d, '#FFFFFF');
  box('AH49:AH51', 'KHỚP NOTI 100%', KC_TPL_THEME_.blue.d, '#FFFFFF');
  box('AH52:AH53', 'CỬA HÀNG CHI', KC_TPL_THEME_.orange.d, '#FFFFFF');

  // ---- vùng phải: kiểm kê quà tặng ----
  var prevMonth = Mo === 1 ? 12 : Mo - 1;
  var t1 = sh.getRange('AJ1:AN1'); t1.merge();
  t1.setValue('KIỂM KÊ TỒN KHO QUÀ TẶNG CUỐI THÁNG ' + prevMonth).setBackground(KC_TPL_THEME_.slate.d).setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange('AJ2:AN2').setValues([['SẢN PHẨM', 'TỒN ĐẦU', 'NHẬP', 'TỒN CUỐI', 'TỔNG XUẤT']]).setBackground(HEAD_SLATE).setFontColor('#FFFFFF').setFontWeight('bold');
  var prod = [['Xoài sấy trái cây', '', '', ''], ['Túi giữ nhiệt LỚN', '', '', ''], ['Túi giữ nhiệt NHỎ', '', '', ''], ['', '', '', '']];
  if (keep && keep.prod) prod = keep.prod;                       // giữ số nhập tay của kỳ trước
  sh.getRange('AJ3:AM6').setValues(prod);
  var xuat = [];
  for (r = 3; r <= 6; r++) xuat.push(['=AK' + r + '+AL' + r + '-AM' + r]);
  sh.getRange('AN3:AN6').setFormulas(xuat).setFontColor(KC_TPL_THEME_.green.d).setFontWeight('bold').setNumberFormat('#,##0');
  var g1 = sh.getRange('AJ1:AN6');
  g1.setFontFamily(FONT).setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('AJ3:AM6').setBackground('#FFFFFF').setFontColor(INK);
  sh.getRange('AN3:AN6').setBackground(KC_TPL_THEME_.green.t);

  var d1 = sh.getRange('AJ13:AJ18'); d1.merge();
  d1.setValue('DOANH THU KHÔNG TÍNH VÍ ĐIỆN TỬ').setBackground(KC_TPL_THEME_.green.d).setFontColor('#FFFFFF').setFontWeight('bold');
  var d2 = sh.getRange('AK13:AK18'); d2.merge();
  d2.setFormula('=AG45-AG48').setBackground(KC_TPL_THEME_.green.t).setFontColor(KC_TPL_THEME_.green.d).setFontWeight('bold').setNumberFormat('#,##0"đ"');
  var d3 = sh.getRange('AJ13:AK18');
  d3.setFontFamily(FONT).setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setBorder(true, true, true, true, null, null, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);

  var ch = sh.getRange('AJ22:AK22'); ch.merge();
  ch.setValue('CHI HỘ CỬA HÀNG THÁNG TRƯỚC').setBackground(KC_TPL_THEME_.orange.d).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange('AJ23:AJ26').setValues([['Điện'], ['Nước'], ['Rác'], ['Wifi']]);
  sh.getRange('AK23:AK26').setValues(keep && keep.utils ? keep.utils : [[''], [''], [''], ['']]).setFontWeight('bold').setNumberFormat('#,##0');
  sh.getRange('AJ27').setValue('TỔNG CHI HỘ').setBackground(KC_TPL_THEME_.orange.t).setFontColor(KC_TPL_THEME_.orange.d).setFontWeight('bold');
  sh.getRange('AK27').setFormula('=SUM(AK23:AK26)').setBackground(KC_TPL_THEME_.orange.t).setFontColor(KC_TPL_THEME_.orange.d).setFontWeight('bold').setNumberFormat('#,##0');
  sh.getRange('AJ22:AK27').setFontFamily(FONT).setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('AJ23:AK26').setBackground('#FFFFFF').setFontColor(INK);

  // ---- khối bổ sung NGOÀI MẪU (hệ thống tính, để đối chiếu — không ảnh hưởng công thức của mẫu) ----
  var X0 = 57;
  var exRows = [
    ['BỔ SUNG NGOÀI MẪU (hệ thống tính — để đối chiếu)'],
    ['Doanh thu ngoài Kiot (thu khác TM + CK TK công ty + ship lẻ + Dư ck)'],
    ['Tiền mặt thực tế còn lại tại CH (hệ thống, gồm TM thu khác)'],
    ['Ghi chú thu/chi chi tiết — Ca Sáng'],
    ['Ghi chú thu/chi chi tiết — Ca Tối']
  ];
  var xv = [], xi;
  for (xi = 0; xi < exRows.length; xi++) { var rowv = []; for (c = 0; c < NC; c++) rowv.push(''); rowv[0] = exRows[xi][0]; xv.push(rowv); }
  var exKeys = [null, 'ngoai', 'tmHT', 'ghiS', 'ghiT'];
  for (xi = 1; xi < 5; xi++) {
    for (c = 1; c <= nD; c++) { var ev = EX[exKeys[xi]] ? EX[exKeys[xi]][c - 1] : ''; xv[xi][c] = (ev === undefined || ev === null || ev === 0) ? '' : ev; }
    if (xi <= 2) xv[xi][NC - 1] = '=SUM(B' + (X0 + xi) + ':AF' + (X0 + xi) + ')';
  }
  var xr = sh.getRange(X0, 1, 5, NC);
  xr.setNumberFormat(MONEY);
  kcPutGrid_(sh, X0, 1, xv);
  xr.setFontFamily(FONT).setFontSize(11).setFontColor(INK).setVerticalAlignment('middle')
    .setBackground('#FFFFFF').setBorder(true, true, true, true, true, true, BORDER_CLR, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(X0, 1, 1, NC).setBackground(KC_TPL_THEME_.slate.d).setFontWeight('bold').setFontColor('#FFFFFF').setFontSize(12);
  sh.getRange(X0 + 1, 1, 4, 1).setFontWeight('normal').setNumberFormat('@').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(X0 + 1, 2, 2, NC - 1).setHorizontalAlignment('right').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(X0 + 1, NC, 2, 1).setBackground(KC_TPL_THEME_.slate.t).setFontColor(KC_TPL_THEME_.slate.d).setFontWeight('bold');
  sh.getRange(X0 + 3, 2, 2, NC - 1).setNumberFormat('@').setHorizontalAlignment('left').setVerticalAlignment('top').setFontSize(9.5).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.setRowHeight(X0, 28); sh.setRowHeights(X0 + 1, 2, 24);
  sh.setRowHeights(X0 + 3, 2, 80);

  // ---- độ rộng cột + freeze + ẩn lưới (giống file mẫu: A ≈ 62.8 ký tự, ngày ≈ 13.8, TỔNG ≈ 16.8) ----
  sh.setColumnWidth(1, 445); sh.setColumnWidths(2, 31, 102); sh.setColumnWidth(33, 123);
  sh.setColumnWidth(34, 120); sh.setColumnWidth(35, 24);
  sh.setColumnWidth(36, 190); sh.setColumnWidth(37, 140); sh.setColumnWidth(38, 120); sh.setColumnWidth(39, 120); sh.setColumnWidth(40, 120);
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
  try { sh.setHiddenGridlines(true); } catch (e) {}
}

// ============================================================================
// LỢI NHUẬN NGÀY — Giai đoạn 7
// Sheet: Data_ChiPhiCoDinhThang, Data_CongNhatNgay, Data_DoanhThuNgoaiKiot
// ============================================================================

// ----------------------------------------------------------------------------
// 1) CHI PHÍ CỐ ĐỊNH THEO THÁNG — QLCH nhập 1 lần/tháng, hệ thống tự chia đều
//    cho từng ngày trong tháng khi tính bảng Lợi Nhuận Ngày (chia ở client).
// ----------------------------------------------------------------------------
function saveChiPhiCoDinhThang(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền nhập chi phí cố định cho cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.CHI_PHI_CO_DINH_THANG, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_CHI_PHI_CO_DINH_THANG', rowObj.Key_Id, 'ChiPhiCoDinh=' + rowObj.ChiPhiCoDinh);
    return result;
  });
}
function deleteChiPhiCoDinhThang(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.CHI_PHI_CO_DINH_THANG, 'Key_Id', keyId);
    if (result.success) logAudit_(account.username, 'XOA_CHI_PHI_CO_DINH_THANG', keyId, '');
    return result;
  });
}

// ----------------------------------------------------------------------------
// 2) LƯƠNG/GIỜ CỐ ĐỊNH CỦA TỪNG NHÂN VIÊN — lưu ngay trên dòng Data_NhanVien
//    (cột LuongGio) để QLCH chỉ cần nhập 1 lần, các lần chấm công sau tự lấy.
// ----------------------------------------------------------------------------
function saveLuongGioNhanVien(token, nhanVienId, luongGio) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return fail_('Hệ thống đang bận ghi dữ liệu khác, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.NHAN_VIEN);
      if (!sh) return fail_('Không tìm thấy sheet Data_NhanVien trong file này.');
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.NHAN_VIEN]);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return fail_('Sheet Data_NhanVien chưa có dòng nhân viên nào.');
      if (!map['LuongGio']) return fail_('Sheet Data_NhanVien thiếu cột LuongGio — vào tab Quản Trị Hệ Thống, chạy "Chẩn đoán hệ thống" rồi thử lại.');
      if (!map['Id']) return fail_('Sheet Data_NhanVien thiếu cột Id — kiểm tra lại header dòng 1.');

      var targetId = String(nhanVienId || '').trim();
      var ids = sh.getRange(2, map['Id'], lastRow - 1, 1).getValues();
      var rowIdx = -1;
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === targetId) { rowIdx = i + 2; break; }
      }
      if (rowIdx === -1) return fail_('Không tìm thấy nhân viên có Id "' + targetId + '" trong Data_NhanVien — có thể danh sách vừa được nạp lại, hãy tải lại trang rồi thử.');

      if (account.role !== 'Admin') {
        var store = sh.getRange(rowIdx, map['Store']).getValue();
        var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
        if (allowed.indexOf(store) === -1) return fail_('Bạn không có quyền sửa lương nhân viên cửa hàng này.');
      }

      var value = parseFloat(luongGio) || 0;
      sh.getRange(rowIdx, map['LuongGio']).setValue(value);
      SpreadsheetApp.flush(); // ép ghi xuống Sheet ngay, không chờ hàng đợi

      // Đọc lại đúng ô vừa ghi để xác nhận đã lưu thật, tránh báo thành công giả.
      var confirmVal = sh.getRange(rowIdx, map['LuongGio']).getValue();

      logAudit_(account.username, 'LUU_LUONG_GIO_NV', targetId, 'LuongGio=' + value);
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ message: 'Đã lưu lương/giờ.', savedValue: confirmVal, row: rowIdx });
    } finally {
      lock.releaseLock();
    }
  });
}
/** Lưu lương/giờ cho NHIỀU nhân viên cùng lúc (dùng khi bấm "Lưu chấm công ngày" — đảm bảo lương
 * luôn được lưu vĩnh viễn dù người dùng không click ra khỏi ô lương/giờ trước khi bấm nút). */
function saveLuongGioBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.NHAN_VIEN);
      if (!sh) return fail_('Không tìm thấy danh sách nhân viên.');
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.NHAN_VIEN]); // tự thêm cột LuongGio nếu sheet cũ còn thiếu
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2 || !map['Id'] || !map['LuongGio']) return fail_('Sheet Data_NhanVien thiếu cột LuongGio — hãy chạy initSystemSheets() rồi thử lại.');
      var ids = sh.getRange(2, map['Id'], lastRow - 1, 1).getValues();
      var idToRow = {};
      ids.forEach(function (r, i) { idToRow[String(r[0])] = i + 2; });
      var allowedStores = account.role === 'Admin' ? null : String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      var saved = 0;
      rows.forEach(function (r) {
        var rowIdx = idToRow[String(r.NhanVienId)];
        if (!rowIdx) return;
        if (allowedStores) {
          var store = sh.getRange(rowIdx, map['Store']).getValue();
          if (allowedStores.indexOf(store) === -1) return;
        }
        sh.getRange(rowIdx, map['LuongGio']).setValue(parseFloat(r.LuongGio) || 0);
        saved++;
      });
      logAudit_(account.username, 'LUU_LUONG_GIO_BATCH', SHEET_NAMES.NHAN_VIEN, saved + ' nhân viên đã lưu lương/giờ');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

// ----------------------------------------------------------------------------
// 3) CÔNG NHẬT (GIỜ LÀM) THEO NGÀY — ThanhTien = GioLam * LuongGio (snapshot
//    tại thời điểm lưu, để sau này đổi lương/giờ không làm sai lệch lịch sử).
// ----------------------------------------------------------------------------
function saveCongNhatNgay(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền chấm công cho cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.NhanVienId + '|' + rowObj.Ngay;
    rowObj.ThanhTien = (parseFloat(rowObj.GioLam) || 0) * (parseFloat(rowObj.LuongGio) || 0);
    var result = upsertRowByKey_(SHEET_NAMES.CONG_NHAT_NGAY, 'Key_Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'LUU_CONG_NHAT_NGAY', rowObj.Key_Id, 'GioLam=' + rowObj.GioLam + ' ThanhTien=' + rowObj.ThanhTien);
      bumpDataVersion_();
    }
    return result;
  });
}
/** Tiền công = số PHÚT làm × lương/giờ ÷ 60 (không làm tròn giờ), làm tròn tới 1 đồng. */
function wageFromHours_(gioLam, luongGio) {
  var phut = Math.round(numDot_(gioLam) * 60);
  return Math.round(phut * numDot_(luongGio) / 60);
}
function numDot_(v) {
  var n = parseFloat(String(v == null ? '' : v).trim().replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
/** Lưu hàng loạt công nhật cùng lúc (nhiều nhân viên trong 1 ngày, hoặc 1 nhân viên nhiều ngày) — 1 lock cho nhanh. */
function saveCongNhatNgayBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.CONG_NHAT_NGAY);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.CONG_NHAT_NGAY]);
      var map = getHeaderMap_(sh);
      // BẮT BUỘC: ép cả cột Ngay + Key_Id sang text TRƯỚC khi ghi, nếu không Google Sheets
      // tự convert "2026-09-18" thành Date rồi lưu ra số serial -> bảng Lợi Nhuận Ngày không khớp ngày.
      if (map['Ngay']) sh.getRange(2, map['Ngay'], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
      if (map['Key_Id']) sh.getRange(2, map['Key_Id'], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
      var keyColIdx = map['Key_Id'];
      var lastRow = sh.getLastRow();
      var existingKeys = {};
      if (lastRow > 1) {
        var keys = sh.getRange(2, keyColIdx, lastRow - 1, 1).getValues();
        keys.forEach(function (k, i) { existingKeys[String(k[0])] = i + 2; });
      }
      var schema = SHEET_SCHEMAS[SHEET_NAMES.CONG_NHAT_NGAY];
      var appended = [];
      var saved = 0;
      rows.forEach(function (rowObj) {
        if (!rowObj.NhanVienId || !rowObj.Ngay) return;
        rowObj.Key_Id = rowObj.NhanVienId + '|' + rowObj.Ngay;
        rowObj.ThanhTien = wageFromHours_(rowObj.GioLam, rowObj.LuongGio);
        rowObj.GioLam = numDot_(rowObj.GioLam);
        if (rowObj.ChiTietCa === undefined && map['ChiTietCa'] && existingKeys[String(rowObj.Key_Id)]) {
          // lưu lại từ nút "Tính lại lương" thì giữ nguyên giờ vào/ra đã có
          rowObj.ChiTietCa = sh.getRange(existingKeys[String(rowObj.Key_Id)], map['ChiTietCa']).getValue();
        }
        rowObj.SavedAt = nowStr_();
        var rowValues = schema.map(function (col) { return rowObj.hasOwnProperty(col) ? rowObj[col] : ''; });
        var foundRow = existingKeys[String(rowObj.Key_Id)];
        if (foundRow) {
          sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
          forceTextFormat_(sh, [map['Ngay']], 1, foundRow);
        } else {
          appended.push(rowValues);
        }
        saved++;
      });
      if (appended.length > 0) {
        var startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, appended.length, appended[0].length).setValues(appended);
        forceTextFormat_(sh, [map['Ngay']], appended.length, startRow);
      }
      logAudit_(account.username, 'LUU_CONG_NHAT_NGAY_BATCH', SHEET_NAMES.CONG_NHAT_NGAY, saved + ' dòng đã lưu');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}
function deleteCongNhatNgay(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.CONG_NHAT_NGAY, 'Key_Id', keyId);
    if (result.success) { logAudit_(account.username, 'XOA_CONG_NHAT_NGAY', keyId, ''); bumpDataVersion_(); }
    return result;
  });
}

/**
 * Xoá TOÀN BỘ chấm công theo ngày (Data_CongNhatNgay) của 1 Cửa hàng trong khoảng [tuNgay, denNgay]
 * TRƯỚC khi nạp lại file chấm công — tránh nhân viên đã bị xoá/đổi tên trong file mới vẫn còn giờ
 * công cũ tồn lại sai lệch. Không đụng Data_NhanVien, Data_PhuCap hay bất kỳ dữ liệu kết chuyển nào.
 */
function deleteCongNhatNgayByStoreRange(token, store, tuNgay, denNgay) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(store) === -1) return fail_('Bạn không có quyền xoá chấm công cửa hàng này.');
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.CONG_NHAT_NGAY);
      if (!sh || sh.getLastRow() < 2) return ok_({ deleted: 0 });
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      var keepRows = [];
      var deleted = 0;
      values.forEach(function (row) {
        var rowStore = row[map['Store'] - 1];
        var rowNgay = String(row[map['Ngay'] - 1] || '').substring(0, 10);
        if (rowStore === store && rowNgay >= tuNgay && rowNgay <= denNgay) deleted++;
        else keepRows.push(row);
      });
      if (deleted > 0) {
        sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
        if (keepRows.length > 0) {
          sh.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          forceTextFormat_(sh, [map['Ngay'], map['Key_Id']].filter(Boolean), keepRows.length, 2);
        }
      }
      logAudit_(account.username, 'XOA_CONG_NHAT_NGAY_KHOANG_NGAY', store + ' | ' + tuNgay + '-' + denNgay, deleted + ' dòng đã xoá');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ deleted: deleted });
    } finally {
      lock.releaseLock();
    }
  });
}

// ----------------------------------------------------------------------------
// 4) DOANH THU NGOÀI KIOT THEO NGÀY — nhập tay ngay trên trang Lợi Nhuận Ngày,
//    KHÔNG lấy từ kết ca và KHÔNG lấy từ file Excel KiotViet — là 1 con số độc lập
//    cộng thêm vào doanh thu ngày.
// ----------------------------------------------------------------------------
function saveDoanhThuNgoaiKiot(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền nhập doanh thu ngoài Kiot cho cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.Ngay;
    var result = upsertRowByKey_(SHEET_NAMES.DOANH_THU_NGOAI_KIOT, 'Key_Id', rowObj);
    if (result.success) { logAudit_(account.username, 'LUU_DOANH_THU_NGOAI_KIOT', rowObj.Key_Id, 'SoTien=' + rowObj.SoTien); bumpDataVersion_(); }
    return result;
  });
}
function deleteDoanhThuNgoaiKiot(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.DOANH_THU_NGOAI_KIOT, 'Key_Id', keyId);
    if (result.success) { logAudit_(account.username, 'XOA_DOANH_THU_NGOAI_KIOT', keyId, ''); bumpDataVersion_(); }
    return result;
  });
}
/** Vá 1 lần: đổi mọi ô Ngay trong Data_CongNhatNgay về đúng chuỗi text yyyy-MM-dd. */
function repairCongNhatNgayDates_Run() {
  var sh = SS.getSheetByName(SHEET_NAMES.CONG_NHAT_NGAY);
  if (!sh || sh.getLastRow() < 2) return 'Không có dữ liệu.';
  var map = getHeaderMap_(sh);
  var lastRow = sh.getLastRow();
  var rng = sh.getRange(2, map['Ngay'], lastRow - 1, 1);
  var vals = rng.getValues();
  var out = vals.map(function (r) {
    var v = r[0];
    if (v instanceof Date) return [Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')];
    if (typeof v === 'number' && v > 20000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return [Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')];
    }
    return [String(v || '')];
  });
  rng.setNumberFormat('@').setValues(out);
  // Ghi lại Key_Id cho khớp NhanVienId|Ngay
  var kRng = sh.getRange(2, map['Key_Id'], lastRow - 1, 1);
  var nvRng = sh.getRange(2, map['NhanVienId'], lastRow - 1, 1).getValues();
  kRng.setNumberFormat('@').setValues(nvRng.map(function (r, i) { return [r[0] + '|' + out[i][0]]; }));
  invalidateMasterCache_();
  return 'Đã vá ' + out.length + ' dòng.';
}
// ----------------------------------------------------------------------------
// 5) LỊCH SỬ NẠP GIỜ CÔNG THEO NGÀY — ghi lại mỗi lần nạp file "Chi tiết chấm
//    công", kèm danh sách Key_Id (NhanVienId|Ngay) đã ghi/ghi đè, để có thể
//    XOÁ đúng phần dữ liệu do lần nạp đó tạo ra khi cần.
// ----------------------------------------------------------------------------
function recordImportHistoryGioCong(token, fileName, soNhanVien, soLuot, affectedKeysCsv) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var sh = getOrCreateSheet_(SHEET_NAMES.IMPORT_HISTORY_GIOCONG);
    ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.IMPORT_HISTORY_GIOCONG]);
    var id = genId_('IMPGC');
    sh.appendRow([id, fileName, nowStr_(), soNhanVien, soLuot, String(affectedKeysCsv || ''), account.username]);
    return ok_({ id: id });
  });
}
function getImportHistoryGioCong(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var rows = readSheetAsObjects_(SHEET_NAMES.IMPORT_HISTORY_GIOCONG);
    rows.sort(function (a, b) { return String(b.ImportedAt).localeCompare(String(a.ImportedAt)); });
    return ok_(rows);
  });
}
/** Xoá 1 lần nạp: luôn xoá dòng lịch sử; nếu deleteData=true thì xoá kèm đúng các dòng
 * Data_CongNhatNgay (theo Key_Id NhanVienId|Ngay) đã được lần nạp đó ghi/ghi đè. */
function deleteImportHistoryGioCongRow(token, id, deleteData) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var histRows = readSheetAsObjects_(SHEET_NAMES.IMPORT_HISTORY_GIOCONG);
    var rec = histRows.filter(function (r) { return r.Id === id; })[0];
    var deletedData = 0;
    if (deleteData && rec && rec.AffectedKeys) {
      var keySet = {};
      String(rec.AffectedKeys).split(',').filter(Boolean).forEach(function (k) { keySet[k] = true; });
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
      try {
        var sh2 = SS.getSheetByName(SHEET_NAMES.CONG_NHAT_NGAY);
        if (sh2 && sh2.getLastRow() > 1) {
          var map2 = getHeaderMap_(sh2);
          var lastRow2 = sh2.getLastRow();
          var vals = sh2.getRange(2, 1, lastRow2 - 1, sh2.getLastColumn()).getValues();
          var keepRows = [];
          vals.forEach(function (row) {
            var k = String(row[map2['Key_Id'] - 1]);
            if (keySet[k]) deletedData++; else keepRows.push(row);
          });
          if (deletedData > 0) {
            sh2.getRange(2, 1, lastRow2 - 1, sh2.getLastColumn()).clearContent();
            if (keepRows.length > 0) sh2.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          }
        }
      } finally {
        lock.releaseLock();
      }
      invalidateMasterCache_();
      bumpDataVersion_();
    }
    var result = deleteRowByKey_(SHEET_NAMES.IMPORT_HISTORY_GIOCONG, 'Id', id);
    if (result.success) logAudit_(account.username, 'XOA_LICH_SU_NAP_GIO_CONG', id, deletedData + ' dòng chấm công đã xoá kèm theo');
    return ok_({ deleted: deletedData });
  });
}

// ----------------------------------------------------------------------------
// 6) GHI LỢI NHUẬN NGÀY NHIỀU CỬA HÀNG VÀO GOOGLE SHEET — mỗi cửa hàng 1 tab,
//    mỗi dòng là 1 ngày trong tháng. Số liệu ghi ở dạng SỐ THUẦN (numberFormat
//    '#,##0'), KHÔNG có ký hiệu "đ" khi mở trong Google Sheet.
// ----------------------------------------------------------------------------
function writeLoiNhuanNgaySheetsToGoogleSheet(token, sheetUrl, sheetsPayload) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!sheetUrl || !sheetsPayload || sheetsPayload.length === 0) return fail_('Thiếu link Google Sheet hoặc dữ liệu để ghi.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var targetSS;
      try {
        targetSS = SpreadsheetApp.openByUrl(sheetUrl);
      } catch (e) {
        return fail_('Không mở được Google Sheet — kiểm tra lại link và đảm bảo tài khoản chạy script có quyền chỉnh sửa file đó.');
      }
      var written = 0;
      sheetsPayload.forEach(function (sp) {
        var safeName = String(sp.name || 'CuaHang').substring(0, 95);
        var sh = targetSS.getSheetByName(safeName);
        if (sh) { sh.clear(); sh.clearFormats(); } else { sh = targetSS.insertSheet(safeName); }
        if (sp.aoa && sp.aoa.length > 0) {
          var numRows = sp.aoa.length, numCols = sp.aoa[0].length;
          sh.getRange(1, 1, numRows, numCols).setValues(sp.aoa);
          sh.getRange(2, 2, numRows - 1, numCols - 1).setNumberFormat('#,##0');
          sh.getRange(1, 1, 1, numCols).setBackground('#146c43').setFontColor('#ffffff').setFontWeight('bold');
          sh.getRange(numRows, 1, 1, numCols).setBackground('#0a2a1c').setFontColor('#ffffff').setFontWeight('bold');
          sh.getRange(1, 1, numRows, numCols).setBorder(true, true, true, true, true, true, '#b7c2ba', SpreadsheetApp.BorderStyle.SOLID);
          sh.setFrozenRows(1);
          sh.setFrozenColumns(1);
          sh.autoResizeColumns(1, Math.min(numCols, 20));
        }
        written++;
      });
      logAudit_(account.username, 'GHI_LOINHUANNGAY_GOOGLE_SHEET', sheetUrl, written + ' sheet đã ghi');
      return ok_({ written: written, url: targetSS.getUrl() });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================
// GIAI ĐOẠN 8 — DANH MỤC SẢN PHẨM (Hàng hóa / Dịch vụ / Combo) & GIÁ VỐN
// Nguồn: file "Danh sách sản phẩm" xuất từ KiotViet.
// Client đọc file Excel, chuẩn hoá rồi gửi lên đây theo lô; server chỉ lo ghi.
// DonGiaVon (giá vốn áp dụng, nhập tay) LUÔN được giữ lại khi nạp đè danh mục.
// ============================================================================
function saveSanPhamBatch(token, rows) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.SAN_PHAM);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.SAN_PHAM]);
      var schema = SHEET_SCHEMAS[SHEET_NAMES.SAN_PHAM];
      var map = getHeaderMap_(sh);
      // Mã hàng/Thành phần phải là text tuyệt đối (tránh Sheets hiểu nhầm số/ngày)
      ['ItemCode', 'ThanhPhan'].forEach(function (c) {
        if (map[c]) sh.getRange(2, map[c], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
      });
      var idxDonGiaVon = schema.indexOf('DonGiaVon');
      var lastRow = sh.getLastRow();
      var rowOf = {}, valOf = {};
      if (lastRow > 1) {
        var vals = sh.getRange(2, 1, lastRow - 1, schema.length).getValues();
        vals.forEach(function (r, i) {
          var code = String(r[0] || '').trim();
          if (code) { rowOf[code] = i + 2; valOf[code] = r; }
        });
      }
      var appended = [], saved = 0;
      rows.forEach(function (r) {
        var code = String(r.ItemCode || '').trim();
        if (!code) return;
        var old = valOf[code];
        var donGiaVon = (r.DonGiaVon !== undefined && r.DonGiaVon !== '' && r.DonGiaVon !== null)
          ? r.DonGiaVon
          : (old ? old[idxDonGiaVon] : '');
        var rowValues = [code, r.ItemName || '', r.LoaiHang || '', r.NhomHang || '',
          parseFloat(r.GiaBan) || 0, parseFloat(r.GiaVonFile) || 0, String(r.ThanhPhan || ''), donGiaVon, nowStr_()];
        var foundRow = rowOf[code];
        if (foundRow) sh.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
        else appended.push(rowValues);
        saved++;
      });
      if (appended.length > 0) {
        sh.getRange(sh.getLastRow() + 1, 1, appended.length, appended[0].length).setValues(appended);
      }
      logAudit_(guard.account.username, 'NAP_DANH_MUC_SAN_PHAM', SHEET_NAMES.SAN_PHAM, saved + ' sản phẩm');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved });
    } finally { lock.releaseLock(); }
  });
}

/** Lưu hàng loạt "Giá vốn áp dụng" (nhập tay) — chỉ đụng cột DonGiaVon. */
function saveDonGiaVonBatch(token, rows) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(SHEET_NAMES.SAN_PHAM);
      ensureSchema_(sh, SHEET_SCHEMAS[SHEET_NAMES.SAN_PHAM]);
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return fail_('Chưa có danh mục sản phẩm — hãy nạp file KiotViet trước.');
      var codes = sh.getRange(2, map['ItemCode'], lastRow - 1, 1).getValues();
      var rowOf = {};
      codes.forEach(function (r, i) { rowOf[String(r[0]).trim()] = i + 2; });
      var saved = 0;
      rows.forEach(function (r) {
        var rowIdx = rowOf[String(r.ItemCode || '').trim()];
        if (!rowIdx) return;
        sh.getRange(rowIdx, map['DonGiaVon']).setValue(parseFloat(r.DonGiaVon) || 0);
        sh.getRange(rowIdx, map['SavedAt']).setValue(nowStr_());
        saved++;
      });
      logAudit_(guard.account.username, 'LUU_GIA_VON_SAN_PHAM', SHEET_NAMES.SAN_PHAM, saved + ' sản phẩm');
      invalidateMasterCache_();
      return ok_({ saved: saved });
    } finally { lock.releaseLock(); }
  });
}

function deleteSanPham(token, itemCode) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var result = deleteRowByKey_(SHEET_NAMES.SAN_PHAM, 'ItemCode', itemCode);
    if (result.success) logAudit_(guard.account.username, 'XOA_SAN_PHAM', itemCode, '');
    return result;
  });
}

/** Xoá sạch danh mục (dùng khi muốn nạp lại từ đầu) — chỉ Admin. */
function clearAllSanPham(token) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var sh = getOrCreateSheet_(SHEET_NAMES.SAN_PHAM);
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
    logAudit_(guard.account.username, 'XOA_TOAN_BO_SAN_PHAM', SHEET_NAMES.SAN_PHAM, '');
    invalidateMasterCache_();
    return ok_({ message: 'Đã xoá toàn bộ danh mục sản phẩm.' });
  });
}

// ============================================================================
// GĐ4 — Nhập hàng, Hủy / Trả TikTok / SP không bấm bill + Lịch sử nạp nhập hàng
// ============================================================================
var NH_HIST_ = 'Data_ImportHistoryNhapHang';
var KHO_SCHEMAS_ = {
  Data_NhapHang: ['Key_Id', 'Store', 'Ngay', 'MaNhap', 'ItemCode', 'ItemName', 'SoLuong', 'SavedAt', 'ImportId', 'GhiChu'],
  Data_ImportHistoryNhapHang: ['Id', 'FileName', 'ImportedAt', 'TuNgay', 'DenNgay', 'SoPhieu', 'SoDong', 'SoBoQua', 'CuaHang', 'User']
};

function ensureKhoSchemas_() {
  Object.keys(KHO_SCHEMAS_).forEach(function (k) { if (!SHEET_SCHEMAS[k]) SHEET_SCHEMAS[k] = KHO_SCHEMAS_[k]; });
  TEXT_FORMAT_COLUMNS.Data_NhapHang = ['Ngay'];
  TEXT_FORMAT_COLUMNS.Data_ImportHistoryNhapHang = ['TuNgay', 'DenNgay'];
}

/* ============================================================================
 * GĐ5 — TRẢ HÀNG NHẬP (KiotViet) — phân loại theo Ghi chú cấp phiếu:
 * chứa "tiktok" -> Trả TikTok | chứa "sale" -> Bánh Sale | chứa "hủy"/"huy" -> Hủy bánh | còn lại -> Khác
 * ============================================================================ */
var THN_HIST_ = 'Data_ImportHistoryTraHangNhap';
var THN_SCHEMAS_ = {
  Data_ImportHistoryTraHangNhap: ['Id', 'FileName', 'ImportedAt', 'SoPhieu', 'SoDong', 'CuaHang', 'User']
};
function ensureThnSchemas_() {
  Object.keys(THN_SCHEMAS_).forEach(function (k) { if (!SHEET_SCHEMAS[k]) SHEET_SCHEMAS[k] = THN_SCHEMAS_[k]; });
  TEXT_FORMAT_COLUMNS.Data_ImportHistoryTraHangNhap = ['ImportedAt'];
}

/** Chuẩn hoá Ghi chú (bỏ dấu, chữ thường) để so khớp từ khóa phân loại. */
function thnClassifyGhiChu_(ghiChu) {
  var s = removeVNTonesServer_(ghiChu);
  if (s.indexOf('tiktok') !== -1) return 'TraTiktok';
  if (s.indexOf('sale') !== -1) return 'BanhSale';
  if (s.indexOf('huy') !== -1) return 'Huy';
  return 'Khac';
}
function removeVNTonesServer_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

/**
 * So khớp các phiếu (Mã trả hàng nhập) client đã đọc từ Excel với dữ liệu đã lưu trong
 * Data_BanhSale / Data_XuatKhac (nhận diện qua GhiChu = "THN:<mã phiếu> | CHO|XN | ...").
 * Trả về existing = { maPhieu: số liệu cũ } để client dựng UI xác nhận trước khi lưu thật.
 */
function previewTraHangNhap(token, phieuList) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    ensureThnSchemas_(); ensureKhoSchemas_();

    var oldByPhieu = {};
    function scanOld(sheetName) {
      var sh = SS.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      var map = getHeaderMap_(sh);
      if (!map['GhiChu']) return;
      var rows = readSheetAsObjects_(sheetName);
      rows.forEach(function (r) {
        var m = String(r.GhiChu || '').match(/^THN:(\S+)\s*\|\s*(CHO|XN)\s*\|/);
        if (!m) return;
        var ma = m[1], trangThai = m[2];
        var sl = parseFloat(r.SoLuong) || 0;
        oldByPhieu[ma] = oldByPhieu[ma] || { count: 0, choCount: 0, xnCount: 0, choSl: 0, xnSl: 0, sheets: {} };
        oldByPhieu[ma].count++;
        oldByPhieu[ma].sheets[sheetName] = (oldByPhieu[ma].sheets[sheetName] || 0) + 1;
        if (trangThai === 'XN') { oldByPhieu[ma].xnCount++; oldByPhieu[ma].xnSl += sl; }
        else { oldByPhieu[ma].choCount++; oldByPhieu[ma].choSl += sl; }
      });
    }
    scanOld(SHEET_NAMES.BANH_SALE);
    scanOld(SHEET_NAMES.XUAT_KHAC);

    var existing = {};
    (phieuList || []).forEach(function (ma) { if (oldByPhieu[ma]) existing[ma] = oldByPhieu[ma]; });
    return ok_({ existing: existing });
  });
}

/** Xóa mọi dòng trong 1 sheet có GhiChu bắt đầu bằng "THN:<maPhieu>" — dùng khi nạp đè / thay thế phiếu trùng.
 *  BẢN AN TOÀN: ghi các dòng giữ lại xuống TRƯỚC, rồi mới xóa phần đuôi thừa.
 *  Nếu có lỗi giữa chừng, dữ liệu không bao giờ bị xóa trắng toàn bộ như bản cũ (xóa hết rồi mới ghi lại). */
function thnDeleteRowsByPhieu_(sheetName, maPhieuSet) {
  var sh = SS.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return 0;
  var map = getHeaderMap_(sh);
  if (!map['GhiChu']) return 0;
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var iGc = map['GhiChu'] - 1;
  var keep = [], deleted = 0;
  values.forEach(function (row) {
    var m = String(row[iGc] || '').match(/^THN:(\S+)/);
    if (m && maPhieuSet[m[1]]) deleted++;
    else keep.push(row);
  });
  if (deleted > 0) {
    if (keep.length > 0) sh.getRange(2, 1, keep.length, lastCol).setValues(keep);
    var soDongThua = (lastRow - 1) - keep.length;
    if (soDongThua > 0) sh.getRange(2 + keep.length, 1, soDongThua, lastCol).clearContent();
  }
  return deleted;
}

/**
 * Lưu thật dữ liệu Trả Hàng Nhập đã được client phân loại + tính toán đầy đủ.
 * payload = {
 *   fileName: string,
 *   deletePhieu: ['THN006012.01', ...],           // các mã phiếu cần xóa dữ liệu cũ trước khi ghi mới
 *   banhSaleRows: [ {Store, Ngay, ItemCode, ItemName, SoLuong, TrangThai, NgayNhap, NgayRaDong,
 *                     SoNgay, GiaBanGoc, GiaSale, GiaVonDonVi, ThanhTienSale, ThanhTienGiaVon,
 *                     LoiNhuanSale, GiaGiamTong, GhiChu}, ... ],   // GhiChu phải là "THN:<maPhieu> | ..."
 *   xuatKhacRows: [ {Store, Ngay, Loai, ItemCode, ItemName, SoLuong, GiaVonDonVi, ThanhTienGiaVon,
 *                     LyDo, GhiChu}, ... ]          // Loai: 'Huy' | 'TraTiktok' | 'Khac' ; GhiChu = "THN:<maPhieu> | ..."
 * }
 */
function saveTraHangNhapImport(token, payload) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!payload) return fail_('Thiếu dữ liệu để lưu.');
    ensureThnSchemas_(); ensureKhoSchemas_();

    var banhSaleRows = payload.banhSaleRows || [];
    var xuatKhacRows = payload.xuatKhacRows || [];
    var deletePhieu = payload.deletePhieu || [];

    var storesTouched = {};
    banhSaleRows.concat(xuatKhacRows).forEach(function (r) { storesTouched[r.Store] = true; });
    for (var s in storesTouched) {
      if (!khoCanEditStore_(account, s)) return fail_('Bạn không có quyền nạp dữ liệu cho cửa hàng "' + s + '".');
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      var maPhieuSet = {};
      deletePhieu.forEach(function (m) { maPhieuSet[m] = true; });
      var deletedCount = 0;
      if (deletePhieu.length > 0) {
        deletedCount += thnDeleteRowsByPhieu_(SHEET_NAMES.BANH_SALE, maPhieuSet);
        deletedCount += thnDeleteRowsByPhieu_(SHEET_NAMES.XUAT_KHAC, maPhieuSet);
      }

      // --- Ghi Bánh Sale ---
      var bsSaved = 0;
      if (banhSaleRows.length > 0) {
        var shBs = getOrCreateSheet_(SHEET_NAMES.BANH_SALE);
        ensureSchema_(shBs, SHEET_SCHEMAS[SHEET_NAMES.BANH_SALE]);
        var schemaBs = SHEET_SCHEMAS[SHEET_NAMES.BANH_SALE];
        var mapBs = getHeaderMap_(shBs);
        var appendBs = [];
        banhSaleRows.forEach(function (r) {
          r.Key_Id = genId_('SALE');
          r.DaGhiNhanChiPhi = false;
          r.SavedAt = nowStr_();
          appendBs.push(schemaBs.map(function (c) { return r.hasOwnProperty(c) ? r[c] : ''; }));
        });
        var startBs = shBs.getLastRow() + 1;
        shBs.getRange(startBs, 1, appendBs.length, appendBs[0].length).setValues(appendBs);
        forceTextFormat_(shBs, [mapBs['Ngay'], mapBs['NgayNhap'], mapBs['NgayRaDong']].filter(Boolean), appendBs.length, startBs);
        bsSaved = appendBs.length;
      }

      // --- Ghi Xuất Khác (Hủy / Trả TikTok / Khác) ---
      var xkSaved = 0;
      if (xuatKhacRows.length > 0) {
        var shXk = getOrCreateSheet_(SHEET_NAMES.XUAT_KHAC);
        ensureSchema_(shXk, SHEET_SCHEMAS[SHEET_NAMES.XUAT_KHAC]);
        var schemaXk = SHEET_SCHEMAS[SHEET_NAMES.XUAT_KHAC];
        var mapXk = getHeaderMap_(shXk);
        var appendXk = [];
        xuatKhacRows.forEach(function (r) {
          r.Key_Id = genId_('XK');
          // Giữ nguyên r.DaGhiNhanChiPhi mà client đã tính sẵn theo lựa chọn của người dùng
          // (Công ty hỗ trợ = false, Tính chi phí CH = true, TraTiktok luôn = true).
          r.SavedAt = nowStr_();
          appendXk.push(schemaXk.map(function (c) { return r.hasOwnProperty(c) ? r[c] : ''; }));
        });
        var startXk = shXk.getLastRow() + 1;
        shXk.getRange(startXk, 1, appendXk.length, appendXk[0].length).setValues(appendXk);
        forceTextFormat_(shXk, [mapXk['Ngay']].filter(Boolean), appendXk.length, startXk);
        xkSaved = appendXk.length;
      }

      // --- Lịch sử nạp ---
      var histSh = getOrCreateSheet_(THN_HIST_);
      ensureSchema_(histSh, SHEET_SCHEMAS[THN_HIST_]);
      var histRow = [genId_('IMPTHN'), payload.fileName || '', nowStr_(),
        deletePhieu.length, bsSaved + xkSaved, Object.keys(storesTouched).join(', '), account.username];
      histSh.getRange(histSh.getLastRow() + 1, 1, 1, histRow.length).setValues([histRow]);

      logAudit_(account.username, 'NAP_TRA_HANG_NHAP', payload.fileName || '',
        'Xóa ' + deletedCount + ' dòng cũ, ghi ' + bsSaved + ' Bánh Sale, ' + xkSaved + ' Xuất Khác');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ deleted: deletedCount, banhSaleSaved: bsSaved, xuatKhacSaved: xkSaved });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Ép cột Ngay của sheet mới thành text TRƯỚC khi ghi để Google Sheets không đổi thành Date. */
function khoPreformatDate_(sheetName) {
  var sh = getOrCreateSheet_(sheetName);
  ensureSchema_(sh, SHEET_SCHEMAS[sheetName]);
  var map = getHeaderMap_(sh);
  ['Ngay', 'Key_Id', 'MaNhap', 'ItemCode', 'ImportId'].forEach(function (c) {
    if (map[c]) sh.getRange(2, map[c], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
  return sh;
}
function khoHistSheet_() {
  ensureKhoSchemas_();
  var sh = getOrCreateSheet_(NH_HIST_);
  ensureSchema_(sh, SHEET_SCHEMAS[NH_HIST_]);
  var map = getHeaderMap_(sh);
  ['Id', 'ImportedAt', 'TuNgay', 'DenNgay'].forEach(function (c) {
    if (map[c]) sh.getRange(2, map[c], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
  return sh;
}
function khoCanEditStore_(account, store) {
  if (account.role === 'Admin') return true;
  var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
  return allowed.indexOf(store) !== -1;
}
/** Chỉ giữ phiếu nhập từ đầu tháng của 3 tháng trước để master data không phình (cache 100KB). */
function filterRecentNhapHang_(rows) {
  var d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(1);
  var cut = Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  return rows.filter(function (r) { return String(r.Ngay) >= cut || !/^\d{4}-/.test(String(r.Ngay)); });
}

function saveNhapHangBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    ensureKhoSchemas_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận ghi dữ liệu, vui lòng thử lại.');
    try {
      for (var q = 0; q < rows.length; q++) {
        if (String(rows[q].MaNhap || '').indexOf('TAY-') === 0 && !String(rows[q].GhiChu || '').trim()) return fail_('Cập nhật tay bắt buộc phải có ghi chú.');
      }
      var name = 'Data_NhapHang';
      var sh = khoPreformatDate_(name);
      var schema = SHEET_SCHEMAS[name];
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      var existing = {};
      if (lastRow > 1) {
        sh.getRange(2, map['Key_Id'], lastRow - 1, 1).getValues().forEach(function (k, i) { existing[String(k[0])] = i + 2; });
      }
      var appended = [], saved = 0, trung = 0;
      rows.forEach(function (r) {
        if (!r.Store || !r.Ngay || !r.MaNhap || !r.ItemCode) return;
        if (!khoCanEditStore_(account, r.Store)) return;
        r.Key_Id = r.Store + '|' + r.MaNhap + '|' + r.ItemCode;
        r.SavedAt = nowStr_();
        var vals = schema.map(function (c) { return r.hasOwnProperty(c) ? r[c] : ''; });
        var f = existing[r.Key_Id];
        if (f) { sh.getRange(f, 1, 1, vals.length).setValues([vals]); trung++; }
        else appended.push(vals);
        saved++;
      });
      if (appended.length > 0) {
        var start = sh.getLastRow() + 1;
        sh.getRange(start, 1, appended.length, appended[0].length).setValues(appended);
      }
      logAudit_(account.username, 'NAP_NHAP_HANG', name, saved + ' dòng (' + trung + ' trùng phiếu đã ghi đè)');
      bumpDataVersion_();
      invalidateMasterCache_();
      return ok_({ saved: saved, trung: trung });
    } finally { lock.releaseLock(); }
  });
}

/* ============================================================================
 * LỊCH SỬ NẠP NHẬP HÀNG — ghi lại từng file, cho phép xóa đúng các dòng do file đó tạo ra
 * ============================================================================ */
function recordImportHistoryNhapHang(token, meta) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!meta || !meta.Id) return fail_('Thiếu mã lần nạp.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = khoHistSheet_();
      var schema = SHEET_SCHEMAS[NH_HIST_];
      var row = {
        Id: meta.Id, FileName: meta.FileName || '', ImportedAt: nowStr_(),
        TuNgay: meta.TuNgay || '', DenNgay: meta.DenNgay || '',
        SoPhieu: meta.SoPhieu || 0, SoDong: meta.SoDong || 0, SoBoQua: meta.SoBoQua || 0,
        CuaHang: meta.CuaHang || '', User: account.username
      };
      var vals = schema.map(function (c) { return row.hasOwnProperty(c) ? row[c] : ''; });
      sh.getRange(sh.getLastRow() + 1, 1, 1, vals.length).setValues([vals]);
      logAudit_(account.username, 'GHI_LICH_SU_NAP_NHAP_HANG', meta.Id, (meta.FileName || '') + ' | ' + meta.SoDong + ' dòng');
      return ok_({ id: meta.Id });
    } finally { lock.releaseLock(); }
  });
}

function getImportHistoryNhapHang(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var rows = readSheetAsObjects_(NH_HIST_);
    if (account.role !== 'Admin') rows = rows.filter(function (r) { return r.User === account.username; });
    rows.sort(function (a, b) { return String(b.ImportedAt).localeCompare(String(a.ImportedAt)); });
    return ok_(rows);
  });
}

/** Xóa 1 lần nạp: xóa các dòng Data_NhapHang mang đúng ImportId này + xóa dòng lịch sử. */
function deleteImportHistoryNhapHang(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    ensureKhoSchemas_();
    var rec = readSheetAsObjects_(NH_HIST_).filter(function (r) { return r.Id === id; })[0];
    if (!rec) return fail_('Không tìm thấy lần nạp này (có thể đã bị xóa).');
    if (account.role !== 'Admin' && rec.User !== account.username) return fail_('Bạn chỉ được xóa lần nạp do chính mình thực hiện.');

    var deleted = 0;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = khoPreformatDate_('Data_NhapHang');
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow > 1) {
        var lastCol = sh.getLastColumn();
        var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
        var iImp = map['ImportId'] - 1;
        var keep = [];
        values.forEach(function (row) {
          if (String(row[iImp]) === String(id)) deleted++; else keep.push(row);
        });
        if (deleted > 0) {
          sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
          if (keep.length > 0) sh.getRange(2, 1, keep.length, lastCol).setValues(keep);
        }
      }
    } finally { lock.releaseLock(); }

    deleteRowByKey_(NH_HIST_, 'Id', id); // tự lấy khóa riêng, nên gọi SAU khi đã nhả khóa ở trên
    logAudit_(account.username, 'XOA_LICH_SU_NAP_NHAP_HANG', id, (rec.FileName || '') + ' | ' + deleted + ' dòng nhập đã xóa');
    invalidateMasterCache_();
    bumpDataVersion_();
    return ok_({ deleted: deleted });
  });
}

/** Loai: 'Huy' | 'TraTiktok' | 'KhongBill' */
function saveXuatKhac(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!khoCanEditStore_(account, rowObj.Store)) return fail_('Bạn không có quyền nhập cho cửa hàng này.');
    ensureKhoSchemas_();
    khoPreformatDate_(SHEET_NAMES.XUAT_KHAC);
    if (!rowObj.Key_Id) rowObj.Key_Id = genId_('XK');
    var res = upsertRowByKey_(SHEET_NAMES.XUAT_KHAC, 'Key_Id', rowObj);
    if (res.success) logAudit_(account.username, 'LUU_XUAT_KHAC', rowObj.Loai + ' | ' + rowObj.Store + ' | ' + rowObj.ItemName, 'SL=' + rowObj.SoLuong);
    return res;
  });
}
/** Lưu nhiều dòng; dòng có SoLuong <= 0 sẽ bị xoá (dùng cho "SP không bấm bill"). */
function saveXuatKhacBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    ensureKhoSchemas_();
    khoPreformatDate_(SHEET_NAMES.XUAT_KHAC);
    var saved = 0, deleted = 0;
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (!khoCanEditStore_(account, r.Store)) continue;
      if (!(parseFloat(r.SoLuong) > 0)) { deleteRowByKey_(SHEET_NAMES.XUAT_KHAC, 'Key_Id', r.Key_Id); deleted++; continue; }
      var res = upsertRowByKey_(SHEET_NAMES.XUAT_KHAC, 'Key_Id', r);
      if (res.success) saved++;
    }
    logAudit_(account.username, 'LUU_XUAT_KHAC_BATCH', SHEET_NAMES.XUAT_KHAC, saved + ' lưu, ' + deleted + ' xoá');
    return ok_({ saved: saved, deleted: deleted });
  });
}
function deleteXuatKhac(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var res = deleteRowByKey_(SHEET_NAMES.XUAT_KHAC, 'Key_Id', keyId);
    if (res.success) logAudit_(account.username, 'XOA_XUAT_KHAC', keyId, '');
    return res;
  });
}
/** Ghi nhận chi phí cho các dòng Hủy đã chọn. */
function ghiNhanXuatKhacBatch(token, keyIds) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!keyIds || keyIds.length === 0) return ok_({ updated: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.XUAT_KHAC);
      if (!sh || sh.getLastRow() < 2) return ok_({ updated: 0 });
      var map = getHeaderMap_(sh);
      var keys = sh.getRange(2, map['Key_Id'], sh.getLastRow() - 1, 1).getValues();
      var notes = map['GhiChu'] ? sh.getRange(2, map['GhiChu'], sh.getLastRow() - 1, 1).getValues() : [];
      var set = {}; keyIds.forEach(function (k) { set[k] = true; });
      var updated = 0, skipped = 0;
      for (var i = 0; i < keys.length; i++) {
        if (set[String(keys[i][0])]) {
          if (notes.length && /^THN:\S+ \| CHO \|/.test(String(notes[i][0] || ''))) { skipped++; continue; }
          sh.getRange(i + 2, map['DaGhiNhanChiPhi']).setValue(true);
          updated++;
        }
      }
      logAudit_(account.username, 'GHI_NHAN_CHI_PHI_XUAT_KHAC', keyIds.join(','), updated + ' dòng, bỏ qua ' + skipped + ' dòng chờ xác nhận');
      invalidateMasterCache_();
      return ok_({ updated: updated, skipped: skipped });
    } finally { lock.releaseLock(); }
  });
}
/** Chỉ cho xoá dòng nhập kho TAY (MaNhap bắt đầu bằng TAY-); phiếu nạp từ KiotViet xóa ở Lịch sử nạp file. */
function deleteNhapHang(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (String(keyId).indexOf('|TAY-') === -1) return fail_('Chỉ được xoá dòng nhập kho tay.');
    var store = String(keyId).split('|')[0];
    if (!khoCanEditStore_(account, store)) return fail_('Bạn không có quyền xoá phiếu nhập của cửa hàng này.');
    var res = deleteRowByKey_('Data_NhapHang', 'Key_Id', keyId);
    if (res.success) { logAudit_(account.username, 'XOA_NHAP_HANG_TAY', keyId, ''); bumpDataVersion_(); }
    return res;
  });
}
/** ===== TỒN KHO KIOT — LỊCH SỬ NẠP FILE ===== */
var TKK_HIST_NAME_ = 'Data_ImportHistoryTonKho';
var TKK_HIST_SCHEMA_ = ['Id', 'FileName', 'ImportedAt', 'Thang', 'SoDong', 'CuaHang', 'User'];

function tkkHistSheet_() {
  SHEET_SCHEMAS[TKK_HIST_NAME_] = TKK_HIST_SCHEMA_;
  var sh = getOrCreateSheet_(TKK_HIST_NAME_);
  ensureSchema_(sh, TKK_HIST_SCHEMA_);
  var map = getHeaderMap_(sh);
  ['Id', 'ImportedAt', 'Thang'].forEach(function (c) {
    if (map[c]) sh.getRange(2, map[c], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
  return sh;
}

function recordImportHistoryTonKho(token, meta) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!meta || !meta.Id) return fail_('Thiếu mã lần nạp.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = tkkHistSheet_();
      var row = [meta.Id, meta.FileName || '', nowStr_(), meta.Thang || '', meta.SoDong || 0, meta.CuaHang || '', account.username];
      sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
      logAudit_(account.username, 'GHI_LICH_SU_NAP_TON_KHO', meta.Id, (meta.FileName || '') + ' | ' + meta.SoDong + ' dòng');
      return ok_({ id: meta.Id });
    } finally { lock.releaseLock(); }
  });
}

function getImportHistoryTonKho(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var rows = readSheetAsObjects_(TKK_HIST_NAME_);
    if (account.role !== 'Admin') rows = rows.filter(function (r) { return r.User === account.username; });
    rows.sort(function (a, b) { return String(b.ImportedAt).localeCompare(String(a.ImportedAt)); });
    return ok_(rows);
  });
}

/** Xóa 1 lần nạp: xóa các dòng Data_TonKhoKiot mang đúng ImportId + dòng lịch sử. */
function deleteImportHistoryTonKho(token, id) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var rec = readSheetAsObjects_(TKK_HIST_NAME_).filter(function (r) { return r.Id === id; })[0];
    if (!rec) return fail_('Không tìm thấy lần nạp này (có thể đã bị xóa).');
    if (account.role !== 'Admin' && rec.User !== account.username) return fail_('Bạn chỉ được xóa lần nạp do chính mình thực hiện.');
    var deleted = 0;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(TKK_NAME_);
      if (sh && sh.getLastRow() > 1) {
        var map = getHeaderMap_(sh);
        if (map['ImportId']) {
          var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
          var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
          var iImp = map['ImportId'] - 1, keep = [];
          values.forEach(function (row) {
            if (String(row[iImp]) === String(id)) deleted++; else keep.push(row);
          });
          if (deleted > 0) {
            sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
            if (keep.length > 0) sh.getRange(2, 1, keep.length, lastCol).setValues(keep);
          }
        }
      }
    } finally { lock.releaseLock(); }
    deleteRowByKey_(TKK_HIST_NAME_, 'Id', id);
    logAudit_(account.username, 'XOA_LICH_SU_NAP_TON_KHO', id, (rec.FileName || '') + ' | ' + deleted + ' dòng đã xóa');
    invalidateMasterCache_();
    bumpDataVersion_();
    return ok_({ deleted: deleted });
  });
}

// ============================================================================
// V26 — TỒN 5 MÓN KHÔNG BẤM BILL (sheet Data_TonKhongBill)
// ============================================================================
var V26_SHEET_TON_KHONG_BILL = 'Data_TonKhongBill';
var V26_SCHEMA_TON_KHONG_BILL = ['Key_Id', 'Store', 'Thang', 'ItemCode', 'ItemName',
  'TonDau', 'NhapTrongKy', 'XuatKetCa', 'TonCuoi', 'GiaVonDonVi', 'DaChot', 'SavedAt'];

/** Lưu hàng loạt dòng tồn 5 món không bấm bill (tồn đầu/cuối kỳ theo Store+Thang+ItemCode). */
function saveTonKhongBillBatch(token, rows) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!rows || rows.length === 0) return ok_({ saved: 0 });
    var storesInRows = {};
    rows.forEach(function (r) { storesInRows[r.Store] = true; });
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      for (var s in storesInRows) {
        if (allowed.indexOf(s) === -1) return fail_('Bạn không có quyền chốt tồn kho cửa hàng ' + s + '.');
      }
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = getOrCreateSheet_(V26_SHEET_TON_KHONG_BILL);
      ensureSchema_(sh, V26_SCHEMA_TON_KHONG_BILL);
      var saved = 0;
      rows.forEach(function (r) {
        if (!r.Store || !r.Thang || !r.ItemCode) return;
        r.Key_Id = r.Store + '|' + r.Thang + '|' + r.ItemCode;
        var res = upsertRowByKey_(V26_SHEET_TON_KHONG_BILL, 'Key_Id', r);
        if (res.success) saved++;
      });
      logAudit_(account.username, 'CHOT_TON_KHONG_BILL', Object.keys(storesInRows).join(','), saved + ' dòng');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ saved: saved });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================
// BÁNH SALE
// ============================================================================
var BANH_SALE_TRANG_THAI_OPTIONS = ['Đông', 'Mát', 'Thường', 'Đã Rã Đông'];

function saveBanhSale(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền nhập bánh sale cho cửa hàng này.');
    }
    var isNewSale = !rowObj.Key_Id;
    if (isNewSale) rowObj.Key_Id = genId_('SALE');
    // Dòng mới mặc định CHƯA ghi nhận; dòng cũ không gửi cờ này thì GIỮ trạng thái cũ
    if (isNewSale && rowObj.DaGhiNhanChiPhi === undefined) rowObj.DaGhiNhanChiPhi = false;
    var result = upsertRowByKey_(SHEET_NAMES.BANH_SALE, 'Key_Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'LUU_BANH_SALE', rowObj.Store + ' | ' + rowObj.ItemName + ' | ' + rowObj.Ngay,
        'SL=' + rowObj.SoLuong + ' GiaSale=' + rowObj.GiaSale + ' LoiNhuan=' + rowObj.LoiNhuanSale);
      bumpDataVersion_();
    }
    return result;
  });
}

function deleteBanhSale(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.BANH_SALE, 'Key_Id', keyId);
    if (result.success) { logAudit_(account.username, 'XOA_BANH_SALE', keyId, ''); bumpDataVersion_(); }
    return result;
  });
}

/** Đánh dấu ĐÃ GHI NHẬN vào chi phí/doanh thu — chỉ từ lúc này bánh sale mới được cộng vào báo cáo. */
function ghiNhanChiPhiBanhSaleBatch(token, keyIds) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!keyIds || keyIds.length === 0) return ok_({ updated: 0 });
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var sh = SS.getSheetByName(SHEET_NAMES.BANH_SALE);
      if (!sh) return ok_({ updated: 0 });
      var map = getHeaderMap_(sh);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return ok_({ updated: 0 });
      if (!map['Key_Id'] || !map['DaGhiNhanChiPhi']) return fail_('Sheet Data_BanhSale thiếu cột Key_Id/DaGhiNhanChiPhi.');
      var keys = sh.getRange(2, map['Key_Id'], lastRow - 1, 1).getValues();
      var notes = map['GhiChu'] ? sh.getRange(2, map['GhiChu'], lastRow - 1, 1).getValues() : [];
      var keySet = {}; keyIds.forEach(function (k) { keySet[k] = true; });
      var updated = 0, skipped = 0;
      for (var i = 0; i < keys.length; i++) {
        if (keySet[String(keys[i][0])]) {
          if (notes.length && /^THN:\S+ \| CHO \|/.test(String(notes[i][0] || ''))) { skipped++; continue; }
          sh.getRange(i + 2, map['DaGhiNhanChiPhi']).setValue(true);
          updated++;
        }
      }
      logAudit_(account.username, 'GHI_NHAN_CHI_PHI_BANH_SALE', keyIds.join(','), updated + ' dòng đã ghi nhận, bỏ qua ' + skipped + ' dòng chờ xác nhận');
      invalidateMasterCache_();
      bumpDataVersion_();
      return ok_({ updated: updated, skipped: skipped });
    } finally {
      lock.releaseLock();
    }
  });
}

// ============================================================================
// TỒN KHO — ĐỐI SOÁT & KẾT CHUYỂN CHÊNH LỆCH
// ============================================================================
/** Danh mục các mục có thể kết chuyển chênh lệch tồn kho vào — dùng chung server/client cho đồng bộ. */
var TON_KHO_KET_CHUYEN_OPTIONS = ['Giá vốn hàng bán', 'Hao hụt vận hành', 'Chi phí khác', 'Không ghi nhận (chỉ lưu lại để theo dõi)'];

/** Lưu 1 dòng kiểm kê thực tế (Tồn cuối kỳ thực tế) cho 1 (Cửa hàng, SKU, Tháng). */
function saveTonKhoDoiSoat(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền kiểm kê tồn kho cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Thang;
    var result = upsertRowByKey_(SHEET_NAMES.TON_KHO_DOI_SOAT, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_TON_KHO_DOI_SOAT', rowObj.Key_Id, 'TonCuoiThucTe=' + rowObj.TonCuoiThucTe);
    return result;
  });
}

/** Lưu kết chuyển chênh lệch tồn kho vào 1 mục chi phí — ghi đè nếu SKU/tháng này đã kết chuyển trước đó. */
function saveTonKhoKetChuyen(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (account.role !== 'Admin') {
      var allowed = String(account.stores || '').split(',').map(function (s) { return s.trim(); });
      if (allowed.indexOf(rowObj.Store) === -1) return fail_('Bạn không có quyền kết chuyển tồn kho cửa hàng này.');
    }
    if (!rowObj.Key_Id) rowObj.Key_Id = rowObj.Store + '|' + rowObj.ItemCode + '|' + rowObj.Thang;
    rowObj.NguoiXuLy = account.username;
    var result = upsertRowByKey_(SHEET_NAMES.TON_KHO_KET_CHUYEN, 'Key_Id', rowObj);
    if (result.success) {
      logAudit_(account.username, 'KET_CHUYEN_CHENH_LECH_TON_KHO', rowObj.Key_Id,
        'SL=' + rowObj.SoLuongChenhLech + ' GiaTri=' + rowObj.GiaTriChenhLech + ' Vao=' + rowObj.KetChuyenVaoMuc);
      bumpDataVersion_();
    }
    return result;
  });
}

function deleteTonKhoKetChuyen(token, keyId) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var result = deleteRowByKey_(SHEET_NAMES.TON_KHO_KET_CHUYEN, 'Key_Id', keyId);
    if (result.success) { logAudit_(account.username, 'XOA_KET_CHUYEN_TON_KHO', keyId, ''); bumpDataVersion_(); }
    return result;
  });
}

// ============================================================================
// HÀM BỔ SUNG — giao diện đang gọi nhưng trước đây chưa có trong các file .gs
// ============================================================================
/** Xoá toàn bộ hoá đơn Data_Doc của 1 (Cửa hàng, Ngày) — dùng khi bấm ô ngày trên lịch độ phủ dữ liệu. */
function deleteDocByStoreAndDate(token, store, ngay) {
  return deleteDataDocByStoreDays(token, JSON.stringify([{ store: store, ngay: ngay }]));
}

/** Xoá giá vốn ghi đè của 1 SKU (quay lại tính tự động theo dấu +) — chỉ Admin. */
function deleteGiaVonSKU(token, itemCode) {
  return safeRun_(function () {
    var guard = requireAdmin_(token);
    if (!guard.ok) return guard.resp;
    var result = deleteRowByKey_(SHEET_NAMES.GIA_VON_SKU, 'ItemCode', itemCode);
    if (result.success) {
      logAudit_(guard.account.username, 'XOA_GIA_VON_SKU', itemCode, '');
      invalidateMasterCache_();
      bumpDataVersion_();
    }
    return result;
  });
}

// ============================================================================
// V56 — KPI TRƯỞNG PHÒNG KINH DOANH (chỉ tài khoản vip)
// ============================================================================
/** Chỉ tài khoản "vip" mới được xem/lưu KPI Trưởng phòng KD (admin thường KHÔNG vào được). */
function isVipAccount_(account) {
  return !!account && String(account.username || '').trim().toLowerCase() === 'vip';
}

/** Lưu lỗi vi phạm / % ngày công / hệ số tháng đặc biệt của Trưởng phòng KD theo tháng — chỉ "vip". */
function saveKpiTruongPhong(token, rowObj) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!isVipAccount_(account)) return fail_('Chỉ tài khoản vip mới có quyền lưu KPI Trưởng phòng Kinh doanh.');
    if (!rowObj || !/^\d{4}-\d{2}$/.test(String(rowObj.Thang || ''))) return fail_('Thiếu hoặc sai định dạng tháng (yyyy-MM).');
    rowObj.Key_Id = 'TPKD|' + rowObj.Thang;
    rowObj.NguoiLuu = account.username;
    var result = upsertRowByKey_(SHEET_NAMES.KPI_TRUONG_PHONG, 'Key_Id', rowObj);
    if (result.success) logAudit_(account.username, 'LUU_KPI_TRUONG_PHONG', rowObj.Key_Id, 'ViPham=' + rowObj.ViPham + ' NgayCong=' + rowObj.NgayCongPct + ' HeSo=' + rowObj.HeSoThangDacBiet);
    return result;
  });
}
// ============================================================================
// BẢN VÁ V71 (Code.gs) — GHI LỢI NHUẬN NGÀY LÊN GOOGLE SHEET:
//   1 SHEET DUY NHẤT, bố cục như file Excel, định dạng chuyên nghiệp.
// CÁCH DÁN: dán NGUYÊN KHỐI này xuống CUỐI file Code.gs (sau hàm cuối cùng). Không sửa hàm nào khác.
// Hàm cũ writeLoiNhuanNgaySheetsToGoogleSheet vẫn giữ nguyên (không còn được giao diện gọi).
// ============================================================================
function writeLoiNhuanNgayStyledToGoogleSheet(token, sheetUrl, payload) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    if (!sheetUrl || !payload || !payload.header || !payload.rows) return fail_('Thiếu link Google Sheet hoặc dữ liệu để ghi.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return fail_('Hệ thống đang bận, vui lòng thử lại.');
    try {
      var ss;
      try { ss = SpreadsheetApp.openByUrl(sheetUrl); }
      catch (e) { return fail_('Không mở được Google Sheet — kiểm tra lại link và đảm bảo tài khoản chạy script có quyền chỉnh sửa file đó.'); }
      var sh = v71WriteLnnSheet_(ss, payload);
      SpreadsheetApp.flush();
      logAudit_(account.username, 'GHI_LOINHUANNGAY_GOOGLE_SHEET', sheetUrl, payload.rows.length + ' dòng · 1 sheet (định dạng chuyên nghiệp)');
      return ok_({ written: 1, rows: payload.rows.length, url: ss.getUrl() + '#gid=' + sh.getSheetId() });
    } finally {
      lock.releaseLock();
    }
  });
}

/** Dựng 1 sheet báo cáo Lợi Nhuận Ngày: tiêu đề · dải nhóm cột · tiêu đề cột · dữ liệu (xen kẽ màu theo cửa hàng) · dòng TỔNG · ghi chú. */
function v71WriteLnnSheet_(ss, p) {
  var NC = p.header.length, N = p.rows.length;
  var HDR = 4, FIRST = 5, TOT = FIRST + N, NOTE = TOT + 2, LAST = NOTE;
  var GREEN = '#146c43', DARK = '#0a2a1c', INK = '#1f2d26', MUTED = '#5b6b62', LINE = '#dfe7e2';
  var SOLID = SpreadsheetApp.BorderStyle.SOLID, MED = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  var name = String(p.sheetName || 'Lợi Nhuận Ngày').replace(/[\[\]\*\?\/\\:]/g, ' ').substring(0, 95).trim() || 'Lợi Nhuận Ngày';

  /* ---- 1) Lấy / làm sạch sheet ---- */
  var sh = ss.getSheetByName(name);
  if (sh) {
    var oldFilter = sh.getFilter(); if (oldFilter) oldFilter.remove();
    sh.getBandings().forEach(function (b) { b.remove(); });
    sh.setConditionalFormatRules([]);
    sh.setFrozenRows(0); sh.setFrozenColumns(0);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.clear();
  } else {
    sh = ss.insertSheet(name);
  }
  if (sh.getMaxRows() < LAST + 1) sh.insertRowsAfter(sh.getMaxRows(), LAST + 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < NC) sh.insertColumnsAfter(sh.getMaxColumns(), NC - sh.getMaxColumns());
  if (sh.getMaxRows() > LAST + 1) sh.deleteRows(LAST + 2, sh.getMaxRows() - LAST - 1);
  if (sh.getMaxColumns() > NC) sh.deleteColumns(NC + 1, sh.getMaxColumns() - NC);

  /* ---- 2) Chuẩn hoá dữ liệu (ngày yyyy-MM-dd -> Date thật để lọc/sắp xếp đúng) ---- */
  function toDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : s;
  }
  function pad(row) { var o = []; for (var c = 0; c < NC; c++) o.push(row && row[c] !== undefined && row[c] !== null ? row[c] : ''); return o; }
  var values = p.rows.map(function (r) { var o = pad(r); o[1] = toDate(o[1]); return o; });
  var totalRow = pad(p.total);
  var intCols = p.intCols || [], isInt = {}; intCols.forEach(function (c) { isInt[c] = true; });
  var profitCol = p.profitCol || 0, boldCols = p.boldCols || [];
  var MONEY = '#,##0;[Red]-#,##0;"–"', MONEY_TOT = '#,##0;-#,##0;"–"';

  /* ---- 3) Nền chung: font, cỡ chữ ---- */
  sh.getRange(1, 1, LAST, NC).setFontFamily('Roboto').setFontSize(10).setFontColor(INK).setVerticalAlignment('middle');

  /* ---- 4) Tiêu đề + dòng phụ ---- */
  // V72: KHÔNG gộp ô qua ranh giới cột cố định (cột 2|3) — Google Sheets báo lỗi "không thể cố định cột chỉ chứa một phần của ô hợp nhất".
  // Dòng tiêu đề/phụ: tô nền cả hàng, chữ để ở ô A tràn sang phải (các ô bên cạnh để trống nên chữ hiện đủ).
  sh.getRange(1, 1, 1, NC).setBackground(DARK);
  sh.getRange(1, 1).setValue(p.title || 'BÁO CÁO LỢI NHUẬN NGÀY')
    .setFontColor('#ffffff').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('left').setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  sh.getRange(2, 1, 1, NC).setBackground('#e8f3ec');
  sh.getRange(2, 1).setValue(p.subtitle || '')
    .setFontColor('#35594a').setFontSize(10).setFontStyle('italic').setHorizontalAlignment('left').setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);

  /* ---- 5) Dải nhóm cột + tiêu đề cột (tô màu theo nhóm) ---- */
  sh.getRange(HDR, 1, 1, NC).setValues([pad(p.header)])
    .setFontWeight('bold').setFontSize(9.5).setFontColor(DARK).setHorizontalAlignment('center')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP).setBackground('#e8f3ec');
  (p.groups || []).forEach(function (g) {
    var from = Math.max(1, g.from), to = Math.min(NC, g.to);
    if (to < from) return;
    var gr = sh.getRange(3, from, 1, to - from + 1);
    if (from <= 2 && to > 2) {            // V72: nhóm vắt qua ranh giới cột cố định → tách thành 2 ô gộp
      if (2 > from) sh.getRange(3, from, 1, 2 - from + 1).merge();
      if (to > 3) sh.getRange(3, 3, 1, to - 2).merge();
    } else if (to > from) gr.merge();
    gr.setValue(g.label).setBackground(g.bg).setFontColor('#ffffff').setFontWeight('bold').setFontSize(9.5).setHorizontalAlignment('center');
    gr.setBorder(true, true, true, true, false, false, '#ffffff', MED);
    sh.getRange(HDR, from, 1, to - from + 1).setBackground(g.tint || '#e8f3ec');
  });
  sh.getRange(HDR, 1, 1, NC).setBorder(null, null, true, null, null, null, GREEN, MED);
  sh.getRange(HDR, 1, 1, NC).setBorder(null, null, null, null, true, null, '#ffffff', SOLID);

  /* ---- 6) Dữ liệu ---- */
  if (N > 0) {
    sh.getRange(FIRST, 1, N, 1).setNumberFormat('@');           // tên cửa hàng: luôn là chữ
    sh.getRange(FIRST, 3, N, 1).setNumberFormat('@');           // ghi nhận: chặn "=", "+", "-" bị hiểu thành công thức
    sh.getRange(FIRST, 1, N, NC).setValues(values);
    sh.getRange(FIRST, 2, N, 1).setNumberFormat('dd/MM/yyyy').setHorizontalAlignment('center');
    for (var c = 4; c <= NC; c++) {
      sh.getRange(FIRST, c, N, 1).setNumberFormat(isInt[c] ? '#,##0;-#,##0;"–"' : MONEY).setHorizontalAlignment('right');
    }
    // màu nền xen kẽ theo từng cửa hàng + màu chữ Lợi nhuận theo dấu
    var bg = [], fc = [], prev = null, k = -1, starts = [];
    values.forEach(function (r, i) {
      if (r[0] !== prev) { k++; prev = r[0]; starts.push(FIRST + i); }
      var b = (k % 2 === 0) ? '#ffffff' : '#f1f7f3', rb = [], rf = [];
      for (var cc = 0; cc < NC; cc++) {
        rb.push(b);
        var col = INK;
        if (profitCol && cc === profitCol - 1) { var v = Number(r[cc]); col = v > 0 ? GREEN : (v < 0 ? '#c62828' : MUTED); }
        rf.push(col);
      }
      bg.push(rb); fc.push(rf);
    });
    var dr = sh.getRange(FIRST, 1, N, NC);
    dr.setBackgrounds(bg).setFontColors(fc);
    dr.setBorder(null, null, true, null, null, true, LINE, SOLID);
    sh.getRange(FIRST, 1, N, 1).setFontWeight('bold').setFontColor(DARK).setHorizontalAlignment('left');
    sh.getRange(FIRST, 3, N, 1).setHorizontalAlignment('left').setFontSize(9).setFontColor(MUTED)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    boldCols.forEach(function (bc) { if (bc >= 1 && bc <= NC) sh.getRange(FIRST, bc, N, 1).setFontWeight('bold'); });
    starts.slice(1).forEach(function (rw) { sh.getRange(rw, 1, 1, NC).setBorder(true, null, null, null, null, null, GREEN, MED); });
  }

  /* ---- 7) Dòng TỔNG ---- */
  var tr = sh.getRange(TOT, 1, 1, NC);
  sh.getRange(TOT, 1, 1, 1).setNumberFormat('@');
  tr.setValues([totalRow]);
  for (var tc = 4; tc <= NC; tc++) sh.getRange(TOT, tc, 1, 1).setNumberFormat(MONEY_TOT).setHorizontalAlignment('right');
  tr.setBackground(DARK).setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  if (profitCol) {
    var tv = Number(totalRow[profitCol - 1]);
    sh.getRange(TOT, profitCol, 1, 1).setFontColor(tv < 0 ? '#ff9e9e' : '#7dffb2');
  }
  sh.getRange(TOT, 1, 1, 2).merge().setHorizontalAlignment('left');   // V72: chỉ gộp cột 1-2 (không vắt qua cột cố định)

  /* ---- 8) Ghi chú cuối bảng ---- */
  if (p.note) {
    sh.getRange(NOTE, 1).setValue('Ghi chú:').setFontSize(9).setFontStyle('italic').setFontColor(MUTED).setVerticalAlignment('top');
    sh.getRange(NOTE, 3, 1, Math.max(1, NC - 2)).merge().setValue(p.note).setFontSize(9).setFontStyle('italic').setFontColor(MUTED)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP).setVerticalAlignment('top').setHorizontalAlignment('left');
    sh.setRowHeight(NOTE, 40);
  }

  /* ---- 9) Kích thước, cố định hàng/cột, bộ lọc, tab ---- */
  var widths = p.widths || [];
  for (var w = 0; w < NC; w++) sh.setColumnWidth(w + 1, widths[w] || 105);
  sh.setRowHeight(1, 40); sh.setRowHeight(2, 24); sh.setRowHeight(3, 24); sh.setRowHeight(HDR, 48); sh.setRowHeight(TOT, 30);
  sh.setFrozenRows(HDR);
  sh.setFrozenColumns(2);
  if (N > 0) sh.getRange(HDR, 1, N + 1, NC).createFilter();
  sh.setHiddenGridlines(true);
  sh.setTabColor(GREEN);
  ss.setActiveSheet(sh);
  return sh;
}
/** V75 — Danh sách người phụ trách (tài khoản QLCH) theo từng cửa hàng, để hiện ở bảng "Việc cần làm" của Kết Ca. Mọi tài khoản đăng nhập đều gọi được; KHÔNG trả mật khẩu. */
function getStoreManagers(token) {
  return safeRun_(function () {
    var account = getAccountByToken_(token);
    if (!account) return fail_('Phiên đăng nhập đã hết hạn.');
    var map = {};
    readSheetAsObjects_(SHEET_NAMES.USERS).forEach(function (u) {
      if (String(u.Role || '').toLowerCase() === 'admin') return;
      String(u.Stores || '').split(',').forEach(function (s) {
        s = String(s).trim();
        if (!s) return;
        (map[s] = map[s] || []).push(String(u.Username));
      });
    });
    return ok_(map);
  });
}
