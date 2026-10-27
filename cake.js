import * as THREE from 'three';
import { TAU } from './utils.js';

/**
 * cake.js — dựng bánh bằng hình học thủ tục (không cần file 3D).
 * Mỗi sản phẩm có cột `type`: round | cupcake | roll | bread | donut
 * Hoặc có cột `image` (PNG tách nền) → dùng tấm ảnh phẳng.
 * Kết quả: Group { spin (nhóm xoay), userData.hh (nửa chiều cao) }.
 */

const SEG = () => (window.innerWidth < 768 ? 28 : 48);

function shade(hex, dl) {
  const c = new THREE.Color(hex);
  const h = {};
  c.getHSL(h);
  c.setHSL(h.h, h.s, THREE.MathUtils.clamp(h.l + dl, 0.03, 0.97));
  return c;
}
const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.55, metalness: 0 }, o));
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/* ---------- Bánh tròn nhiều tầng (tiramisu, red velvet...) ---------- */
function round(g, color) {
  const S = SEG();
  const R = 0.5;
  const sponge = phys(shade(color, -0.12), { roughness: 0.85 });
  const cream = phys('#fff5e1', { roughness: 0.45, clearcoat: 0.25 });
  const glaze = phys(color, { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  let y = 0;
  const layer = (r, h, mat) => {
    g.add(mesh(new THREE.CylinderGeometry(r, r, h, S), mat, 0, y + h / 2, 0));
    y += h;
  };
  layer(R, 0.13, sponge);
  layer(R * 1.015, 0.05, cream);
  layer(R, 0.13, sponge);
  layer(R * 1.015, 0.05, cream);
  layer(R, 0.13, sponge);
  layer(R * 1.02, 0.05, glaze);
  const dollop = new THREE.SphereGeometry(0.07, 16, 12);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const m = mesh(dollop, cream, Math.cos(a) * R * 0.78, y + 0.03, Math.sin(a) * R * 0.78);
    m.scale.y = 0.8;
    g.add(m);
  }
  const berry = phys(shade(color, -0.25), { roughness: 0.25, clearcoat: 1 });
  const bg = new THREE.SphereGeometry(0.06, 16, 12);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    g.add(mesh(bg, berry, Math.cos(a) * R * 0.42, y + 0.05, Math.sin(a) * R * 0.42));
  }
  g.add(mesh(new THREE.ConeGeometry(0.1, 0.14, 16), cream, 0, y + 0.07, 0));
  const H = y + 0.14;
  g.position.y = -H / 2;
  return H / 2;
}

/* ---------- Cupcake ---------- */
function cupcake(g, color) {
  const S = SEG();
  const wrapMat = phys(shade(color, -0.2), { roughness: 0.7, side: THREE.DoubleSide });
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.25, 0.28, S, 1, true), wrapMat, 0, 0.14, 0));
  g.add(mesh(new THREE.CircleGeometry(0.25, S), wrapMat, 0, 0.002, 0).rotateX(Math.PI / 2));
  const pts = [
    [0, 0], [0.35, 0], [0.37, 0.05], [0.32, 0.11], [0.33, 0.15], [0.25, 0.2],
    [0.26, 0.24], [0.16, 0.29], [0.17, 0.32], [0.08, 0.37], [0.02, 0.42], [0, 0.43],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const frost = phys(color, { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  g.add(mesh(new THREE.LatheGeometry(pts, S), frost, 0, 0.28, 0));
  g.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), phys('#c62839', { roughness: 0.2, clearcoat: 1 }), 0, 0.28 + 0.46, 0));
  const H = 0.78;
  g.position.y = -H / 2;
  return H / 2;
}

