# 9 Sạch — Tủ bánh 3D: Hướng dẫn từ A đến Z

Website gồm 2 phần cuộn, giống phong cách video "Websites in 2026":

1. **Hero (0–40% cuộn):** tủ đông SANAKY-VH-768K dựng bằng Three.js, bánh xếp trên 4 tầng kệ theo tồn kho.
2. **Chuyển cảnh + vòng tròn (40–100%):** cửa kính mở, bánh bay ra xếp thành vòng tròn 3D nghiêng; vuốt/cuộn/mũi tên để xoay, tự khớp vào bánh gần nhất; nền đổi màu theo bánh; tên bánh khổng lồ phía sau; nút **Đặt Ngay** mở form gửi đơn về Google Sheets.

---

## 1. Cấu trúc thư mục

```
tu-banh-3d/
├─ index.html          Bố cục, CSS, nạp GSAP/Lenis/Three.js từ CDN
├─ vercel.json         Cấu hình Vercel (không cần build)
├─ gas_code.gs         Code Google Apps Script (dán vào Google Sheets)
├─ data/products.json  Dữ liệu bánh mẫu (dự phòng khi chưa nối Sheets)
├─ images/             (tuỳ chọn) ảnh bánh PNG tách nền, file HDR studio
└─ src/
   ├─ config.js        TẤT CẢ tham số tinh chỉnh
   ├─ main.js          Lenis, GSAP Timeline + ScrollTrigger, kéo/vuốt, snap, vòng lặp render
   ├─ scene.js         Renderer, ánh sáng HDRI studio, camera, responsive, parallax/gyro
   ├─ fridge.js        Dựng tủ đông, kệ, sương, xếp bánh lên kệ theo tồn kho
   ├─ cake.js          Dựng mô hình bánh bằng hình học (5 kiểu) hoặc ảnh PNG
   ├─ carousel.js      Vòng tròn 3D, quán tính, độ sâu, bóng tiếp xúc
   ├─ data.js          Đọc Google Sheets / JSON, gửi đơn
   ├─ ui.js            Nhãn tầng, tên khổng lồ, nền gradient, modal đặt hàng, fallback 2D
   └─ utils.js         Hàm dùng chung (clamp, lerp, texture canvas...)
```

Không cần cài Node hay build. Trang chạy trực tiếp dưới dạng file tĩnh.

---

## 2. Chạy thử trên máy (bắt buộc làm trước khi đưa lên mạng)

Trang dùng ES Modules nên **không mở bằng cách nhấp đúp `index.html`** (địa chỉ `file://` sẽ trắng trang). Chọn một cách:

- **VS Code:** cài tiện ích *Live Server* → chuột phải `index.html` → *Open with Live Server*.
- **Python:** mở Terminal trong thư mục dự án, chạy `python3 -m http.server 8000`, rồi vào `http://localhost:8000`.
- **Node:** `npx serve .`

Cần Internet (thư viện tải từ CDN jsdelivr, font từ Google Fonts).

Khi chưa nối Google Sheets, trang dùng `data/products.json` và đặt hàng chạy ở **chế độ thử nghiệm** (hiện mã đơn DEMO, không gửi đi đâu).

---

## 3. Cấu hình Google Sheets + Apps Script

1. Vào <https://sheets.google.com> → tạo **bảng tính trống** → đặt tên "9 Sạch - Tủ bánh".
2. Menu **Tiện ích mở rộng → Apps Script**.
3. Xoá code mặc định, **dán toàn bộ `gas_code.gs`** → bấm biểu tượng đĩa để lưu.
4. Chọn hàm **`setup`** ở thanh trên → bấm **Chạy** → bấm *Xem lại quyền* → chọn tài khoản → *Nâng cao → Đi tới (không an toàn)* → *Cho phép*. (Google hiện cảnh báo vì script do chính bạn viết; đây là bình thường.)
5. Quay lại bảng tính: sẽ có 2 sheet:
   - **SanPham** — danh sách bánh (sửa trực tiếp ở đây).
   - **DonHang** — đơn khách đặt (tự thêm dòng mới).
