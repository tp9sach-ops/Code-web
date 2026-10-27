/* v8-3d.js — TỦ BÁNH 3D cho bước ① Kết ca (Three.js, dựng theo trang "Tủ bánh hôm nay").
 * Dùng:  mount(THREE, canvas, H) → { setItems, setProgress, setIndex, step, pulse, setTint, resize, dispose }
 *   H = { onFocus(i), onTap(i), onOpenReq() }   (i = chỉ số dòng bánh trong S.cur.rows)
 * Cuộn ngắn 0→1: mở cửa tủ → bánh bay ra vòng tròn → chọn bánh bằng vuốt/kéo/phím.
 * Mọi tham số chỉnh nhanh nằm ở CFG. Bánh dựng bằng hình học (không cần file 3D / ảnh). */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const seg = (a, b, x) => clamp((x - a) / (b - a), 0, 1);

export const CFG = {
  door: [0.0, 0.22], fly: [0.12, 0.56], cam: [0.22, 0.6], out: [0.5, 0.66],   // mốc timeline theo tiến độ cuộn 0→1
  doorAngle: 1.75,
  fridgeFill: 0.7,           // tủ chiếm % chiều cao khung (lúc đóng)
  ring: { radius: 4.2, radiusMobile: 2.3, rmin: 3.0, rmax: 5.2, tilt: 0.26, center: 1.45, far: 0.72, mobMul: 0.8,
          follow: 8, camDist: 5.8, camDistMobile: 7.4, camUp: 1.3, lookDy: -0.55, dragWidth: 0.28, snapMs: 140,
          itemTilt: 0.35, stagger: 0.45, arc: 1.2, bob: 0.05, fogNear: 0.2, fogFar: 2.4 },
  fov: 35, fovMin: 28, fovMax: 60, refAspect: 1.6,
  maxDpr: 2, maxDprMobile: 1.75, targetFps: 28,
};

/* ---------- màu vị bánh theo tên + màu gốc từng loại ---------- */
const KIND_BASE = { crepe: '#e9b94d', truyenthong: '#d8b06b', phusi: '#a58bd0', '3vi': '#d8b06b', lava: '#6a4130', other: '#d9a066' };
const FLAVORS = [
  [/red velvet/, '#b6283a'], [/xoai/, '#f4b63a'], [/dau|strawberry/, '#ec6f8d'], [/matcha|tra xanh/, '#8fb35f'],
  [/socola|chocolate|cacao|cocoa/, '#6a4130'], [/nutella/, '#7a4a32'], [/ca phe|coffee|tiramisu/, '#a47a55'],
  [/sau rieng/, '#e6d36a'], [/chanh day|passion/, '#f5c518'], [/khoai mon|taro|ube/, '#a98bd1'], [/oreo/, '#4b4545'],
  [/tra sua/, '#c79a6b'], [/cam\b|orange/, '#f08c2e'], [/viet quat|blueberry/, '#6f77c9'], [/\bbo\b|avocado/, '#c3cf7d'],
  [/dua\b|coconut/, '#f1ead0'], [/pho mai|cheese/, '#f4d27a'], [/vani|vanilla/, '#f1dca4'],
];
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
export function flavorColor(name, kind) {
  const n = norm(name);
  for (let i = 0; i < FLAVORS.length; i++) if (FLAVORS[i][0].test(n)) return FLAVORS[i][1];
  return KIND_BASE[kind] || KIND_BASE.other;
}

/* ---------- dựng bánh ngàn lớp ---------- */
function mkTools(T, track) {
  const texCache = new Map(), matCache = new Map();
  const shade = (hex, dl) => { const c = new T.Color(hex), h = {}; c.getHSL(h); c.setHSL(h.h, h.s, clamp(h.l + dl, 0.03, 0.97)); return c; };
  const stripe = (crepe, cream) => {
    const k = crepe + cream; if (texCache.has(k)) return texCache.get(k);
    const c = document.createElement('canvas'); c.width = 8; c.height = 256; const x = c.getContext('2d');
    const dark = '#' + shade(crepe, -0.13).getHexString();
    let y = 0; const a = 6, b = 3;
    while (y < 256) { x.fillStyle = crepe; x.fillRect(0, y, 8, a); x.fillStyle = dark; x.fillRect(0, y + a - 1, 8, 1); x.fillStyle = cream; x.fillRect(0, y + a, 8, b); y += a + b; }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; track.push(t); texCache.set(k, t); return t;
  };
  const mat = (key, o) => { if (matCache.has(key)) return matCache.get(key); const m = new T.MeshStandardMaterial(o); track.push(m); matCache.set(key, m); return m; };
  const geo = (g) => { track.push(g); return g; };
  return { shade, stripe, mat, geo };
}

