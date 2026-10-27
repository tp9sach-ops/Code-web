import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeProduct, disposeObject } from './cake.js';
import { clamp, damp, smoothstep, radialTexture, badgeTexture, signTexture } from './utils.js';

/** Kích thước tủ (đơn vị 3D). */
export const FRIDGE = { W: 2.0, H: 3.2, D: 1.1, T: 0.07, BASE: 0.2, HEAD: 0.38 };

/** Vị trí các bánh trong 1 ô kệ khi còn ít hàng (<= 5). Đơn vị: thế giới. */
const CLUSTER = {
  1: [[0, 0]],
  2: [[-0.09, 0], [0.09, 0]],
  3: [[-0.12, 0.06], [0.12, 0.06], [0, -0.1]],
  4: [[-0.12, 0.08], [0.12, 0.08], [-0.12, -0.1], [0.12, -0.1]],
  5: [[-0.17, 0.08], [0, 0.08], [0.17, 0.08], [-0.09, -0.1], [0.09, -0.1]],
};
const CLUSTER_SCALE = [0, 1, 0.9, 0.8, 0.75, 0.7];

export class Fridge {
  constructor(scene, products) {
    this.scene = scene;
    this.products = products;
    this.group = new THREE.Group();
    this.itemsGroup = new THREE.Group();
    scene.add(this.group, this.itemsGroup);
    this.recs = []; // vật liệu cần mờ dần
    this.items = [];
    this.mist = [];
    this.alpha = 1;
    this._build();
    this._place();
  }

  _reg(mat) {
    this.recs.push({ m: mat, o: mat.opacity, t: mat.transparent, cur: mat.transparent });
    return mat;
  }