6. Bấm **Triển khai → Tùy chọn triển khai mới → biểu tượng bánh răng → Ứng dụng web**:
   - *Thực thi với tư cách:* **Tôi**
   - *Ai có quyền truy cập:* **Bất kỳ ai**
   - Bấm **Triển khai**, cho phép quyền nếu được hỏi.
7. Sao chép **URL ứng dụng web** (kết thúc bằng `/exec`).
8. Mở `src/config.js`, dán vào: `gasUrl: 'https://script.google.com/macros/s/XXXX/exec',`
9. Kiểm tra: dán URL kèm `?action=products` vào trình duyệt → phải thấy JSON danh sách bánh.

> **Mỗi lần sửa `gas_code.gs`** phải bấm *Triển khai → Quản lý triển khai → biểu tượng bút chì → Phiên bản: Phiên bản mới → Triển khai*. Nếu không, URL vẫn chạy code cũ.

### Các cột của sheet SanPham

| Cột | Ý nghĩa | Ví dụ |
|---|---|---|
| id | Mã duy nhất, không trùng | sp1 |
| name | Tên bánh (hiện chữ khổng lồ) | Bông Lan Trứng Muối |
| price | Giá (số, đồng) | 35000 |
| desc | Mô tả 1 dòng | Mềm xốp, sốt trứng muối |
| stock | Tồn kho. **0 = Hết hàng**, **≤5 = nhãn vàng**, **>5 = hiện huy hiệu ×N** | 12 |
| color | Màu chủ đạo (đổi nền + màu bánh), dạng `#rrggbb` | #f2c14e |
| type | Kiểu bánh 3D: `round` `cupcake` `roll` `bread` `donut` | roll |
| image | (tuỳ chọn) đường dẫn ảnh PNG tách nền, ví dụ `images/tiramisu.png` | |
| active | `TRUE` hiện, `FALSE` ẩn | TRUE |

Sửa tồn kho trong Sheet → trang tự cập nhật sau tối đa 60 giây (đổi bằng `refreshMs`). Khi có đơn, script tự trừ tồn kho (tắt bằng `AUTO_DECREMENT_STOCK = false`). Giá luôn lấy từ Sheet, khách không sửa được giá.

---

## 4. Đưa mã lên GitHub

**Cách dễ (không cần cài Git):**
1. Vào <https://github.com> → đăng nhập → **New repository** → tên `tu-banh-3d` → *Public* hoặc *Private* → **Create repository**.
2. Ở trang repo trống, bấm **uploading an existing file**.
3. **Kéo cả nội dung thư mục** `tu-banh-3d` (gồm `index.html`, `src`, `data`, `images`, `vercel.json`, `package.json`, `gas_code.gs`...) vào khung.
4. Kéo xuống bấm **Commit changes**.

> Thư mục `images` đang rỗng sẽ không được GitHub nhận; khi cần ảnh thì thêm file vào sau.

**Cách dùng Git (nếu đã cài):**
```bash
cd tu-banh-3d
git init
git add .
git commit -m "Tủ bánh 3D 9 Sạch"
git branch -M main
git remote add origin https://github.com/TEN_BAN/tu-banh-3d.git
git push -u origin main
```

---

## 5. Triển khai lên Vercel

1. Vào <https://vercel.com> → **Sign up with GitHub**.
2. **Add New… → Project** → chọn repo `tu-banh-3d` → **Import**.
3. Cấu hình:
   - *Framework Preset:* **Other**
   - *Build Command:* để trống
   - *Output Directory:* để trống
4. Bấm **Deploy**. Sau ~30 giây có địa chỉ dạng `tu-banh-3d.vercel.app`.
5. Gắn tên miền riêng: **Settings → Domains → Add**, làm theo hướng dẫn DNS.
6. **Cập nhật về sau:** sửa file trên GitHub (hoặc `git push`) → Vercel tự triển khai lại. Sửa dữ liệu bánh chỉ cần sửa Google Sheet, không cần đụng code.

---

## 6. Bảng tham số tinh chỉnh nhanh (`src/config.js`)

