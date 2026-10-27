/* CẤU HÌNH DUY NHẤT CẦN SỬA khi triển khai.
 * Dán URL Web App của Google Apps Script (kết thúc bằng /exec) vào apiUrl.
 * Lấy ở: Apps Script → Triển khai → Quản lý triển khai → Ứng dụng web → URL.
 */
window.NV_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbz5YhEpWfQKmOyhBpi61rtlbTxLuPoglg15mLMZ33mwqcOq23ZAuNe1K-QrlswS_uoaCg/exec',
  timeoutMs: 60000,        // quá thời gian này coi như mất kết nối (tải ảnh được cộng thêm)
  uploadTimeoutMs: 120000, // riêng nvUploadAnh
  warmUp: true             // gọi ping khi mở trang để Apps Script "thức dậy" sớm
};
