import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, smoothstep, hexToRgb, mixRgb, rgbCss, formatVnd } from './utils.js';
import { submitOrder } from './data.js';

const gsap = window.gsap;
const $ = (s) => document.querySelector(s);
const root = document.documentElement;

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const CREAM1 = hexToRgb('#fbf6ea');
const CREAM2 = hexToRgb(CONFIG.brand.cream2);

const el = {};
let H = {};
let products = [];
let labels = [];
let dots = [];
let activeIdx = -1;
let blend = 0;
let lastBg = '';
let fogRgb = { r: 246, g: 239, b: 223 };
const theme = { r: 31, g: 90, b: 58 }; // màu chủ đạo hiện tại (tween mượt)
const projV = new THREE.Vector3();

/* ======================= Khởi tạo ======================= */
export function init(handlers) {
  H = handlers || {};
  ['heroTitle', 'heroSub', 'giant', 'giantText', 'labels', 'hint', 'info', 'infoBody', 'infoPrice', 'infoDesc', 'infoStock',
    'btnOrder', 'pager', 'dots', 'barFill', 'prev', 'next', 'loader', 'stage', 'fallback',
    'modal', 'mClose', 'mName', 'mPrice', 'mTotal', 'form', 'mMsg', 'mSubmit', 'qMinus', 'qPlus'].forEach((k) => {
    const id = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    el[k] = document.getElementById(id);
  });
  el.form = document.getElementById('order-form');
  el.qty = el.form.querySelector('input[name="qty"]');

  el.btnOrder.addEventListener('click', () => H.order && H.order());
  el.prev.addEventListener('click', () => H.step && H.step(-1));
  el.next.addEventListener('click', () => H.step && H.step(1));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) return closeOrder();
    if (!el.modal.hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); H.step && H.step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); H.step && H.step(1); }
  });

  el.mClose.addEventListener('click', closeOrder);
  el.modal.addEventListener('pointerdown', (e) => { if (e.target === el.modal) closeOrder(); });
  el.qMinus.addEventListener('click', () => setQty(Number(el.qty.value) - 1));
  el.qPlus.addEventListener('click', () => setQty(Number(el.qty.value) + 1));
  el.form.addEventListener('submit', onSubmit);
}

export function hideLoader() {
  if (!el.loader) return;
  el.loader.classList.add('done');
  setTimeout(() => { el.loader.hidden = true; }, 700);
}

/* ======================= Dữ liệu hiển thị ======================= */
export function setUpdated(d) {
  const t = (d instanceof Date ? d : new Date()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const txt = 'Cập nhật lúc ' + t;
  if (el.heroSub) el.heroSub.textContent = txt;
  const fb = document.getElementById('fb-sub');
  if (fb) fb.textContent = txt;
}

function stockInfo(p) {
  if (p.stock <= 0) return { cls: 'out', text: 'Hết hàng' };
  if (p.stock <= 5) return { cls: 'low', text: 'Chỉ còn ' + p.stock };
  return { cls: 'ok', text: 'Còn ' + p.stock };
}

export function setProducts(list) {
  products = list;
  activeIdx = -1;
  el.dots.innerHTML = '';
  dots = list.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot';
    b.setAttribute('aria-label', p.name);
    b.addEventListener('click', () => H.goTo && H.goTo(i));
    el.dots.appendChild(b);
    return b;
  });
}

/** Tạo nhãn nổi cho từng tầng kệ (tên bánh + số lượng còn lại). */
export function setLabels(items) {
  el.labels.innerHTML = '';
  labels = items.map((it) => {
    const d = document.createElement('div');
    const s = stockInfo(it.product);
    d.className = 'lbl ' + s.cls;
    const n = document.createElement('b');
    n.textContent = it.product.name;
    const c = document.createElement('span');
    c.textContent = s.text;
    d.append(n, c);
    el.labels.appendChild(d);
    return { el: d, anchor: it.labelAnchor, product: it.product, nameEl: n, countEl: c };
  });
}

function refreshLabelTexts() {
  labels.forEach((l) => {
    const s = stockInfo(l.product);
    l.el.className = 'lbl ' + s.cls;
    l.countEl.textContent = s.text;
  });
}

/** Chiếu vị trí 3D của nhãn lên màn hình (gọi SAU khi render). */
export function updateLabels(camera, w, h, vis) {
  el.labels.style.opacity = String(vis);
  el.labels.style.visibility = vis < 0.02 ? 'hidden' : 'visible';
  if (vis < 0.02) return;
  for (const l of labels) {
    l.anchor.getWorldPosition(projV);
    projV.project(camera);
    const x = (projV.x * 0.5 + 0.5) * w;
    const y = (-projV.y * 0.5 + 0.5) * h;
    l.el.style.display = projV.z > 1 ? 'none' : '';
    l.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
  }
}