| Muốn chỉnh | Tham số | Mặc định | Ghi chú |
|---|---|---|---|
| **Bán kính vòng tròn** | `carousel.radius` | 4.2 | Lớn = bánh cách xa nhau hơn |
| Bán kính trên điện thoại | `carousel.radiusMobile` | 2.3 | |
| Giới hạn bán kính theo tỉ lệ màn hình | `radiusMin` / `radiusMax` | 3.0 / 5.2 | Dùng `clamp()` |
| **Độ nghiêng vòng tròn** | `carousel.tilt` | 0.26 | 0 = phẳng; 0.5 = nghiêng nhiều |
| **Tốc độ tự xoay bánh giữa** | `carousel.autoSpin` | 0.9 | rad/giây, 0 = đứng yên |
| **Quán tính xoay vòng** | `carousel.follow` | 7 | Nhỏ = trôi lâu, lớn = bám sát |
| Quán tính khi thả tay | `carousel.inertiaMs` | 420 | |
| Độ nhạy kéo ngang | `carousel.dragWidth` | 0.28 | Nhỏ = nhạy hơn |
| Thời gian chờ trước khi tự khớp | `carousel.snapIdleMs` | 140 | ms |
| Kích thước bánh giữa / xa | `centerScale` / `farScale` | 1.45 / 0.72 | |
| **Độ mờ bánh ở xa** | `carousel.fogNear` / `fogFar` | 0.2 / 2.4 | Giảm `fogFar` = mờ nhiều hơn |
| Vị trí bánh giữa trên màn hình | `carousel.lookDy` | -0.55 | Âm = bánh nằm cao hơn |
| Khoảng cách camera | `camDist` / `camDistMobile` | 5.8 / 7.4 | |
| **Cường độ ánh sáng môi trường (HDRI)** | `lights.env` | 1.0 | |
| **Đèn chính** | `lights.keyIntensity` / `keyColor` / `keyPos` | 2.4 / kem ấm / [3,5,4] | |
| Đèn phụ | `lights.fillIntensity` | 0.8 | |
| Độ sáng tổng | `lights.exposure` | 1.05 | |
| HDR studio thật | `lights.hdrUrl` | '' | Ví dụ `./images/studio.hdr` |
| **Đèn LED lạnh trong tủ** | `fridge.ledIntensity` / `ledColor` | 7 / #d8ecff | |
| **Độ đậm sương đáy tủ** | `fridge.mist` | 1.0 | 0 = tắt |
| Kích thước bánh trên kệ | `fridge.shelfScale` | 0.36 | |
| Tủ chiếm bao nhiêu % màn hình | `hero.fridgeFill` / `fridgeFillMobile` | 0.74 / 0.70 | |
| Độ xoay tủ theo chuột/gyro | `hero.parallaxY` / `parallaxX` | 0.45 / 0.12 | 0 = tắt |
| Góc mở cửa | `hero.doorAngle` | 1.75 | radian |
| **Độ dài cuộn tổng** | `scroll.lengthVh` | 900 | Tăng = chuyển cảnh chậm hơn |
| Mốc mở cửa / bay / camera / tủ lùi / xoay | `timeline.*` | xem file | Số 0–1 trên toàn đoạn cuộn |
| **DPR tối đa** | `render.maxDpr` / `maxDprMobile` | 2 / 1.75 | Giảm nếu máy yếu |
| Ngưỡng FPS tự giảm DPR | `render.targetFps` | 30 | |
| URL Google Sheets | `gasUrl` | '' | |

---

## 7. Cách trang hoạt động (để tự tuỳ biến)

