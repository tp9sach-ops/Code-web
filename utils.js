import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const isMobile = () => window.innerWidth < 768;

export function hexToRgb(hex) {
  let h = String(hex || '#cccccc').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 204, g: 204, b: 204 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const mixRgb = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
export const rgbCss = (c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
export const formatVnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + 'đ';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Texture tròn mờ dần: dùng cho bóng đổ tiếp xúc và sương. */
export function radialTexture(inner = 'rgba(0,0,0,0.6)', outer = 'rgba(0,0,0,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Huy hiệu số lượng "×12" cho sản phẩm còn nhiều hàng. */
export function badgeTexture(text, bg = '#e0a82e', fg = '#3a2a00') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  roundRect(g, 8, 14, 240, 100, 50);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.fillStyle = fg;
  g.font = '900 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Biển hiệu SANAKY VH-768K ở đầu tủ. */
export function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b0d';
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#e0a82e';
  g.fillRect(40, 128, 944, 5);
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '900 84px "Arial Black", Arial, sans-serif';
  g.textAlign = 'left';
  g.fillText('SANAKY', 44, 70);
  g.fillStyle = '#7fd19a';
  g.font = '700 58px Arial, sans-serif';
  g.textAlign = 'right';
  g.fillText('VH-768K', 980, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
