import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TAU, clamp, lerp, damp, smoothstep, easeInOut, radialTexture, isMobile } from './utils.js';

/**
 * carousel.js — bánh bay từ kệ ra vòng tròn 3D nghiêng quanh trục đứng,
 * xoay có quán tính, bánh giữa phóng to, bánh xa nhỏ + mờ (sương/fog).
 * Nguồn sự thật duy nhất: P.spin (0..1) do cuộn trang điều khiển.
 */
export class Carousel {
  constructor(scene, fridge) {
    this.scene = scene;
    this.fridge = fridge;
    this.items = fridge.items;
    this.current = 0;
    this.active = 0;
    this.m = { R: 4, tilt: 0.26, camDist: 5.8, frontY: -1, frontZ: 3.8, mob: false };
    this.vA = new THREE.Vector3();
    this.vB = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.qId = new THREE.Quaternion();
    this.shadowTex = radialTexture('rgba(30,20,10,0.55)', 'rgba(30,20,10,0)', 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0, fog: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
    this.items.forEach((it, i) => {
      it.spinAngle = i * 0.9;
    });
  }

  /** Tính bán kính và vị trí trước của vòng tròn theo tỉ lệ khung hình (dùng clamp). */
  computeMetrics(aspect) {
    const c = CONFIG.carousel;
    const mob = isMobile();
    const R = mob ? c.radiusMobile : clamp((c.radius * aspect) / CONFIG.camera.refAspect, c.radiusMin, c.radiusMax);
    const tilt = c.tilt;
    this.m = {
      R, tilt, mob,
      camDist: mob ? c.camDistMobile : c.camDist,
      frontY: -R * Math.sin(tilt),
      frontZ: R * Math.cos(tilt),
    };
    return this.m;
  }

  update(time, dt, P) {
    const c = CONFIG.carousel;
    const N = this.items.length;
    if (!N) return;
    const m = this.m;
    const step = N > 1 ? TAU / N : 0;
    const target = P.spin * Math.max(0, N - 1);
    this.current = damp(this.current, target, c.follow, dt);
    this.active = clamp(Math.round(this.current), 0, N - 1);

    const stag = N > 1 ? c.stagger / (N - 1) : 0;
    const denom = Math.max(0.0001, 1 - (N - 1) * stag);
    const mul = m.mob ? c.mobileScaleMul : 1;

    for (let i = 0; i < N; i++) {
      const it = this.items[i];
      const obj = it.obj;

      // Vị trí / hướng bắt đầu: ô kệ trong tủ
      it.anchor.getWorldPosition(this.vA);
      it.anchor.getWorldQuaternion(this.q);

      // Vị trí trên vòng tròn nghiêng
      const a = (i - this.current) * step;
      const cosA = Math.cos(a);
      const sz = cosA * m.R;
      this.vB.set(Math.sin(a) * m.R, -sz * Math.sin(m.tilt), sz * Math.cos(m.tilt));
      const focus = smoothstep(0.6, 1, cosA);
      const ringScale = lerp(c.farScale, c.centerScale, focus) * mul;

      // Tiến trình bay riêng từng bánh (so le)
      const tt = clamp((P.fly - i * stag) / denom, 0, 1);
      const e = easeInOut(tt);
      const arc = Math.sin(Math.PI * e);

      obj.position.lerpVectors(this.vA, this.vB, e);
      obj.position.z += arc * c.arc;
      obj.position.y += arc * 0.5 + Math.sin(time * 1.3 + i) * c.bob * focus * e;
      obj.scale.setScalar(Math.max(0.0001, lerp(it.baseScale, ringScale, e)));
      obj.visible = obj.scale.x > 0.001;
      obj.quaternion.copy(this.q).slerp(this.qId, e);

      // Tự xoay nhẹ (mạnh hơn ở bánh giữa) + nghiêng về camera
      it.spinAngle += c.autoSpin * (0.25 + 0.75 * focus) * dt;
      const spinY = obj.userData.flat ? Math.sin(it.spinAngle * 0.5) * 0.35 : it.spinAngle;
      obj.spin.rotation.y = spinY * e;
      obj.spin.rotation.x = c.itemTilt * e;
    }

    // Bóng tiếp xúc mềm dưới bánh giữa
    const near = this.items[this.active];
    const frac = Math.abs(this.current - Math.round(this.current));
    const appear = smoothstep(0.85, 1, P.fly);
    const cs = c.centerScale * mul;
    this.shadow.material.opacity = appear * (1 - clamp(frac * 2.2, 0, 1)) * 0.55;
    this.shadow.position.set(0, m.frontY - near.obj.userData.hh * cs - 0.18, m.frontZ);
    this.shadow.scale.set(cs * 1.4, cs * 1.4, 1);
  }

  dispose() {
    this.scene.remove(this.shadow);
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.shadowTex.dispose();
  }
}