- **Một khung cảnh Three.js duy nhất**, canvas được **ghim** (`ScrollTrigger pin`) suốt đoạn cuộn.
- **GSAP Timeline** biến thanh cuộn thành 6 con số `P.hero / door / fly / cam / out / spin` (0→1). Mọi thứ (cửa mở, bánh bay, camera, xoay vòng) chỉ là hàm của các số này, nên cuộn ngược lại cũng chạy ngược mượt.
- **Lenis** làm cuộn mượt; `scrollTo` của Lenis được dùng cho mũi tên, chấm tròn, kéo ngang và snap, nên **vị trí cuộn là nguồn sự thật duy nhất** (không bị lệch giữa kéo và cuộn).
- **Vòng tròn:** bánh i có góc `(i − current) × 2π/N`; vị trí `(sin·R, −cos·R·sin(tilt), cos·R·cos(tilt))`. `current` đuổi theo `target` bằng `damp()` tạo quán tính.
- **Độ sâu trường ảnh giả:** bánh xa nhỏ hơn và bị `fog` trộn vào màu nền. Màu sương luôn bằng màu nền đang đổi nên bánh xa "tan" vào nền.
- **Tên bánh khổng lồ** là chữ HTML nằm **sau** canvas trong suốt, nên bánh 3D che lên chữ, tạo chiều sâu như video.
- **Không có WebGL:** tự chuyển sang giao diện 2D (thẻ vuốt ngang, vẫn đổi màu nền và đặt hàng được).
- **Hiệu năng:** DPR tự giảm 0.25 mỗi lần nếu FPS dưới 34 và tự tăng lại khi máy rảnh.

---

## 8. Dùng ảnh bánh thật thay cho mô hình thủ tục

1. Chụp/tạo ảnh bánh **PNG nền trong suốt** (vuông, khoảng 800×800).
2. Đặt vào thư mục `images/`, ví dụ `images/tiramisu.png`.
3. Trong Sheet, cột `image` ghi `images/tiramisu.png`.
4. Ảnh sẽ thay mô hình 3D (hiện dạng tấm phẳng lắc nhẹ).

Ảnh nên nằm cùng tên miền với trang (trong repo) để WebGL được phép đọc. Ảnh từ Google Drive thường bị chặn.

Muốn bánh 3D thật (.glb): dùng `GLTFLoader` (`three/addons/loaders/GLTFLoader.js`) trong `cake.js`, thay hàm `makeProduct` để trả về nhóm có `userData.hh` và thuộc tính `.spin` như bản hiện tại.

---

## 9. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Trang trắng, tiêu đề đứng yên | Mở bằng `file://`. Dùng Live Server hoặc `python3 -m http.server`. |
| Kẹt ở "Đang mở tủ bánh…" | Mở F12 → Console xem lỗi. Thường do mất mạng (CDN) hoặc `data/products.json` sai cú pháp. |
| Dữ liệu vẫn là bánh mẫu | `gasUrl` sai/chưa triển khai bản mới. Thử mở `URL?action=products`. |
| Đặt hàng báo lỗi | Kiểm tra *Ai có quyền truy cập = Bất kỳ ai* và đã triển khai phiên bản mới. |
| Sheet không thấy đơn | Kiểm tra tên sheet đúng `SanPham` và `DonHang`; chạy lại `setup()`. |
| Giật trên máy yếu | Giảm `render.maxDpr` (1.25), `fridge.mist` (0), tắt `antialias`. |
| Tủ/bánh quá to hoặc nhỏ | Chỉnh `hero.fridgeFill`, `carousel.camDist`, `centerScale`. |
| iPhone không xoay theo con quay | iOS hỏi quyền ở lần chạm đầu tiên; cần chấp nhận. |
| Ảnh PNG không hiện | Ảnh phải cùng tên miền (để trong `images/`), kiểm tra đường dẫn. |

---

## 10. Lưu ý trước khi chạy thật

- Đơn hàng chỉ lưu vào Sheet; bạn cần theo dõi sheet **DonHang** (có thể bật *Công cụ → Quy tắc thông báo* để nhận email khi có dòng mới).
- Biểu mẫu có ô bẫy chống bot và kiểm tra số điện thoại, nhưng chưa có CAPTCHA. Nếu bị spam, hãy thêm hạn chế theo thời gian hoặc dùng Google reCAPTCHA.
- Kiểm tra lại giá và tồn kho trong Sheet trước khi bán; tồn kho chỉ chính xác khi mọi đơn đều đi qua trang này.