/* ======================= Nền, chữ khổng lồ, thông tin ======================= */
function applyBackground() {
  const deep = mixRgb(theme, WHITE, 0.35);
  const light = mixRgb(theme, WHITE, 0.78);
  const c1 = mixRgb(CREAM1, light, blend);
  const c2 = mixRgb(CREAM2, deep, blend);
  const css = rgbCss(c1) + rgbCss(c2) + rgbCss(theme);
  fogRgb = mixRgb(c1, c2, 0.35);
  if (css === lastBg) return;
  lastBg = css;
  root.style.setProperty('--c1', rgbCss(c1));
  root.style.setProperty('--c2', rgbCss(c2));
  root.style.setProperty('--ink', rgbCss(mixRgb(theme, BLACK, 0.45)));
}

function fitGiant(name) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lines = name.length > 16 ? 2 : 1;
  const per = Math.ceil(name.length / lines);
  const fs = clamp((vw * 0.92) / (per * 0.66), 38, vh * (lines === 1 ? 0.3 : 0.24));
  el.giantText.style.fontSize = fs.toFixed(0) + 'px';
}

function fillText(p) {
  el.giantText.textContent = p.name;
  fitGiant(p.name);
  el.infoPrice.textContent = formatVnd(p.price);
  el.infoDesc.textContent = p.desc;
  const s = stockInfo(p);
  el.infoStock.className = 'stock ' + s.cls;
  el.infoStock.textContent = s.text;
  el.btnOrder.disabled = p.stock <= 0;
  el.btnOrder.textContent = p.stock <= 0 ? 'Hết hàng' : 'Đặt Ngay';
}

