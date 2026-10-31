import * as THREE from '../../../vendor/three/three.module.js';
import { buildFlower } from './flower.js';

const vertexShader = /* glsl */ `
precision highp float;

attribute vec3 aBud;
attribute vec3 aOpen;
attribute vec3 aStar;
attribute vec3 aColor;
attribute vec3 aStarColor;
attribute float aSize;
attribute float aSeed;
attribute float aDelay;
attribute float aScatterDelay;
attribute float aScatter;
attribute float aKind;
attribute float aEdge;

uniform float uBloom;
uniform float uScatter;
uniform float uTime;
uniform float uFocal;
uniform float uMotion;
uniform vec2 uSpread;
uniform vec2 uPointer;

varying vec3 vColor;
varying float vAlpha;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

void main() {
  /* 三个状态共用一套粒子：花苞 -> 花冠 -> 星场，全部在 GPU 内连续插值。 */
  float open = clamp((uBloom - aDelay * 0.08) / 0.52, 0.0, 1.0);
  open = open * open * (3.0 - 2.0 * open);

  vec3 pos = mix(aBud, aOpen, open);

  /* 星场按当前视口实时展开，任何屏幕比例都能铺满画布。 */
  vec3 sp = aStar;
  sp.xy *= uSpread;
  sp.xy = rot2(uTime * 0.0042 + uPointer.x * 0.03) * sp.xy;
  sp.xy += uPointer * vec2(0.15, 0.11);
  sp.z += sin(uTime * 0.21 + aSeed * 6.2831) * 0.32 * uMotion;
  sp.y += cos(uTime * 0.17 + aSeed * 4.7) * 0.1 * uMotion;

  float st = clamp((uScatter - aScatterDelay * 0.42) / 0.58, 0.0, 1.0);
  st = st * st * (3.0 - 2.0 * st) * aScatter;
  pos = mix(pos, sp, st);

  /* 极轻的呼吸，不会打断手势。 */
  float breeze = sin(uTime * 0.55 + aSeed * 6.2831 + pos.y * 0.7);
  pos.x += breeze * 0.009 * uMotion * (0.35 + open * 0.65);
  pos.z += cos(uTime * 0.43 + aSeed * 5.1) * 0.007 * uMotion;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float soft = smoothstep(0.7, 1.0, aEdge);
  float size = aSize * mix(0.7, 1.0, open) * mix(1.0, 0.62 + 0.62 * aSeed, st);
  size *= mix(1.0, 1.0, soft);
  gl_PointSize = clamp(size * uFocal / max(0.8, -mv.z), 1.0, 26.0);

  vColor = mix(aColor, aStarColor, st * 0.92) * mix(0.82, 1.0, open);
  vAlpha = mix(0.5, 0.9, open) * (0.72 + 0.28 * aSeed);
  vAlpha *= mix(1.0, 0.96, soft);
  vAlpha *= 1.0 + 0.26 * sin(uTime * 2.1 + aSeed * 31.0) * st * uMotion;
  /* 星野展开时，茎叶退到背景，让花心成为焦点。 */
  vAlpha *= 1.0 - uScatter * step(1.5, aKind) * 0.65;
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
  float alpha = smoothstep(0.5, 0.06, d);
  float core = pow(max(0.0, 1.0 - d * 2.0), 2.2);
  vec3 col = vColor * (0.96 + 0.1 * core);
  gl_FragColor = vec4(col, alpha * vAlpha);
  #include <colorspace_fragment>
}
`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createGarden(canvas, options = {}) {
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
  renderer.setClearColor(0x130b0c, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  const flower = new THREE.Group();
  scene.add(flower);

  const uniforms = {
    uBloom: { value: 0.55 },
    uScatter: { value: 0 },
    uTime: { value: 0 },
    uFocal: { value: 24 },
    uMotion: { value: 1 },
    uSpread: { value: new THREE.Vector2(5, 3) },
    uPointer: { value: new THREE.Vector2(0, 0) },
  };

  let { geometry, count } = buildFlower(quality);
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
    bloom: 0.55,
    target: 0.55,
    vel: 0,
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
    const dpr = Math.min(window.devicePixelRatio || 1, state.dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    camera.aspect = aspect;
    camera.fov = portrait ? 48 : 40;
    if (portrait) {
      camera.position.set(0, 2.0, 8.5);
      camera.lookAt(0, 0.15, 0);
      flower.scale.setScalar(aspect < 0.62 ? 0.82 : 0.98);
      state.baseY = 0.32;
    } else {
      camera.position.set(0, 2.2, 7.3);
      camera.lookAt(0, -0.42, 0);
      flower.scale.setScalar(1);
      state.baseY = 0;
    }
    camera.updateProjectionMatrix();
    flower.position.y = state.baseY;

    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist;
    const halfW = halfH * aspect;
    uniforms.uSpread.value.set(halfW * 1.24, halfH * 1.24);

    /* PointSize 使用物理像素：除以 58 把世界尺寸换算到当前画布的尺度。 */
    uniforms.uFocal.value =
      (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / 52;
  }

  layout();

  let last = performance.now();
  let frames = 0;
  let statAt = last;
  let lowSamples = 0;

  function update(dt) {
    state.time += dt;

    /* 临界阻尼弹簧：跟随快，不过冲。 */
    const stiffness = 210;
    const damping = 29;
    const accel = (state.target - state.bloom) * stiffness - state.vel * damping;
    state.vel += accel * dt;
    state.bloom += state.vel * dt;
    if (state.bloom < -0.02) { state.bloom = -0.02; state.vel = 0; }
    if (state.bloom > 1.02) { state.bloom = 1.02; state.vel = 0; }

    state.pointer.lerp(state.pointerTarget, 1 - Math.exp(-dt * 5.2));

    uniforms.uBloom.value = state.bloom;
    uniforms.uScatter.value = smoothstep(0.64, 0.99, state.bloom);
    uniforms.uTime.value = state.time;
    uniforms.uPointer.value.copy(state.pointer);

    const tilt = 0.62 * (1 - 0.55 * clamp(state.bloom, 0, 1));
    flower.rotation.x = tilt - state.pointer.y * 0.055;
    flower.rotation.y = state.pointer.x * 0.22;
    flower.rotation.z = state.pointer.x * 0.03 + Math.sin(state.time * 0.33) * 0.01 * uniforms.uMotion.value;
    flower.position.y = state.baseY + Math.sin(state.time * 0.5) * 0.012 * uniforms.uMotion.value;
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

      /* 帧率持续偏低时逐级降低像素比，画面结构不变。 */
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

  const onVisibility = () => {
    last = performance.now();
    if (document.visibilityState === 'visible') state.paused = false;
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setTarget(value) {
      state.target = clamp(Number(value) || 0, 0, 1);
    },
    /** 供“直达形态”使用：直接把当前值推到目标，避免长距离追赶。 */
    jumpTo(value) {
      state.target = clamp(Number(value) || 0, 0, 1);
      state.bloom = state.target;
      state.vel = 0;
    },
    getBloom() { return state.bloom; },
    getTarget() { return state.target; },
    /** 实时调整粒子密度，只替换几何，渲染状态和花朵开合保持不变。 */
    setQuality(value) {
      const nextQuality = clamp(Number(value) || 1, 0.2, 2.4);
      if (Math.abs(nextQuality - currentQuality) < 0.0001) return;
      currentQuality = nextQuality;
      const next = buildFlower(currentQuality);
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
    stats() { return { fps: state.fps, particles: count }; },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