function buildCake(T, X, it) {
  const kind = it.kind, col = flavorColor(it.name, kind), cream = '#fff3da';
  const g = new T.Group(), R = 0.5, Hh = kind === 'phusi' ? 0.62 : 0.5, cut = 0.95;
  const side = (c) => X.mat('s' + c + cream, { map: X.stripe(c, cream), roughness: 0.8 });
  const topOf = (c, rough) => X.mat('t' + c, { color: c, roughness: rough == null ? 0.55 : rough });
  const bottom = X.mat('bot', { color: '#e9dcc0', roughness: 0.9 });
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  const sph = (r, mt, x, y, z, sy) => { const m = new T.Mesh(X.geo(new T.SphereGeometry(r, 10, 8)), mt); if (sy) m.scale.y = sy; return add(m, x, y, z); };

  if (kind === '3vi') {
    const trio = [col === KIND_BASE['3vi'] ? '#ec6f8d' : col, '#8fb35f', '#6a4130'];
    for (let k = 0; k < 3; k++) {
      const ge = X.geo(new T.CylinderGeometry(R, R, Hh, 40, 1, false, k * TAU / 3, TAU / 3 - 0.02));
      add(new T.Mesh(ge, [side(trio[k]), topOf('#' + X.shade(trio[k], 0.12).getHexString()), bottom]), 0, Hh / 2, 0);
    }
  } else if (kind === 'phusi') {
    const ge = X.geo(new T.CylinderGeometry(R * 0.36, R, Hh, 48, 1, false, 0, TAU));
    add(new T.Mesh(ge, [side(col), topOf('#fffaf0', 0.4), bottom]), 0, Hh / 2, 0);
    const snow = X.mat('snow', { color: '#ffffff', roughness: 0.35 });
    const cap = new T.Mesh(X.geo(new T.SphereGeometry(R * 0.4, 24, 10, 0, TAU, 0, Math.PI / 2)), snow); cap.scale.y = 0.7; add(cap, 0, Hh - 0.01, 0);
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; sph(0.055, snow, Math.sin(a) * R * 0.38, Hh - 0.03, Math.cos(a) * R * 0.38, 1.2); }
  } else {
    const topC = kind === 'lava' ? '#4a2616' : kind === 'crepe' ? cream : '#' + X.shade(col, 0.1).getHexString();
    const ge = X.geo(new T.CylinderGeometry(R, R, Hh, 56, 1, false, cut / 2, TAU - cut));
    add(new T.Mesh(ge, [side(col), topOf(topC, kind === 'lava' ? 0.25 : 0.55), bottom]), 0, Hh / 2, 0);
    // hai mặt cắt thấy rõ từng lớp
    const pg = X.geo(new T.PlaneGeometry(R, Hh)), pm = X.mat('p' + col + cream, { map: X.stripe(col, cream), roughness: 0.8, side: T.DoubleSide });
    [cut / 2, -cut / 2].forEach((th) => { const p = new T.Mesh(pg, pm); p.rotation.y = th - Math.PI / 2; add(p, Math.sin(th) * R / 2, Hh / 2, Math.cos(th) * R / 2); });
    const free = (th) => Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) > cut / 2 + 0.12;     // tránh vùng đã cắt
    if (kind === 'crepe') {
      const cm = X.mat('cream', { color: cream, roughness: 0.45 });
      for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; if (free(a)) sph(0.06, cm, Math.sin(a) * R * 0.84, Hh + 0.02, Math.cos(a) * R * 0.84, 0.8); }
      sph(0.09, X.mat('berry', { color: '#c62839', roughness: 0.25 }), 0, Hh + 0.07, -0.12, 1.1);
    } else if (kind === 'lava') {
      const ch = X.mat('choc', { color: '#3b1d12', roughness: 0.25, metalness: 0.1 });
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * TAU + 0.2; if (!free(a)) continue; const len = 0.1 + ((k * 37) % 10) / 10 * 0.22;
        add(new T.Mesh(X.geo(new T.CylinderGeometry(0.045, 0.045, len, 8)), ch), Math.sin(a) * (R + 0.008), Hh - len / 2, Math.cos(a) * (R + 0.008));
        sph(0.055, ch, Math.sin(a) * (R + 0.008), Hh - len, Math.cos(a) * (R + 0.008));
      }
      sph(0.15, X.mat('lava', { color: '#ff8a1f', emissive: '#ff5a00', emissiveIntensity: 0.75, roughness: 0.4 }), 0, Hh + 0.02, 0, 0.3);
    } else if (kind === 'truyenthong') {
      const dust = X.mat('dust', { color: '#f4ead2', roughness: 0.95 });
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.4; if (free(a)) sph(0.05, dust, Math.sin(a) * R * 0.55, Hh + 0.015, Math.cos(a) * R * 0.55, 0.6); }
    }
  }
  g.position.y = -Hh / 2;
  const obj = new T.Group(), spin = new T.Group(); spin.add(g); obj.add(spin); obj.spin = spin;
  return { obj, spin, hh: Hh / 2 };
}

