import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';
import { clamp, lerp, damp, isMobile } from './utils.js';

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

/** Giá trị parallax chuẩn hoá -1..1 từ chuột hoặc con quay hồi chuyển. */
export const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

function bindParallax() {
  window.addEventListener('pointermove', (e) => {
    parallax.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    parallax.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    parallax.tx = clamp(e.gamma / 25, -1, 1);
    parallax.ty = clamp((e.beta - 45) / 25, -1, 1);
  };
  const enable = async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return;
      }
      window.addEventListener('deviceorientation', onOrient, { passive: true });
    } catch (err) {
      /* người dùng từ chối: bỏ qua */
    }
  };
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window) {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS: phải xin quyền trong một thao tác chạm
      window.addEventListener('click', enable, { once: true });
    } else {
      enable();
    }
  }
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: CONFIG.render.antialias,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.lights.exposure;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf6efdf, 300, 600);

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 100);

  /* ===== Ánh sáng: HDRI studio + đèn chính + ánh sáng môi trường ===== */
  const L = CONFIG.lights;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = L.env;
  if (L.hdrUrl) {
    import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
      new RGBELoader().load(L.hdrUrl, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
      });
    }).catch(() => {});
  }
  const key = new THREE.DirectionalLight(new THREE.Color(L.keyColor), L.keyIntensity);
  key.position.set(...L.keyPos);
  const fill = new THREE.DirectionalLight(new THREE.Color(L.fillColor), L.fillIntensity);
  fill.position.set(...L.fillPos);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe8dcc0, L.hemiIntensity);
  scene.add(key, fill, hemi);

  /* ===== DPR thích ứng ===== */
  const maxDpr = () => Math.min(window.devicePixelRatio || 1, isMobile() ? CONFIG.render.maxDprMobile : CONFIG.render.maxDpr);
  let dpr = maxDpr();
  renderer.setPixelRatio(dpr);

  /* ===== Camera / tư thế ===== */
  const dims = { W: 2, H: 3.2, D: 1.1 };
  const hero = { pos: new THREE.Vector3(0, 0.1, 8), look: new THREE.Vector3(0, 0, 0) };
  const ring = { pos: new THREE.Vector3(0, 0, 10), look: new THREE.Vector3(), near: 8, far: 20 };
  const posTmp = new THREE.Vector3();
  const lookTmp = new THREE.Vector3();
  const size = { w: 1, h: 1 };
  let ringMetrics = null;

  function computeHero() {
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fill = isMobile() ? CONFIG.hero.fridgeFillMobile : CONFIG.hero.fridgeFill;
    const dH = dims.H / (2 * fill * tanH);
    const dW = dims.W / (2 * 0.86 * tanH * camera.aspect);
    hero.pos.set(0, 0.1, Math.max(dH, dW) + dims.D / 2);
    hero.look.set(0, 0, 0);
  }

  function computeRing() {
    if (!ringMetrics) return;
    const m = ringMetrics;
    const c = CONFIG.carousel;
    ring.pos.set(0, m.frontY + c.camUp, m.frontZ + m.camDist);
    ring.look.set(0, m.frontY + c.lookDy, m.frontZ);
    ring.near = m.camDist + m.R * c.fogNear;
    ring.far = m.camDist + m.R * c.fogFar;
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    size.w = w;
    size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // FOV tự điều chỉnh theo tỉ lệ khung hình (kẹp bằng clamp)
    camera.fov = clamp(CONFIG.camera.fov * Math.pow(CONFIG.camera.refAspect / camera.aspect, 0.45), CONFIG.camera.fovMin, CONFIG.camera.fovMax);
    camera.updateProjectionMatrix();
    computeHero();
    computeRing();
  }

  return {
    renderer, scene, camera,
    resize,
    get width() { return size.w; },
    get height() { return size.h; },
    aspect: () => camera.aspect,
    setDims(d) { Object.assign(dims, d); computeHero(); },
    setRing(m) { ringMetrics = m; computeRing(); },

    updateParallax(dt) {
      parallax.x = damp(parallax.x, parallax.tx, 6, dt);
      parallax.y = damp(parallax.y, parallax.ty, 6, dt);
    },

    applyCamera(P) {
      const cb = P.cam;
      posTmp.lerpVectors(hero.pos, ring.pos, cb);
      lookTmp.lerpVectors(hero.look, ring.look, cb);
      posTmp.z -= CONFIG.hero.dolly * P.hero * (1 - cb);
      posTmp.x += parallax.x * 0.35 * cb;
      posTmp.y += parallax.y * 0.2 * cb;
      camera.position.copy(posTmp);
      camera.lookAt(lookTmp);
    },

    /** Sương khoảng cách: giả lập độ sâu trường ảnh, màu sương = màu nền hiện tại. */
    setFog(cb, rgb) {
      const f = scene.fog;
      f.near = lerp(300, ring.near, cb);
      f.far = lerp(600, ring.far, cb);
      f.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
    },

    getDpr: () => dpr,
    maxDpr,
    setDpr(v) {
      dpr = v;
      renderer.setPixelRatio(dpr);
      renderer.setSize(size.w, size.h, false);
    },
    render() { renderer.render(scene, camera); },
  };
}

export { bindParallax };