/* ---------- Bánh cuộn (bông lan cuộn) ---------- */
function spiralTexture(colorHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const col = '#' + new THREE.Color(colorHex).getHexString();
  const crust = '#' + shade(colorHex, -0.22).getHexString();
  x.fillStyle = '#fff3d6';
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = col;
  x.lineWidth = 20;
  x.lineCap = 'round';
  x.beginPath();
  for (let a = 0; a < TAU * 3.2; a += 0.05) {
    const r = (a / TAU) * 38;
    const px = 128 + Math.cos(a) * r;
    const py = 128 + Math.sin(a) * r;
    if (a === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.stroke();
  x.strokeStyle = crust;
  x.lineWidth = 12;
  x.beginPath();
  x.arc(128, 128, 122, 0, TAU);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function roll(g, color) {
  const S = SEG();
  const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, S);
  geo.rotateZ(Math.PI / 2);
  const side = phys(shade(color, -0.05), { roughness: 0.75 });
  const cap = phys('#ffffff', { map: spiralTexture(color), roughness: 0.7 });
  g.add(new THREE.Mesh(geo, [side, cap, cap]));
  g.rotation.y = 0.9;
  return 0.3;
}

/* ---------- Bánh mì / ổ bánh ---------- */
function bread(g, color) {
  const S = SEG();
  const crust = phys(color, { roughness: 0.8, clearcoat: 0.1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, S, 24), crust);
  body.scale.set(0.55, 0.33, 0.36);
  g.add(body);
  const cut = phys(shade(color, 0.18), { roughness: 0.9 });
  const cg = new THREE.BoxGeometry(0.2, 0.02, 0.07);
  [-0.26, -0.09, 0.09, 0.26].forEach((x) => {
    const y = 0.33 * Math.sqrt(1 - (x / 0.55) * (x / 0.55)) - 0.005;
    const m = mesh(cg, cut, x, y, 0);
    m.rotation.z = -x * 0.8;
    m.rotation.y = 0.5;
    g.add(m);
  });
  return 0.33;
}

/* ---------- Donut ---------- */
function donut(g, color) {
  const S = SEG();
  const dough = phys('#e6b673', { roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.15, 24, S), dough);
  base.rotation.x = Math.PI / 2;
  g.add(base);
  const ig = new THREE.TorusGeometry(0.34, 0.162, 24, S);
  ig.rotateX(Math.PI / 2);
  const pos = ig.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, 0);
  ig.computeVertexNormals();
  const icing = new THREE.Mesh(ig, phys(color, { roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.2 }));
  icing.position.y = 0.012;
  g.add(icing);
  const palette = ['#ffffff', '#ffd54a', '#e8567a', '#5ec2a0'].map((c) => phys(c, { roughness: 0.5 }));
  const sg = new THREE.BoxGeometry(0.07, 0.02, 0.02);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + (i % 3) * 0.1;
    const phi = Math.PI / 2 + (((i * 37) % 10) / 10 - 0.5) * 1.5;
    const rad = 0.34 + 0.172 * Math.cos(phi);
    const m = mesh(sg, palette[i % 4], Math.cos(a) * rad, 0.172 * Math.sin(phi) + 0.014, Math.sin(a) * rad);
    m.rotation.y = a + 1.2 * ((i % 5) - 2);
    g.add(m);
  }
  return 0.19;
}

/* ---------- Ảnh PNG tách nền (tuỳ chọn) ---------- */
function image(g, p) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const tex = loader.load(p.image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.02, toneMapped: false });
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), mat));
  return 0.62;
}

const BUILDERS = { round, cupcake, roll, bread, donut };

export function makeProduct(p) {
  const spin = new THREE.Group();
  const inner = new THREE.Group();
  spin.add(inner);
  const obj = new THREE.Group();
  obj.add(spin);
  let hh;
  if (p.image) {
    hh = image(inner, p);
    obj.userData.flat = true;
  } else {
    hh = (BUILDERS[p.type] || BUILDERS.round)(inner, p.color);
  }
  obj.userData.hh = hh;
  obj.spin = spin; // không đặt vào userData vì clone() sẽ serialize
  return obj;
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}