export function setActive(i) {
  if (i === activeIdx || !products[i]) return;
  const first = activeIdx < 0;
  activeIdx = i;
  const p = products[i];
  dots.forEach((d, k) => d.classList.toggle('on', k === i));

  const targets = [el.giantText, el.infoBody];
  gsap.killTweensOf(targets);
  if (first) {
    fillText(p);
  } else {
    gsap.timeline()
      .to(targets, { y: -30, opacity: 0, duration: 0.18, ease: 'power2.in' })
      .add(() => fillText(p))
      .fromTo(targets, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out' });
  }
  const c = hexToRgb(p.color);
  gsap.to(theme, { r: c.r, g: c.g, b: c.b, duration: 0.9, ease: 'power2.out', onUpdate: applyBackground });
}

/** Cập nhật lớp phủ DOM theo tiến trình timeline. Trả về màu sương (rgb). */
export function applyStage(P) {
  const heroO = 1 - clamp(P.fly * 2.5, 0, 1);
  el.heroTitle.style.opacity = heroO.toFixed(3);
  el.heroTitle.style.transform = `translate3d(0,${(-P.door * 40).toFixed(1)}px,0) scale(${(1 + P.door * 0.06).toFixed(3)})`;
  el.hint.style.opacity = (1 - clamp(P.hero * 6, 0, 1)).toFixed(3);

  const ringO = smoothstep(0.55, 1, P.fly);
  el.giant.style.opacity = ringO.toFixed(3);
  el.info.style.opacity = ringO.toFixed(3);
  el.pager.style.opacity = ringO.toFixed(3);
  const on = ringO > 0.6;
  el.info.classList.toggle('on', on);
  el.pager.classList.toggle('on', on);
  document.body.classList.toggle('ring', on);

  el.barFill.style.transform = `scaleX(${clamp(P.spin, 0, 1).toFixed(4)})`;

  blend = smoothstep(0.35, 1, P.cam);
  applyBackground();
  return fogRgb;
}

export function onResize() {
  if (products[activeIdx]) fitGiant(products[activeIdx].name);
}

/* ======================= Modal đặt hàng ======================= */
let current = null;
let lastFocus = null;

function setQty(n) {
  if (!current) return;
  const max = Math.max(1, Math.min(CONFIG.order.maxQty, current.stock || 1));
  const q = clamp(Math.round(n) || 1, 1, max);
  el.qty.value = String(q);
  el.mTotal.textContent = formatVnd(q * current.price);
}

export function openOrder(p) {
  if (!p || p.stock <= 0) return;
  current = p;
  lastFocus = document.activeElement;
  el.form.reset();
  el.form.classList.remove('sent');
  el.mMsg.textContent = '';
  el.mMsg.className = '';
  el.mSubmit.disabled = false;
  el.mSubmit.textContent = 'Xác nhận đặt bánh';
  el.mName.textContent = p.name;
  el.mPrice.textContent = formatVnd(p.price);
  setQty(1);
  el.modal.hidden = false;
  requestAnimationFrame(() => el.modal.classList.add('open'));
  if (H.modal) H.modal(true);
  setTimeout(() => { const f = el.form.querySelector('input[name="name"]'); if (f) f.focus(); }, 60);
}

export function closeOrder() {
  el.modal.classList.remove('open');
  setTimeout(() => { el.modal.hidden = true; }, 220);
  if (H.modal) H.modal(false);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

async function onSubmit(e) {
  e.preventDefault();
  if (!current) return;
  const fd = new FormData(el.form);
  const name = String(fd.get('name') || '').trim();
  const phone = String(fd.get('phone') || '').trim();
  const msg = (t, cls) => { el.mMsg.textContent = t; el.mMsg.className = cls || ''; };
  if (name.length < 2) return msg('Vui lòng nhập họ tên.', 'err');
  if (!/^[0-9+\s.\-]{9,15}$/.test(phone)) return msg('Số điện thoại chưa đúng.', 'err');

  const qty = Number(fd.get('qty')) || 1;
  el.mSubmit.disabled = true;
  msg('Đang gửi đơn…');
  try {
    const r = await submitOrder({
      productId: current.id,
      qty,
      name,
      phone,
      address: String(fd.get('address') || '').trim(),
      note: String(fd.get('note') || '').trim(),
      website: String(fd.get('website') || ''),
    });
    current.stock = Math.max(0, current.stock - qty);
    refreshLabelTexts();
    if (products[activeIdx] === current) fillText(current);
    el.form.classList.add('sent');
    msg(`Đặt thành công! Mã đơn: ${r.orderId}${r.demo ? ' (chế độ thử nghiệm)' : ''}. 9 Sạch sẽ liên hệ xác nhận sớm.`, 'ok');
    setTimeout(closeOrder, 3800);
  } catch (err) {
    el.mSubmit.disabled = false;
    msg(err.message || 'Có lỗi, vui lòng thử lại.', 'err');
  }
}

/* ======================= Fallback 2D (không có WebGL) ======================= */
const EMOJI = { round: '🎂', cupcake: '🧁', roll: '🥮', bread: '🍞', donut: '🍩' };

export function mountFallback2D(list, updatedAt) {
  products = list;
  document.body.classList.add('fallback');
  el.stage.style.display = 'none';
  const fb = el.fallback;
  fb.hidden = false;
  fb.innerHTML = '<header class="fb-head"><h1>Tủ bánh hôm nay</h1><p id="fb-sub"></p></header><div class="fb-track" id="fb-track"></div><p class="fb-hint">Vuốt ngang để chọn bánh</p>';
  setUpdated(updatedAt);
  const track = fb.querySelector('#fb-track');
  list.forEach((p, i) => {
    const s = stockInfo(p);
    const card = document.createElement('article');
    card.className = 'fb-card';
    card.dataset.i = String(i);
    const art = document.createElement('div');
    art.className = 'fb-art';
    art.style.background = `radial-gradient(circle at 35% 30%, #fff, ${p.color})`;
    if (p.image) {
      const im = document.createElement('img');
      im.src = p.image;
      im.alt = p.name;
      art.appendChild(im);
    } else {
      art.textContent = EMOJI[p.type] || '🎂';
    }
    const h = document.createElement('h2');
    h.textContent = p.name;
    const pr = document.createElement('p');
    pr.className = 'fb-price';
    pr.textContent = formatVnd(p.price);
    const ds = document.createElement('p');
    ds.className = 'fb-desc';
    ds.textContent = p.desc;
    const st = document.createElement('span');
    st.className = 'stock ' + s.cls;
    st.textContent = s.text;
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.disabled = p.stock <= 0;
    b.textContent = p.stock <= 0 ? 'Hết hàng' : 'Đặt Ngay';
    b.addEventListener('click', () => openOrder(p));
    card.append(art, h, pr, ds, st, b);
    track.appendChild(card);
  });

  const setTheme = (p) => {
    const c = hexToRgb(p.color);
    blend = 1;
    gsap.to(theme, { r: c.r, g: c.g, b: c.b, duration: 0.6, onUpdate: applyBackground });
  };
  if (list[0]) setTheme(list[0]);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) setTheme(list[Number(en.target.dataset.i)]); });
    }, { root: track, threshold: 0.6 });
    track.querySelectorAll('.fb-card').forEach((c) => io.observe(c));
  }
  hideLoader();
}
