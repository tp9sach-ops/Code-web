import { CONFIG } from './config.js';
import { loadProducts, signature, startAutoRefresh } from './data.js';
import { createScene, hasWebGL, bindParallax, parallax } from './scene.js';
import { Fridge, FRIDGE } from './fridge.js';
import { Carousel } from './carousel.js';
import * as UI from './ui.js';
import { clamp, easeOutCubic } from './utils.js';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const T = CONFIG.timeline;

/** Trạng thái do GSAP timeline điều khiển theo thanh cuộn (đều 0 → 1). */
const P = { hero: 0, door: 0, fly: 0, cam: 0, out: 0, spin: 0 };

const S = { gl: null, fridge: null, carousel: null, lenis: null, tl: null, st: null, data: null, lastActive: -1, dragging: false, modal: false };

/* ======================= Khởi động ======================= */
async function boot() {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  UI.init({
    order: () => S.data && UI.openOrder(S.data.products[S.carousel ? S.carousel.active : 0]),
    goTo,
    step: (d) => goTo((S.carousel ? S.carousel.active : 0) + d),
    modal: (open) => {
      S.modal = open;
      if (S.lenis) (open ? S.lenis.stop() : S.lenis.start());
    },
  });

  try {
    S.data = await loadProducts();
  } catch (err) {
    console.error(err);
    document.getElementById('loader').textContent = 'Không tải được dữ liệu bánh. Vui lòng thử lại.';
    return;
  }
  UI.setUpdated(S.data.updatedAt);

  if (!hasWebGL()) return fallback();
  try {
    setup();
    UI.hideLoader();
  } catch (err) {
    console.error('[3D] lỗi khởi tạo, chuyển sang 2D:', err);
    fallback();
  }
}

function fallback() {
  try {
    if (S.tl && S.tl.scrollTrigger) S.tl.scrollTrigger.kill();
    if (S.lenis) S.lenis.destroy();
    gsap.ticker.remove(frame);
  } catch (e) { /* bỏ qua */ }
  UI.mountFallback2D(S.data.products, S.data.updatedAt);
}

/* ======================= Dựng thế giới 3D ======================= */
function buildWorld(products) {
  if (S.fridge) S.fridge.dispose();
  if (S.carousel) S.carousel.dispose();
  S.fridge = new Fridge(S.gl.scene, products);
  S.carousel = new Carousel(S.gl.scene, S.fridge);
  S.gl.setDims(FRIDGE);
  applyMetrics();
  UI.setProducts(products);
  UI.setLabels(S.fridge.items);
  S.lastActive = -1;
}

function applyMetrics() {
  S.gl.setRing(S.carousel.computeMetrics(S.gl.aspect()));
}

function setup() {
  const canvas = document.getElementById('gl');
  S.gl = createScene(canvas);
  bindParallax();
  S.gl.resize();
  buildWorld(S.data.products);

  /* --- Lenis: cuộn mượt --- */
  S.lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
  S.lenis.on('scroll', () => {
    ScrollTrigger.update();
    if (!S.dragging) scheduleSnap();
  });
  gsap.ticker.add((time) => S.lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  /* --- GSAP Timeline gắn vào thanh cuộn, pin canvas --- */
  S.tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#stage',
      start: 'top top',
      end: () => '+=' + Math.round(window.innerHeight * (CONFIG.scroll.lengthVh / 100)),
      pin: true,
      scrub: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
    defaults: { ease: 'none' },
  });
  S.tl
    .to(P, { hero: 1, duration: T.doorStart }, 0)
    .to(P, { door: 1, duration: T.doorEnd - T.doorStart, ease: 'power2.inOut' }, T.doorStart)
    .to(P, { fly: 1, duration: T.flyEnd - T.flyStart }, T.flyStart)
    .to(P, { cam: 1, duration: T.camEnd - T.camStart, ease: 'power2.inOut' }, T.camStart)
    .to(P, { out: 1, duration: T.outEnd - T.outStart, ease: 'power2.inOut' }, T.outStart)
    .to(P, { spin: 1, duration: T.spinEnd - T.spinStart }, T.spinStart);
  S.st = S.tl.scrollTrigger;

  bindInput();
  gsap.ticker.add(frame);
  window.addEventListener('resize', debounce(onResize, 150));
  startAutoRefresh(onRefresh);
}

function onResize() {
  if (!S.gl) return;
  S.gl.resize();
  applyMetrics();
  UI.onResize();
  ScrollTrigger.refresh();
}

function onRefresh(data) {
  if (!S.data) return;
  UI.setUpdated(data.updatedAt);
  if (signature(data.products) === signature(S.data.products)) return;
  S.data = data;
  buildWorld(data.products);
}