  _box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  _build() {
    const { W, H, D, T, BASE, HEAD } = FRIDGE;
    const F = CONFIG.fridge;

    const black = this._reg(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.35, metalness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.3 }));
    const inner = this._reg(new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.6, emissive: 0xbfe0ff, emissiveIntensity: 0.35 }));
    const led = this._reg(new THREE.MeshBasicMaterial({ color: new THREE.Color(F.ledColor), toneMapped: false }));
    const shelfMat = this._reg(new THREE.MeshPhysicalMaterial({ color: 0xeaf4ff, roughness: 0.15, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false }));
    const glassMat = this._reg(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.14,
      clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false,
    }));
    const metal = this._reg(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 }));

    const innerH = H - BASE - HEAD;
    const midY = (BASE - HEAD) / 2;
    const innerW = W - 2 * T;
    this.innerW = innerW;

    // Khung đen
    this._box(W, BASE, D, black, 0, -H / 2 + BASE / 2, 0);
    this._box(W, HEAD, D, black, 0, H / 2 - HEAD / 2, 0);
    this._box(T, innerH, D, black, -(W / 2 - T / 2), midY, 0);
    this._box(T, innerH, D, black, W / 2 - T / 2, midY, 0);
    this._box(innerW, innerH, 0.04, inner, 0, midY, -D / 2 + 0.02);

    // Biển hiệu
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.2, HEAD * 0.62),
      this._reg(new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }))
    );
    sign.position.set(0, H / 2 - HEAD / 2, D / 2 + 0.002);
    this.group.add(sign);

    // Dải LED lạnh
    const innerTop = H / 2 - HEAD;
    this._box(innerW, 0.03, 0.06, led, 0, innerTop - 0.02, D / 2 - 0.1);
    this._box(0.03, innerH, 0.03, led, -(innerW / 2 - 0.02), midY, D / 2 - 0.07);
    this._box(0.03, innerH, 0.03, led, innerW / 2 - 0.02, midY, D / 2 - 0.07);
    this.led1 = new THREE.PointLight(new THREE.Color(F.ledColor), F.ledIntensity, 6, 2);
    this.led1.position.set(0, 0.7, 0.25);
    this.led2 = new THREE.PointLight(new THREE.Color(F.ledColor), F.ledIntensity, 6, 2);
    this.led2.position.set(0, -0.7, 0.25);
    this.group.add(this.led1, this.led2);

    // 4 tầng kệ
    const y0 = -H / 2 + BASE + 0.015;
    const gap = (innerTop - y0 - 0.1) / 4;
    this.shelfTop = [];
    for (let k = 0; k < 4; k++) {
      const yc = y0 + k * gap;
      this._box(innerW, 0.03, D - 0.12, shelfMat, 0, yc, -0.02);
      this._box(innerW, 0.035, 0.02, black, 0, yc, D / 2 - 0.08);
      this.shelfTop.push(yc + 0.015);
    }

    // Cửa kính (bản lề bên trái)
    const doorH = H - BASE - HEAD;
    this.door = new THREE.Group();
    this.door.position.set(-W / 2, -H / 2 + BASE + doorH / 2, D / 2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, doorH - 0.08, 0.02), glassMat);
    glass.position.x = W / 2;
    this.door.add(glass);
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), black);
      m.position.set(x, y, 0);
      this.door.add(m);
    };
    bar(W, 0.06, W / 2, doorH / 2 - 0.03);
    bar(W, 0.06, W / 2, -doorH / 2 + 0.03);
    bar(0.06, doorH, 0.03, 0);
    bar(0.06, doorH, W - 0.03, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, doorH * 0.55, 16), metal);
    handle.position.set(W - 0.14, 0, 0.075);
    this.door.add(handle);
    [-1, 1].forEach((s) => {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8), metal);
      st.rotation.x = Math.PI / 2;
      st.position.set(W - 0.14, s * doorH * 0.25, 0.045);
      this.door.add(st);
    });
    this.group.add(this.door);

    // Bóng đổ dưới tủ
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 2.6),
      this._reg(new THREE.MeshBasicMaterial({ map: radialTexture('rgba(25,15,5,0.55)', 'rgba(25,15,5,0)', 128), transparent: true, depthWrite: false, fog: false }))
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -H / 2 - 0.002;
    this.group.add(shadow);

    // Lớp sương mỏng ở đáy (trong tủ + tràn ra ngoài khi mở cửa)
    if (F.mist > 0) {
      const tex = radialTexture('rgba(235,246,255,0.9)', 'rgba(235,246,255,0)', 128);
      const make = (x, y, z, sc, base, outside, ph) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
        s.position.set(x, y, z);
        s.userData = { x, sc, base: base * F.mist, outside, ph };
        this.group.add(s);
        this.mist.push(s);
      };
      for (let i = 0; i < 10; i++) {
        make((Math.random() - 0.5) * innerW * 0.9, y0 + 0.12, -0.3 + Math.random() * 0.65, 0.9 + Math.random() * 0.6, 0.16, false, Math.random() * 6);
      }
      for (let i = 0; i < 8; i++) {
        make((Math.random() - 0.5) * W * 1.1, -H / 2 + 0.1, D / 2 + 0.2 + Math.random() * 0.7, 1.0 + Math.random() * 0.7, 0.22, true, Math.random() * 6);
      }
    }
  }

  _place() {
    const { D } = FRIDGE;
    const list = this.products;
    const N = list.length;
    const shelfScale = CONFIG.fridge.shelfScale;
    const rows = Math.min(4, Math.max(1, N));
    const perRow = Math.ceil(N / rows);
    const innerW = this.innerW;

    list.forEach((p, i) => {
      const r = Math.floor(i / perRow);
      const j = i % perRow;
      const nInRow = Math.min(perRow, N - r * perRow);
      let sIdx;
      if (rows === 1) sIdx = 2;
      else sIdx = 3 - Math.round((r * 3) / (rows - 1));
      const sx = ((j + 0.5) / nInRow - 0.5) * innerW * 0.92;
      const top = this.shelfTop[sIdx];

      const obj = makeProduct(p);
      const hh = obj.userData.hh;
      this.itemsGroup.add(obj);

      const item = { product: p, obj, anchor: null, extras: [], baseScale: shelfScale, stock: p.stock, badge: null, labelAnchor: null };
      const stock = Math.max(0, p.stock);

      const mkAnchor = (ox, oz, scale) => {
        const a = new THREE.Object3D();
        a.position.set(sx + ox, top + hh * shelfScale * scale, -0.02 + oz);
        this.group.add(a);
        return a;
      };

      if (stock > 5) {
        item.anchor = mkAnchor(0, 0.06, 1);
        [[-0.15, -0.1], [0.15, -0.1]].forEach((o) => {
          const ex = obj.clone(true);
          this.itemsGroup.add(ex);
          item.extras.push({ obj: ex, anchor: mkAnchor(o[0], o[1], 0.85), scale: shelfScale * 0.85 });
        });
        const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture('×' + stock), transparent: true, depthWrite: false, fog: false }));
        badge.scale.set(0.24, 0.12, 1);
        badge.position.set(sx + 0.2, top + hh * shelfScale * 2 + 0.06, 0.12);
        this.group.add(badge);
        item.badge = badge;
      } else if (stock >= 1) {
        const offs = CLUSTER[stock];
        const f = CLUSTER_SCALE[stock];
        item.anchor = mkAnchor(offs[0][0], offs[0][1], f);
        item.baseScale = shelfScale * f;
        for (let k = 1; k < stock; k++) {
          const ex = obj.clone(true);
          this.itemsGroup.add(ex);
          item.extras.push({ obj: ex, anchor: mkAnchor(offs[k][0], offs[k][1], f), scale: shelfScale * f });
        }
      } else {
        item.anchor = mkAnchor(0, 0, 1);
        item.baseScale = 0; // hết hàng: trống kệ, bánh chỉ xuất hiện trong vòng tròn
      }

      const la = new THREE.Object3D();
      la.position.set(sx, top + hh * shelfScale * 2 + 0.14, 0.12);
      this.group.add(la);
      item.labelAnchor = la;
      this.items.push(item);
    });
    this.group.updateMatrixWorld(true);
  }

  _fade(a) {
    if (Math.abs(a - this.alpha) < 0.002) return;
    this.alpha = a;
    for (const r of this.recs) {
      r.m.opacity = r.o * a;
      const need = r.t || a < 0.999;
      if (need !== r.cur) {
        r.cur = need;
        r.m.transparent = need;
        r.m.needsUpdate = true;
      }
    }
  }

  update(t, dt, P, par) {
    const H = CONFIG.hero;
    this.door.rotation.y = -H.doorAngle * P.door;

    const amp = 1 - clamp(P.door * 1.5, 0, 1);
    this.group.rotation.y = damp(this.group.rotation.y, par.x * H.parallaxY * amp, H.parallaxSmooth, dt);
    this.group.rotation.x = damp(this.group.rotation.x, par.y * H.parallaxX * amp, H.parallaxSmooth, dt);

    const out = P.out;
    this.group.position.set(0, -1.1 * out, -6 * out);
    this.group.scale.setScalar(1 - 0.2 * out);
    this.group.visible = out < 0.999;
    this._fade(1 - smoothstep(0.35, 1, out));
    this.group.updateMatrixWorld(true);

    // Các bánh phụ (số lượng còn lại) bám theo tủ rồi biến mất khi bánh chính bay ra
    const ef = 1 - smoothstep(0, 0.3, P.fly);
    for (const it of this.items) {
      for (const ex of it.extras) {
        ex.anchor.getWorldPosition(ex.obj.position);
        ex.anchor.getWorldQuaternion(ex.obj.quaternion);
        ex.obj.scale.setScalar(ex.scale * ef);
        ex.obj.visible = ef > 0.001;
      }
      if (it.badge) {
        it.badge.visible = ef > 0.01;
        it.badge.material.opacity = ef * this.alpha;
      }
    }

    // Sương
    for (const s of this.mist) {
      const k = s.userData;
      s.position.x = k.x + Math.sin(t * 0.25 + k.ph) * 0.12;
      s.material.opacity = k.base * (0.75 + 0.25 * Math.sin(t * 0.7 + k.ph)) * (k.outside ? P.door : 1) * this.alpha;
      const sc = k.sc * (1 + 0.08 * Math.sin(t * 0.5 + k.ph));
      s.scale.set(sc, sc * 0.55, 1);
    }
  }

  dispose() {
    this.scene.remove(this.group, this.itemsGroup);
    disposeObject(this.group);
    disposeObject(this.itemsGroup);
    this.items = [];
    this.mist = [];
  }
}
