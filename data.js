import { CONFIG } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v, d = 0) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : d;
}

/** Chuẩn hoá 1 dòng sản phẩm (từ Sheets hoặc JSON). */
export function normalize(raw, i) {
  if (!raw) return null;
  const name = String(raw.name || raw.ten || '').trim();
  if (!name) return null;
  const active = raw.active;
  if (active === false || String(active).toUpperCase() === 'FALSE') return null;
  const type = String(raw.type || 'round').trim().toLowerCase();
  return {
    id: String(raw.id || 'sp' + (i + 1)),
    name,
    price: num(raw.price),
    desc: String(raw.desc || raw.mota || '').trim(),
    stock: Math.max(0, Math.floor(num(raw.stock))),
    color: /^#?[0-9a-f]{3,6}$/i.test(String(raw.color || '').trim()) ? '#' + String(raw.color).trim().replace('#', '') : '#e0a82e',
    type: ['round', 'cupcake', 'roll', 'bread', 'donut'].includes(type) ? type : 'round',
    image: String(raw.image || '').trim(),
  };
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ưu tiên Google Sheets (nếu có gasUrl); lỗi thì dùng JSON nội bộ. */
export async function loadProducts() {
  if (CONFIG.gasUrl) {
    try {
      const sep = CONFIG.gasUrl.includes('?') ? '&' : '?';
      const res = await fetchJson(`${CONFIG.gasUrl}${sep}action=products&_=${Date.now()}`);
      const arr = (res.data && res.data.products) || res.products;
      if (Array.isArray(arr) && arr.length) {
        const products = arr.map(normalize).filter(Boolean);
        if (products.length) {
          const t = res.data && res.data.updatedAt ? new Date(res.data.updatedAt) : new Date();
          return { products, updatedAt: t, source: 'sheets' };
        }
      }
    } catch (err) {
      console.warn('[data] Không đọc được Google Sheets, dùng JSON nội bộ:', err);
    }
  }
  const res = await fetchJson(CONFIG.localJson);
  const arr = Array.isArray(res) ? res : res.products || [];
  return { products: arr.map(normalize).filter(Boolean), updatedAt: new Date(), source: 'local' };
}

export function signature(products) {
  return JSON.stringify(products.map((p) => [p.id, p.name, p.price, p.stock, p.color, p.type, p.image, p.desc]));
}

export function startAutoRefresh(cb) {
  setInterval(async () => {
    if (document.hidden) return;
    try {
      cb(await loadProducts());
    } catch (e) {
      /* giữ dữ liệu cũ */
    }
  }, CONFIG.refreshMs);
}

/** Gửi đơn về Google Apps Script. Không có gasUrl → chế độ DEMO. */
export async function submitOrder(order) {
  if (!CONFIG.gasUrl) {
    await sleep(700);
    return { orderId: 'DEMO-' + Date.now().toString(36).toUpperCase(), demo: true };
  }
  // Content-Type text/plain để tránh preflight CORS với Apps Script
  const res = await fetch(CONFIG.gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: 'order' }, order)),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Không gửi được đơn hàng');
  return json.data;
}