/* ======================= Vòng lặp render ======================= */
let accT = 0;
let accF = 0;
function frame(time, deltaMs) {
  const fr = S.fridge;
  if (!fr || !S.gl) return;
  const dt = clamp(deltaMs / 1000, 0.001, 0.05);
  const gl = S.gl;

  gl.updateParallax(dt);
  fr.update(time, dt, P, parallax);
  S.carousel.update(time, dt, P);
  gl.applyCamera(P);
  const fog = UI.applyStage(P);
  gl.setFog(P.cam, fog);
  if (S.carousel.active !== S.lastActive) {
    S.lastActive = S.carousel.active;
    UI.setActive(S.lastActive);
  }
  gl.render();
  UI.updateLabels(gl.camera, gl.width, gl.height, 1 - clamp(P.door * 2, 0, 1));

  // DPR thích ứng: giữ >= targetFps
  if (CONFIG.render.adaptive) {
    accT += dt;
    accF++;
    if (accT >= 1.5) {
      const fps = accF / accT;
      accT = 0;
      accF = 0;
      const d = gl.getDpr();
      if (fps < CONFIG.render.targetFps + 4 && d > CONFIG.render.minDpr) gl.setDpr(Math.max(CONFIG.render.minDpr, d - 0.25));
      else if (fps > 56 && d < gl.maxDpr()) gl.setDpr(Math.min(gl.maxDpr(), d + 0.25));
    }
  }
}

/* ======================= Điều hướng vòng tròn ======================= */
function count() {
  return S.data.products.length;
}

/** Vị trí cuộn (px) tương ứng bánh thứ k ở giữa. */
function posOf(k) {
  const N = count();
  const q = T.spinStart + (T.spinEnd - T.spinStart) * (N > 1 ? k / (N - 1) : 0);
  return S.st.start + q * (S.st.end - S.st.start);
}

function goTo(k) {
  if (!S.lenis || !S.st) return;
  const kk = clamp(k, 0, count() - 1);
  S.lenis.scrollTo(posOf(kk), { duration: 1.0, easing: easeOutCubic });
}

/* Snap thông minh: dừng cuộn → khớp về bánh gần nhất */
let snapTimer = 0;
function scheduleSnap() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(snapNow, CONFIG.carousel.snapIdleMs);
}
function snapNow() {
  if (S.dragging || S.modal || !S.st) return;
  const q = S.st.progress;
  const N = count();
  let target = null;
  if (q >= T.spinStart - 0.02) {
    const k = clamp(Math.round(((q - T.spinStart) / (T.spinEnd - T.spinStart)) * (N - 1)), 0, N - 1);
    target = posOf(k);
  } else if (q > T.doorStart + 0.02) {
    // đang giữa chuyển cảnh: về hero hoặc sang vòng tròn
    target = q < (T.doorStart + T.spinStart) / 2 ? S.st.start + T.doorStart * (S.st.end - S.st.start) : posOf(0);
  }
  if (target == null || Math.abs(S.lenis.scroll - target) < 2) return;
  S.lenis.scrollTo(target, { duration: 0.55, easing: easeOutCubic });
}

/* Kéo / vuốt ngang có quán tính */
function bindInput() {
  const stage = document.getElementById('stage');
  let startX = 0;
  let startScroll = 0;
  let lastX = 0;
  let lastT = 0;
  let vel = 0;
  const pxPerIndex = () => {
    const N = count();
    return N > 1 ? ((T.spinEnd - T.spinStart) * (S.st.end - S.st.start)) / (N - 1) : 1;
  };
  const dragPx = () => window.innerWidth * CONFIG.carousel.dragWidth;

  stage.addEventListener('pointerdown', (e) => {
    if (P.fly < 0.98 || S.modal || e.target.closest('button, a, input, textarea')) return;
    S.dragging = true;
    startX = lastX = e.clientX;
    startScroll = S.lenis.scroll;
    lastT = performance.now();
    vel = 0;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!S.dragging) return;
    const now = performance.now();
    const dx = e.clientX - startX;
    const dtm = Math.max(1, now - lastT);
    vel = 0.8 * vel + 0.2 * ((e.clientX - lastX) / dtm);
    lastX = e.clientX;
    lastT = now;
    const lo = posOf(0);
    const hi = posOf(count() - 1);
    const t = clamp(startScroll - (dx / dragPx()) * pxPerIndex(), lo, hi);
    S.lenis.scrollTo(t, { immediate: true, force: true });
  });
  const end = (e) => {
    if (!S.dragging) return;
    S.dragging = false;
    if (e.type === 'pointercancel') return scheduleSnap();
    const N = count();
    const idxNow = clamp(P.spin * (N - 1), 0, N - 1);
    const proj = idxNow - (vel * CONFIG.carousel.inertiaMs) / dragPx();
    const k = clamp(Math.round(proj), 0, N - 1);
    S.lenis.scrollTo(posOf(k), { duration: 0.9, easing: easeOutCubic });
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', end);
}

function debounce(fn, ms) {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

boot();
