# Hướng dẫn triển khai Phần 1 (anh làm một lần, ~15 phút)

Kết quả: trang Kết ca chạy ở địa chỉ Vercel, đọc/ghi dữ liệu Google Sheets qua Apps Script. Bản Apps Script cũ **không bị xóa**, vẫn là đường lui.

## A. Apps Script (máy chủ)
1. Mở dự án Apps Script của Kết ca → mở `Code.gs`.
2. **Trước khi dán:** xem dòng `var SPREADSHEET_ID = '...'` của bản đang chạy. Nếu có ID thật, **chép lại**. (File anh gửi đang ghi chỗ trống `DIEN_ID_SPREADSHEET_O_DAY` — nếu dự án gắn sẵn vào bảng tính thì để nguyên cũng chạy.)
3. Xóa toàn bộ `Code.gs`, dán toàn bộ `gas/Code.gs` mới → điền lại `SPREADSHEET_ID` nếu cần → Lưu.
4. **Giữ nguyên file `Index.html` trong Apps Script** (đường lui).
5. **Triển khai → Quản lý triển khai → biểu tượng bút chì → Phiên bản: Phiên bản mới.** Kiểm tra: *Thực thi với tư cách: **Tôi***; *Ai có quyền truy cập: **Bất kỳ ai***. → Triển khai.
6. Sao chép **URL ứng dụng web** (kết thúc bằng `/exec`).
7. Kiểm tra: dán `URL/exec?fn=ping` vào trình duyệt → phải thấy `{"success":true,"data":{"build":"20261026a","api":"20261027-api1",...}}`.

## B. GitHub
1. Tạo repo mới (ví dụ `ketca-9sach`), Private hoặc Public.
2. Giải nén bộ dự án, mở `public/js/config.js`, thay `DIEN_URL_EXEC_O_DAY` bằng URL ở bước A.6 (giữ nguyên dấu nháy).
3. Tải toàn bộ nội dung thư mục lên repo (kéo thả) → Commit.

## C. Vercel
1. vercel.com → Add New → Project → chọn repo → Framework Preset **Other** → Deploy. (`vercel.json` đã đặt thư mục `public`.)
2. Mở địa chỉ `xxx.vercel.app` trên điện thoại.

## D. Thử
- Đăng nhập → thấy trang chủ hai ca → mở 1 ca, bán thử, **không bấm Kết ca** → thoát.
- Nếu lỗi: "Phản hồi máy chủ không đúng định dạng" = Web App chưa để "Bất kỳ ai" hoặc chưa phát hành phiên bản mới; "Không có mạng hoặc máy chủ không phản hồi" = sai `apiUrl` hoặc dùng URL `/dev` thay vì `/exec`.

## Quay lại bản cũ
Dùng lại URL Apps Script cũ như trước. Hoặc ở Vercel: Deployments → bản trước → Promote to Production.