/* ---------- tủ đông ---------- */
function buildFridge(T, track) {
  const W = 2.4, H = 3.2, D = 1.3, g = new T.Group();
  const M = (o) => { const m = new T.MeshStandardMaterial(o); track.push(m); return m; };
  const body = M({ color: '#f3efe4', roughness: 0.6 }), dark = M({ color: '#1d2623', roughness: 0.5, metalness: 0.3 }), green = M({ color: '#1f5a3a', roughness: 0.5 });
  const inner = M({ color: '#eaf4f8', roughness: 0.9, emissive: '#bfe3f5', emissiveIntensity: 0.35 });
  const glassShelf = M({ color: '#dff1ff', transparent: true, opacity: 0.45, roughness: 0.1 });
  const glassDoor = M({ color: '#cfe6ff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const led = new T.MeshBasicMaterial({ color: '#d8ecff' }); track.push(led);
  const box = (w, h, d, m, x, y, z, p) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); track.push(b.geometry); b.position.set(x, y, z); (p || g).add(b); return b; };
  box(W - 0.16, H - 0.3, 0.05, inner, 0, 0.02, -D / 2 + 0.03);
  box(0.09, H, D, body, -W / 2 + 0.045, 0, 0); box(0.09, H, D, body, W / 2 - 0.045, 0, 0);
  box(W, 0.34, D, green, 0, H / 2 - 0.17, 0); box(W + 0.06, 0.2, D + 0.04, dark, 0, -H / 2 + 0.1, 0);
  box(W - 0.2, 0.045, 0.05, led, 0, H / 2 - 0.38, D / 2 - 0.12);
  const floor0 = -H / 2 + 0.2, gap = (H - 0.54) / 4, floors = [];
  for (let r = 0; r < 4; r++) { floors.push(floor0 + r * gap); if (r > 0) box(W - 0.2, 0.03, D - 0.12, glassShelf, 0, floor0 + r * gap - 0.015, 0); }
  const door = new T.Group(); door.position.set(-W / 2, 0, D / 2 + 0.02); g.add(door);
  box(W - 0.06, H - 0.5, 0.03, glassDoor, W / 2, -0.02, 0, door);
  box(W, 0.07, 0.06, dark, W / 2, H / 2 - 0.27, 0, door); box(W, 0.07, 0.06, dark, W / 2, -H / 2 + 0.24, 0, door);
  box(0.07, H - 0.4, 0.06, dark, 0.035, -0.02, 0, door); box(0.07, H - 0.4, 0.06, dark, W - 0.035, -0.02, 0, door);
  box(0.05, 1.1, 0.07, dark, W - 0.18, 0, 0.06, door);
  const pl = new T.PointLight('#d8ecff', 6, 6); pl.position.set(0, 0.4, D / 2 - 0.2); g.add(pl);
  return { group: g, door, W, H, D, floors, light: pl };
}

