/**
 * config.js — TOÀN BỘ THAM SỐ TINH CHỈNH NHANH nằm ở đây.
 * Sửa số rồi lưu + tải lại trang là thấy ngay.
 */
export const CONFIG = {
  /* ===== DỮ LIỆU ===== */
  // Dán URL Web App của Google Apps Script (kết thúc bằng /exec). Để trống = dùng data/products.json + đặt hàng DEMO.
  gasUrl: '',
  localJson: './data/products.json',
  refreshMs: 60000, // tự cập nhật tồn kho mỗi 60 giây

  /* ===== THƯƠNG HIỆU ===== */
  brand: { green: '#1f5a3a', gold: '#e0a82e', cream: '#f6efdf', cream2: '#efe3c6' },

  /* ===== CUỘN TRANG ===== */
  scroll: {
    lengthVh: 900, // tổng chiều dài cuộn (đơn vị % chiều cao màn hình). Tăng = cuộn chậm/mượt hơn
  },

  /* ===== MỐC THỜI GIAN CỦA TIMELINE (0 → 1 = toàn bộ đoạn cuộn) =====
     Phần 1 (Hero): 0 → 0.40. Phần 2: 0.40 → 1.00 */
  timeline: {
    doorStart: 0.40, doorEnd: 0.50, // mở cửa kính
    flyStart: 0.44, flyEnd: 0.64,   // bánh bay ra khỏi tủ vào vòng tròn
    camStart: 0.50, camEnd: 0.72,   // camera chuyển từ góc nhìn tủ sang góc nhìn vòng tròn
    outStart: 0.62, outEnd: 0.74,   // tủ lùi ra sau và mờ dần
    spinStart: 0.72, spinEnd: 1.0,  // đoạn cuộn dùng để xoay vòng tròn chọn bánh
  },

  /* ===== HERO / TỦ ĐÔNG ===== */
  hero: {
    fridgeFill: 0.74,        // tủ chiếm bao nhiêu % chiều cao màn hình (desktop)
    fridgeFillMobile: 0.70,  // (mobile) 70% chiều cao
    parallaxY: 0.45,         // độ xoay ngang của tủ theo chuột / con quay (radian)
    parallaxX: 0.12,         // độ nghiêng dọc
    parallaxSmooth: 6,       // độ mượt (lớn = bám nhanh)
    dolly: 0.25,             // camera tiến nhẹ vào khi cuộn trong hero
    doorAngle: 1.75,         // góc mở cửa (radian)
  },
  fridge: {
    shelfScale: 0.36,        // kích thước bánh trên kệ
    ledColor: '#d8ecff',
    ledIntensity: 7,         // độ sáng đèn LED trong tủ
    mist: 1.0,               // độ đậm lớp sương đáy tủ (0 = tắt)
  },

  /* ===== VÒNG TRÒN BÁNH ===== */
  carousel: {
    radius: 4.2,             // BÁN KÍNH vòng tròn (desktop)
    radiusMobile: 2.3,       // bán kính trên điện thoại
    radiusMin: 3.0, radiusMax: 5.2, // kẹp bán kính theo tỉ lệ khung hình
    tilt: 0.26,              // độ NGHIÊNG vòng tròn (radian)
    centerScale: 1.45,       // kích thước bánh ở giữa
    farScale: 0.72,          // kích thước bánh ở xa
    mobileScaleMul: 0.8,
    follow: 7,               // QUÁN TÍNH: nhỏ = trôi lâu, lớn = bám sát
    autoSpin: 0.9,           // TỐC ĐỘ xoay nhẹ của bánh ở giữa (rad/giây)
    itemTilt: 0.35,          // nghiêng bánh về phía camera
    stagger: 0.45,           // độ lệch thời gian giữa các bánh khi bay ra
    arc: 1.2,                // độ vòng cung khi bay
    bob: 0.05,               // biên độ nhấp nhô
    camDist: 5.8, camDistMobile: 7.4, // khoảng cách camera tới bánh giữa
    camUp: 1.3,              // camera cao hơn bánh giữa
    lookDy: -0.55,           // dịch bánh giữa lên/xuống trên màn hình
    fogNear: 0.2, fogFar: 2.4, // "ĐỘ SÂU TRƯỜNG ẢNH" giả: bắt đầu/kết thúc mờ (nhân với bán kính)
    dragWidth: 0.28,         // kéo ngang bao nhiêu % bề rộng màn hình = 1 bánh
    inertiaMs: 420,          // quán tính khi thả tay
    snapIdleMs: 140,         // đứng yên bao lâu thì tự khớp vào bánh gần nhất
  },

  /* ===== CAMERA ===== */
  camera: { fov: 35, fovMin: 28, fovMax: 60, refAspect: 1.6 },

  /* ===== ÁNH SÁNG ===== */
  lights: {
    exposure: 1.05,
    env: 1.0,                // cường độ HDRI studio (RoomEnvironment)
    hdrUrl: '',              // (tuỳ chọn) đường dẫn file .hdr studio thật, ví dụ './images/studio.hdr'
    keyIntensity: 2.4, keyColor: '#fff3dc', keyPos: [3, 5, 4],
    fillIntensity: 0.8, fillColor: '#cfe6ff', fillPos: [-4, 2, 3],
    hemiIntensity: 0.6,
  },

  /* ===== HIỆU NĂNG ===== */
  render: {
    maxDpr: 2, maxDprMobile: 1.75, minDpr: 1,
    targetFps: 30,           // dưới mức này tự giảm DPR
    adaptive: true,
    antialias: true,
  },

  order: { maxQty: 20 },
};
