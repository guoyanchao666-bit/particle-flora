import * as THREE from '../../../vendor/three/three.module.js';
import { buildLotus } from './lotus.js';
import { bloomFromOpenness, damp, stepAngle } from './signal.js';

const TAU = Math.PI * 2;
const FLOWER_CENTER_Y = 0.9;

const vertexShader = /* glsl */ `
precision highp float;

attribute vec3 aBud;
attribute vec3 aOpen;
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute vec3 aColorC;
attribute float aSize;
attribute float aSeed;
attribute float aDelay;

uniform float uBloom;
uniform float uPalette;
uniform float uTime;
uniform float uFocal;
uniform float uMotion;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float open = clamp((uBloom - aDelay * 0.12) / 0.62, 0.0, 1.0);
  open = open * open * (3.0 - 2.0 * open);
  vec3 pos = mix(aBud, aOpen, open);

  /* 花瓣呼吸与光点游移都很轻，避免破坏花瓣轮廓。 */
  pos.x += sin(uTime * 0.5 + aSeed * 6.2831 + pos.y * 1.3) * 0.006 * uMotion;
  pos.y += cos(uTime * 0.4 + aSeed * 5.1) * 0.004 * uMotion;
  pos.z += sin(uTime * 0.36 + aSeed * 4.2) * 0.005 * uMotion;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = aSize * mix(0.55, 1.0, open);
  gl_PointSize = clamp(size * uFocal / max(0.8, -mv.z), 1.0, 16.0);

  vec3 colA = aColorA;
  vec3 colB = aColorB;
  vec3 colC = aColorC;
  vec3 col = uPalette < 1.0
    ? mix(colA, colB, smoothstep(0.0, 1.0, uPalette))
    : mix(colB, colC, smoothstep(1.0, 2.0, uPalette));

  vColor = col * mix(0.72, 1.06, open);
  vAlpha = mix(0.55, 0.96, open) * (0.64 + 0.36 * aSeed);
  vAlpha *= 0.92 + 0.08 * sin(uTime * 2.0 + aSeed * 33.0) * uMotion;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d2 = dot(q, q);
  if (d2 > 0.25) discard;
  float d = sqrt(d2);
  float halo = smoothstep(0.5, 0.08, d);
  float core = pow(max(0.0, 1.0 - d * 2.0), 2.4);
  vec3 col = vColor * (0.94 + 0.26 * core);
  gl_FragColor = vec4(col, halo * vAlpha);
  #include <colorspace_fragment>
}
`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createLotus(canvas, options = {}) {
  const onStats = options.onStats || null;
  const onContextLost = options.onContextLost || null;
  const quality = options.quality || 1;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: false,
  });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('WEBGL2_UNAVAILABLE');
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x030203, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

  /* 层级：flower 负责固定俯角与位移 → pivot 把原点抬到花心 → roll 绕花心旋转。
     粒子局部坐标再下移同样的高度，roll=0 时画面与改动前完全一致。 */
  const flower = new THREE.Group();
  const pivot = new THREE.Group();
  const roll = new THREE.Group();
  pivot.position.y = FLOWER_CENTER_Y;
  flower.rotation.x = 0.24;
  flower.add(pivot);
  pivot.add(roll);
  scene.add(flower);

  const uniforms = {
    uBloom: { value: 0.78 },
    uPalette: { value: 0 },
    uTime: { value: 0 },
    uFocal: { value: 28 },
    uMotion: { value: 1 },
  };

  let { geometry, count } = buildLotus(quality);
  let currentQuality = quality;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.position.y = -FLOWER_CENTER_Y;
  roll.add(points);

  const state = {
    bloom: 0.78,
    manualTarget: 0.78,
    smoothOpen: 0.745,
    openTarget: 0.745,
    rawOpenness: 0,
    handActive: false,
    handPresent: false,
    seenHand: false,
    lastHandAt: 0,
    roll: 0,
    rollTarget: 0,
    rollConfidence: 1,
    palette: 0,
    paletteTarget: 0,
    time: 0,
    pointer: new THREE.Vector2(0, 0),
    pointerTarget: new THREE.Vector2(0, 0),
    pos: new THREE.Vector2(0, 0),
    posTarget: new THREE.Vector2(0, 0),
    centerWorld: new THREE.Vector3(),
    palmWorld: new THREE.Vector3(),
    paused: false,
    baseY: 0,
    dprCap: 1.9,
    dprTuned: false,
    fps: 60,
  };

  /* 把归一化屏幕坐标投到花朵所在的 z=0 平面，得到掌心对应的世界坐标。 */
  const ndc = new THREE.Vector3();
  const ray = new THREE.Vector3();
  function pointOnPlane(x, y, out) {
    ndc.set(clamp(x, -1, 1), clamp(y, -1, 1), 0.5).unproject(camera);
    ray.copy(ndc).sub(camera.position).normalize();
    const t = -camera.position.z / (ray.z || -1e-4);
    out.copy(camera.position).addScaledVector(ray, t);
    return out;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  uniforms.uMotion.value = reduced.matches ? 0 : 1;
  reduced.addEventListener?.('change', (event) => {
    uniforms.uMotion.value = event.matches ? 0 : 1;
  });

  let ready = false;

  function layout() {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const aspect = w / h;
    const portrait = aspect < 0.82;

    const maxDpr = portrait ? 2 : 1.9;
    if (!state.dprTuned) {
      state.dprCap = maxDpr;
      state.dprTuned = true;
    }
    state.dprCap = Math.min(state.dprCap, maxDpr);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.dprCap));
    renderer.setSize(w, h, false);

    camera.aspect = aspect;
    camera.fov = portrait ? 54 : 40;
    /* 机位压到花瓣上沿附近：俯角变小，四层花瓣的前后遮挡与高度差才读得出来；
       仍保留一点俯角，花心与莲蓬不被外圈完全挡住。 */
    if (portrait) {
      camera.position.set(0, 2.25, 8.9);
      camera.lookAt(0, 0.4, 0);
      flower.scale.setScalar(0.64);
      state.baseY = 0.34;
    } else {
      camera.position.set(0, 2.55, 7.7);
      camera.lookAt(0, 0.2, 0);
      flower.scale.setScalar(1);
      state.baseY = 0;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    flower.position.y = state.baseY;
    pointOnPlane(0, 0, state.centerWorld);

    uniforms.uFocal.value =
      (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / 51;
  }

  layout();

  let last = performance.now();
  let frames = 0;
  let statAt = last;
  let lowSamples = 0;

  function update(dt) {
    state.time += dt;
    const now = performance.now();

    /* 1. 三通道分别做帧率无关平滑：位置 / 掌旋 / 张开度。 */
    if (state.handActive) {
      const lost = state.seenHand && !state.handPresent && now - state.lastHandAt > 350;
      if (lost) {
        state.openTarget = 0;
        state.rollTarget = 0;
        state.rollConfidence = 1;
      }
      state.smoothOpen = damp(state.smoothOpen, state.openTarget, lost ? 1.0 : 8.0, dt);
      state.roll = stepAngle(state.roll, state.rollTarget, state.rollConfidence, dt);
    } else {
      state.roll = stepAngle(state.roll, 0, 1, dt);
    }

    state.pointer.x = damp(state.pointer.x, state.pointerTarget.x, 9.0, dt);
    state.pointer.y = damp(state.pointer.y, state.pointerTarget.y, 9.0, dt);

    /* 2. 掌心屏幕位移按 0.75 / 0.5 的跟手增益映射到世界坐标；
          横向上限随张开度收紧（全开时花瓣更大），保证花心跟随但不裁掉花瓣。 */
    pointOnPlane(state.pointer.x, state.pointer.y, state.palmWorld);
    const maxX = 1.9 - 0.7 * state.bloom;
    const maxY = 0.66 - 0.18 * state.bloom;
    const dx = clamp((state.palmWorld.x - state.centerWorld.x) * 0.75, -maxX, maxX);
    const dy = clamp((state.palmWorld.y - state.centerWorld.y) * 0.5, -maxY, maxY);
    state.posTarget.set(dx, dy);
    state.pos.x = damp(state.pos.x, state.posTarget.x, 8.0, dt);
    state.pos.y = damp(state.pos.y, state.posTarget.y, 8.0, dt);

    /* 3. 平滑后的张开度走两段式映射；手动模式直接用手动目标。 */
    const bloomTarget = state.handActive ? bloomFromOpenness(state.smoothOpen) : state.manualTarget;
    state.bloom = damp(state.bloom, bloomTarget, 7.0, dt);

    state.palette += (state.paletteTarget - state.palette) * (1 - Math.exp(-dt * 8));

    uniforms.uBloom.value = state.bloom;
    uniforms.uPalette.value = clamp(state.palette, 0, 2);
    uniforms.uTime.value = state.time;

    /* 4. 先绕花心旋转，再平移到掌心；花心不因旋转而移动。 */
    flower.position.x = state.pos.x;
    flower.position.y = state.baseY + state.pos.y + Math.sin(state.time * 0.45) * 0.01 * uniforms.uMotion.value;
    flower.rotation.y = state.pointer.x * 0.08;
    roll.rotation.z = state.roll + Math.sin(state.time * 0.28) * 0.008 * uniforms.uMotion.value;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!state.paused && document.visibilityState !== 'hidden') {
      update(dt);
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        options.onReady?.();
      }
      frames++;
    }

    if (now - statAt > 800) {
      const fps = Math.round((frames * 1000) / Math.max(1, now - statAt));
      state.fps = fps;
      if (fps < 44) {
        lowSamples++;
        if (lowSamples >= 3 && state.dprCap > 1.0) {
          state.dprCap = Math.max(1, state.dprCap - 0.25);
          lowSamples = 0;
          layout();
        }
      } else {
        lowSamples = 0;
      }
      onStats?.({ fps, particles: count, bloom: state.bloom });
      frames = 0;
      statAt = now;
    }
  }

  renderer.setAnimationLoop(frame);

  const onLost = (event) => {
    event.preventDefault();
    state.paused = true;
    onContextLost?.();
  };
  const onRestored = () => {
    state.paused = false;
    layout();
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, 90);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });

  return {
    setTarget(value) {
      state.handActive = false;
      state.handPresent = false;
      state.seenHand = false;
      state.manualTarget = clamp(Number(value) || 0, 0, 1);
    },
    jumpTo(value) {
      state.handActive = false;
      state.handPresent = false;
      state.seenHand = false;
      state.manualTarget = clamp(Number(value) || 0, 0, 1);
      state.bloom = state.manualTarget;
    },
    setHandFrame(frame = {}) {
      if (!frame.present) {
        if (state.handActive) state.handPresent = false;
        return;
      }
      const raw = Number(frame.openness);
      if (!Number.isFinite(raw)) return;
      state.handActive = true;
      state.handPresent = true;
      state.seenHand = true;
      state.lastHandAt = performance.now();
      state.rawOpenness = clamp(raw, 0, 1);
      state.openTarget = state.rawOpenness;

      const x = Number(frame.x);
      const y = Number(frame.y);
      if (Number.isFinite(x)) state.pointerTarget.x = clamp(x, -1, 1);
      if (Number.isFinite(y)) state.pointerTarget.y = clamp(y, -1, 1);

      const angle = Number(frame.rotation);
      if (Number.isFinite(angle)) {
        let a = angle;
        while (a - state.rollTarget > Math.PI) a -= TAU;
        while (a - state.rollTarget < -Math.PI) a += TAU;
        state.rollTarget = clamp(a, -1.35, 1.35);
      }
      const conf = Number(frame.rotationConfidence);
      if (Number.isFinite(conf)) state.rollConfidence = clamp(conf, 0.2, 1);
    },
    setHandActive(active) {
      state.handActive = Boolean(active);
      state.handPresent = false;
      state.seenHand = false;
      if (state.handActive) {
        state.lastHandAt = performance.now();
      } else {
        state.manualTarget = state.bloom;
        state.openTarget = state.smoothOpen;
        state.rollTarget = 0;
        state.rollConfidence = 1;
      }
    },
    setPalette(index) {
      state.paletteTarget = clamp(Number(index) || 0, 0, 2);
    },
    setQuality(value) {
      const nextQuality = clamp(Number(value) || 1, 0.2, 1.6);
      if (Math.abs(nextQuality - currentQuality) < 0.0001) return;
      currentQuality = nextQuality;
      const next = buildLotus(currentQuality);
      const previous = geometry;
      geometry = next.geometry;
      count = next.count;
      points.geometry = geometry;
      previous.dispose();
      onStats?.({ fps: state.fps, particles: count, bloom: state.bloom });
    },
    setPointer(x, y) {
      state.pointerTarget.set(clamp(x, -1, 1), clamp(y, -1, 1));
    },
    setMotion(value) { uniforms.uMotion.value = value ? 1 : 0; },
    getBloom() { return state.bloom; },
    getTarget() { return state.handActive ? state.bloom : state.manualTarget; },
    isHandActive() { return state.handActive; },
    gesture() {
      return {
        raw: state.rawOpenness,
        smooth: state.smoothOpen,
        bloom: state.bloom,
        rotation: state.roll,
        confidence: state.rollConfidence,
        active: state.handActive,
        present: state.handPresent,
      };
    },
    mapOpenness(value) { return bloomFromOpenness(value); },
    stats() { return { fps: state.fps, particles: count, palette: Math.round(state.palette) }; },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