/* ---------- mount ---------- */
export function mount(T, canvas, H) {
  const track = [], X = mkTools(T, track);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new T.Scene(); scene.fog = new T.Fog(0xf6efdf, 300, 600);
  const cam = new T.PerspectiveCamera(CFG.fov, 1, 0.1, 100);
  const key = new T.DirectionalLight('#fff3dc', 2.6); key.position.set(3, 5, 4);
  const fill = new T.DirectionalLight('#cfe6ff', 0.9); fill.position.set(-4, 2, 3);
  scene.add(key, fill, new T.HemisphereLight(0xffffff, 0xe8dcc0, 1.1));
  const fr = buildFridge(T, track); scene.add(fr.group);
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(30,20,10,.55)'); gr.addColorStop(1, 'rgba(30,20,10,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(c); track.push(t); return t; })();
  const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0, fog: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow); track.push(shadow.geometry, shadow.material);

  let its = [], N = 0, cur = 0, target = 0, lastIdx = -1, pT = 0, pS = 0, firstP = true, bump = 0, time = 0, dead = false, raf = 0, last = 0, snapT = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? CFG.maxDprMobile : CFG.maxDpr);
  renderer.setPixelRatio(dpr);
  const size = { w: 1, h: 1 }, hero = { pos: new T.Vector3(0, 0.1, 8), look: new T.Vector3() }, ring = { pos: new T.Vector3(), look: new T.Vector3(), near: 8, far: 20 };
  let met = { R: 4, tilt: 0.26, frontY: -1, frontZ: 3.8, mob: false, camDist: 5.8 };
  const fogC = new T.Color(0xf6efdf), fogT = new T.Color(0xf6efdf);
  const vA = new T.Vector3(), vB = new T.Vector3(), tmp = new T.Vector3(), tmp2 = new T.Vector3();

  function layout() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight); size.w = w; size.h = h;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    cam.fov = clamp(CFG.fov * Math.pow(CFG.refAspect / cam.aspect, 0.45), CFG.fovMin, CFG.fovMax); cam.updateProjectionMatrix();
    const tanH = Math.tan(T.MathUtils.degToRad(cam.fov / 2)), c = CFG.ring, mob = cam.aspect < 0.8;
    const dH = fr.H / (2 * CFG.fridgeFill * tanH), dW = fr.W / (2 * 0.86 * tanH * cam.aspect);
    hero.pos.set(0, 0.1, Math.max(dH, dW) + fr.D / 2);
    const R = mob ? c.radiusMobile : clamp(c.radius * cam.aspect / CFG.refAspect, c.rmin, c.rmax);
    met = { R, tilt: c.tilt, mob, camDist: mob ? c.camDistMobile : c.camDist, frontY: -R * Math.sin(c.tilt), frontZ: R * Math.cos(c.tilt) };
    ring.pos.set(0, met.frontY + c.camUp, met.frontZ + met.camDist); ring.look.set(0, met.frontY + c.lookDy, met.frontZ);
    ring.near = met.camDist + R * c.fogNear; ring.far = met.camDist + R * c.fogFar;
  }

  function clearItems() { its.forEach((it) => scene.remove(it.obj)); its = []; }
  function setItems(list) {
    clearItems(); N = list.length;
    const cols = Math.max(1, Math.min(4, Math.ceil(N / 4))), cellW = (fr.W - 0.4) / cols, sc = Math.min(0.42, cellW * 0.8);
    list.forEach((d, i) => {
      const b = buildCake(T, X, d); b.obj.userData.k = d.k; scene.add(b.obj);
      const row = i % 4, col = Math.floor(i / 4) % cols;
      const anchor = new T.Vector3((col - (cols - 1) / 2) * cellW, fr.floors[row] + 0.015 + b.hh * sc, 0.05);
      its.push({ k: d.k, obj: b.obj, spin: b.spin, hh: b.hh, anchor, base: sc, ph: i * 1.3 });
    });
    cur = target = Math.max(0, its.findIndex((x) => x.k === H.start)); if (cur < 0) cur = target = 0; lastIdx = target;
  }
  function report() {
    if (!N) return; const idx = clamp(Math.round(target), 0, N - 1);
    if (idx !== lastIdx) { lastIdx = idx; H.onFocus && H.onFocus(its[idx].k); }
  }

  /* ----- điều khiển: kéo / lăn ngang / chạm ----- */
  const ray = new T.Raycaster(), ndc = new T.Vector2(); let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: target, moved: false }; };
  const onMove = (e) => {
    if (!down) return; const dx = e.clientX - down.x;
    if (Math.abs(dx) > 6) down.moved = true;
    if (down.moved && pT > 0.55) { target = clamp(down.t - dx / (size.w * CFG.ring.dragWidth), -0.3, N - 0.7); report(); }
  };
  const onUp = (e) => {
    if (!down) return; const d = down; down = null;
    if (d.moved) { target = clamp(Math.round(target), 0, Math.max(0, N - 1)); report(); return; }
    if (e.type === 'pointercancel') return;
    if (pT < 0.5) { H.onOpenReq && H.onOpenReq(); return; }
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); const hit = ray.intersectObjects(its.map((x) => x.obj), true)[0]; if (!hit) return;
    let o = hit.object; while (o && o.userData.k === undefined) o = o.parent; if (!o) return;
    const idx = its.findIndex((x) => x.k === o.userData.k);
    if (idx === Math.round(target)) H.onTap && H.onTap(o.userData.k); else { target = idx; report(); }
  };
  const onWheel = (e) => {
    if (pT < 0.55 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    target = clamp(target + e.deltaX / 240, 0, Math.max(0, N - 1)); report();
    clearTimeout(snapT); snapT = setTimeout(() => { target = clamp(Math.round(target), 0, Math.max(0, N - 1)); report(); }, CFG.ring.snapMs);
  };
  canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp); canvas.addEventListener('wheel', onWheel, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null; if (ro) ro.observe(canvas);

  /* ----- vòng lặp ----- */
  let fpsN = 0, fpsT = 0;
  function frame(now) {
    if (dead) return; if (!canvas.isConnected) { dispose(); return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; time += dt;
    fpsN++; fpsT += dt; if (fpsT > 1.5) { if (fpsN / fpsT < CFG.targetFps && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); layout(); } fpsN = 0; fpsT = 0; }
    pS = firstP ? pT : damp(pS, pT, 10, dt); firstP = false; bump = damp(bump, 0, 7, dt);
    const c = CFG.ring, doorT = ease(seg(CFG.door[0], CFG.door[1], pS)), flyT = seg(CFG.fly[0], CFG.fly[1], pS), cb = ease(seg(CFG.cam[0], CFG.cam[1], pS)), outT = ease(seg(CFG.out[0], CFG.out[1], pS));
    cur = damp(cur, target, c.follow, dt);
    fr.door.rotation.y = -CFG.doorAngle * doorT; fr.group.position.z = -outT * 3; fr.group.scale.setScalar(1 - 0.15 * outT); fr.group.visible = outT < 0.995; fr.group.updateMatrixWorld(true);
    const step = N > 1 ? Math.min(TAU / N, 0.95) : 0, stag = N > 1 ? c.stagger / (N - 1) : 0, denom = Math.max(0.0001, 1 - (N - 1) * stag), mul = met.mob ? c.mobMul : 1;
    const act = clamp(Math.round(cur), 0, Math.max(0, N - 1));
    for (let i = 0; i < N; i++) {
      const it = its[i], a = (i - cur) * step, cosA = Math.cos(a), sz = cosA * met.R;
      vB.set(Math.sin(a) * met.R, -sz * Math.sin(met.tilt), sz * Math.cos(met.tilt));
      const focus = sstep(0.6, 1, cosA), rs = lerp(c.far, c.center, focus) * mul * (i === act ? 1 + 0.08 * bump : 1);
      const e = ease(clamp((flyT - i * stag) / denom, 0, 1)), arc = Math.sin(Math.PI * e);
      vA.copy(it.anchor); fr.group.localToWorld(vA);
      it.obj.position.lerpVectors(vA, vB, e); it.obj.position.z += arc * c.arc; it.obj.position.y += arc * 0.5 + Math.sin(time * 1.3 + it.ph) * c.bob * focus * e;
      it.obj.scale.setScalar(Math.max(0.0001, lerp(it.base * (1 - 0.15 * outT * (1 - e)), rs, e))); it.obj.visible = it.obj.scale.x > 0.001;
      it.spin.rotation.y = Math.sin(time * 0.6 + it.ph) * 0.45 * e; it.spin.rotation.x = c.itemTilt * e;
    }
    const camP = tmp.lerpVectors(hero.pos, ring.pos, cb), camL = tmp2.lerpVectors(hero.look, ring.look, cb);
    camP.z -= 0.25 * pS * (1 - cb); cam.position.copy(camP); cam.lookAt(camL);
    fogC.lerp(fogT, 1 - Math.exp(-6 * dt)); scene.fog.color.copy(fogC); scene.fog.near = lerp(300, ring.near, cb); scene.fog.far = lerp(600, ring.far, cb);
    const frac = Math.abs(cur - Math.round(cur)), cs = c.center * mul, hh = its[act] ? its[act].hh : 0.25;
    shadow.material.opacity = sstep(0.8, 1, flyT) * (1 - clamp(frac * 2.2, 0, 1)) * 0.5;
    shadow.position.set(0, met.frontY - hh * cs - 0.18, met.frontZ); shadow.scale.set(cs * 1.4, cs * 1.4, 1);
    renderer.render(scene, cam);
  }

  function dispose() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); clearTimeout(snapT);
    canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel); if (ro) ro.disconnect();
    track.forEach((t) => { try { t.dispose && t.dispose(); } catch (e) {} }); try { renderer.dispose(); } catch (e) {}
  }
  layout(); raf = requestAnimationFrame(frame);
  return {
    setItems, resize: layout, dispose,
    setProgress(p) { pT = clamp(p, 0, 1); },
    setIndex(k) { const i = its.findIndex((x) => x.k === k); if (i >= 0) { target = i; lastIdx = i; } },
    step(d) { target = clamp(Math.round(target) + d, 0, Math.max(0, N - 1)); report(); },
    pulse() { bump = 1; },
    setTint(hex) { try { fogT.set(hex); } catch (e) {} },
  };
}
