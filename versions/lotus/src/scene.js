import * as THREE from '../../../vendor/three/three.module.js';
import { buildLotus } from './lotus.js';

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
  const flower = new THREE.Group();
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
  flower.add(points);

  const state = {
    bloom: 0.78,
    target: 0.78,
    vel: 0,
    palette: 0,
    paletteTarget: 0,
    time: 0,
    pointer: new THREE.Vector2(0, 0),
    pointerTarget: new THREE.Vector2(0, 0),
    paused: false,
    baseY: 0,
    dprCap: 1.9,
    dprTuned: false,
    fps: 60,
  };

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
    if (portrait) {
      camera.position.set(0, 2.7, 8.8);
      camera.lookAt(0, 0.28, 0);
      flower.scale.setScalar(0.64);
      state.baseY = 0.34;
    } else {
      camera.position.set(0, 3.15, 7.6);
      camera.lookAt(0, 0.05, 0);
      flower.scale.setScalar(1);
      state.baseY = 0;
    }
    camera.updateProjectionMatrix();
    flower.position.y = state.baseY;

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

    const stiffness = 210;
    const damping = 29;
    const accel = (state.target - state.bloom) * stiffness - state.vel * damping;
    state.vel += accel * dt;
    state.bloom += state.vel * dt;
    if (state.bloom < -0.02) { state.bloom = -0.02; state.vel = 0; }
    if (state.bloom > 1.02) { state.bloom = 1.02; state.vel = 0; }

    state.pointer.lerp(state.pointerTarget, 1 - Math.exp(-dt * 5.5));
    state.palette += (state.paletteTarget - state.palette) * (1 - Math.exp(-dt * 8));

    uniforms.uBloom.value = state.bloom;
    uniforms.uPalette.value = clamp(state.palette, 0, 2);
    uniforms.uTime.value = state.time;

    /* 手掌移动时整朵莲花平移跟随，形态保持不变。 */
    flower.position.x = state.pointer.x * 0.62;
    flower.position.y = state.baseY + state.pointer.y * 0.42 + Math.sin(state.time * 0.45) * 0.01 * uniforms.uMotion.value;
    flower.rotation.x = 0.24;
    flower.rotation.y = state.pointer.x * 0.08;
    flower.rotation.z = Math.sin(state.time * 0.28) * 0.008 * uniforms.uMotion.value;
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
      state.target = clamp(Number(value) || 0, 0, 1);
    },
    jumpTo(value) {
      state.target = clamp(Number(value) || 0, 0, 1);
      state.bloom = state.target;
      state.vel = 0;
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
    getTarget() { return state.target; },
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
