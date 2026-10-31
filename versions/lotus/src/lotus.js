import * as THREE from '../../../vendor/three/three.module.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 三套配色共享同一套几何，切色只改颜色，不重建粒子。 */
const SCHEMES = [
  {
    name: '粉紫',
    base: new THREE.Color('#5b2469'),
    mid: new THREE.Color('#c469c4'),
    edge: new THREE.Color('#f6b4e9'),
    highlight: new THREE.Color('#ffe1f7'),
    heart: new THREE.Color('#ffd9b5'),
  },
  {
    name: '蓝紫',
    base: new THREE.Color('#211d5d'),
    mid: new THREE.Color('#6977e6'),
    edge: new THREE.Color('#b9c7ff'),
    highlight: new THREE.Color('#eef1ff'),
    heart: new THREE.Color('#d8d5ff'),
  },
  {
    name: '暖金',
    base: new THREE.Color('#5b3515'),
    mid: new THREE.Color('#d69a46'),
    edge: new THREE.Color('#ffdfa1'),
    highlight: new THREE.Color('#fff6dc'),
    heart: new THREE.Color('#fff0c3'),
  },
];

/* 四层花瓣：外圈舒展，内圈直立合抱。数量合计约 8 万。 */
const LAYERS = [
  { petals: 12, per: 2600, r0: 0.34, len: 2.45, base: 0.0, rise: 0.88, droop: 0.12, width: 0.64, cup: 0.62 },
  { petals: 10, per: 2300, r0: 0.28, len: 1.95, base: 0.08, rise: 1.1, droop: 0.08, width: 0.55, cup: 0.74 },
  { petals: 8, per: 1900, r0: 0.22, len: 1.45, base: 0.18, rise: 1.36, droop: 0.04, width: 0.47, cup: 0.82 },
  { petals: 6, per: 1050, r0: 0.14, len: 0.78, base: 0.36, rise: 1.3, droop: 0.0, width: 0.3, cup: 0.66 },
];

/* 莲花花瓣：基部窄、腹部宽、尖端收成一点。 */
function petalWidth(s) {
  const base = clamp01(s / 0.08);
  const body = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.58)), 0.58);
  return body * (0.2 + 0.8 * Math.sqrt(base));
}

function colorFor(scheme, layer, s, uAbs, rnd) {
  const c = scheme.base.clone().lerp(scheme.mid, 0.18 + s * 0.74 + layer * 0.035);
  c.lerp(scheme.edge, Math.max(0, s - 0.62) * 0.85 + layer * 0.02);
  if (uAbs > 0.84) c.lerp(scheme.highlight, 0.2 + 0.2 * s);
  c.lerp(scheme.highlight, 0.02 + layer * 0.01);
  c.offsetHSL((rnd() - 0.5) * 0.01, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.05);
  return c;
}

/**
 * 8 万粒子莲花。花瓣、花心同属一个 BufferGeometry，三套配色以属性存放，
 * 开合与色彩都在 GPU 内插值，所以手势变化时没有重建或闪断。
 */
export function buildLotus(quality = 1) {
  const rnd = mulberry32(0x10a7);
  const scale = Math.max(0.2, quality);

  const bud = [], open = [], colorA = [], colorB = [], colorC = [];
  const size = [], seed = [], delay = [];

  const push = (b, o, colors, sz, dl, sd) => {
    bud.push(b[0], b[1], b[2]);
    open.push(o[0], o[1], o[2]);
    colorA.push(colors[0].r, colors[0].g, colors[0].b);
    colorB.push(colors[1].r, colors[1].g, colors[1].b);
    colorC.push(colors[2].r, colors[2].g, colors[2].b);
    size.push(sz);
    delay.push(dl);
    seed.push(sd);
  };

  const buildLayer = (layer) => {
    const cfg = LAYERS[layer];
    const petals = cfg.petals;
    const count = Math.max(60, Math.round(cfg.per * scale));
    const phase = rnd() * TAU;
    const jitter = [];
    for (let p = 0; p < petals; p++) {
      jitter.push({
        turn: (rnd() - 0.5) * 0.055,
        len: 0.93 + rnd() * 0.13,
        rise: 0.92 + rnd() * 0.15,
        lift: (rnd() - 0.5) * 0.08,
      });
    }

    for (let p = 0; p < petals; p++) {
      const jit = jitter[p];
      const theta = (p / petals) * TAU + layer * 0.52 + phase + jit.turn;
      for (let i = 0; i < count; i++) {
        let s = 0.02 + rnd() * 0.98;
        let u = rnd() * 2 - 1;
        for (let tries = 0; tries < 6; tries++) {
          const uAbs = Math.abs(u);
          const rim = Math.max(0, (uAbs - 0.6) / 0.4);
          if (rnd() < petalWidth(s) * (0.5 + 0.5 * rim)) break;
          s = 0.02 + rnd() * 0.98;
          u = rnd() * 2 - 1;
        }
        const uAbs = Math.abs(u);
        const wf = petalWidth(s);

        const rad = cfg.r0 + cfg.len * s * jit.len;
        const halfW = cfg.width * wf * jit.len;
        const ang = theta + (u * halfW) / Math.max(0.46, rad * 0.9);
        const rr = rad - 0.06 * u * u * Math.pow(s, 1.4);
        const y = cfg.base + jit.lift
          + cfg.rise * jit.rise * Math.pow(s, 1.18)
          - cfg.droop * Math.pow(s, 3.4)
          + cfg.cup * 0.22 * u * u * (0.3 + 0.7 * s)
          + 0.02 * Math.sin(u * 8.0 + s * 5.0) * s * s;

        const ox = Math.cos(ang) * rr;
        const oz = Math.sin(ang) * rr;
        const oy = y;

        /* 含苞：花瓣螺旋包成一枚尖顶莲苞。 */
        const wrap = theta + 0.95 * s + layer * 0.08;
        const bulge = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + s * 0.88)), 0.78);
        let br = (0.045 + 0.33 * bulge) * (1 - 0.06 * layer);
        br *= 1 - 0.72 * Math.pow(Math.max(0, s - 0.7) / 0.3, 1.25);
        br += u * 0.025 + 0.008 * Math.sin(s * 24 + layer * 2.1);
        const by = -0.18 + Math.pow(s, 0.95) * 1.82;
        const bx = Math.cos(wrap) * br;
        const bz = Math.sin(wrap) * br;

        const colors = SCHEMES.map((scheme) => colorFor(scheme, layer, s, uAbs, rnd));
        const baseSize = (layer === 0 ? 1.05 : 0.92) + rnd() * 0.72;
        const delayV = clamp01(0.08 + layer * 0.12 + (1 - s) * 0.32 + rnd() * 0.16);

        push([bx, by, bz], [ox, oy, oz], colors, baseSize, delayV, rnd());
      }
    }
  };

  buildLayer(0);
  buildLayer(1);
  buildLayer(2);
  buildLayer(3);

  /* 花心：低矮的莲蓬与一圈花丝，形成暖色内核。 */
  const podCount = Math.round(2400 * scale);
  for (let i = 0; i < podCount; i++) {
    const a = rnd() * TAU;
    const r = Math.pow(rnd(), 0.55) * 0.3;
    const y = 0.72 + (1 - r / 0.3) * 0.25 + rnd() * 0.05;
    const colors = SCHEMES.map((scheme) => scheme.mid.clone().lerp(scheme.base, 0.42 + rnd() * 0.28).lerp(scheme.heart, 0.06 + rnd() * 0.08));
    const pos = [Math.cos(a) * r, y, Math.sin(a) * r];
    push(pos, pos, colors, 0.7 + rnd() * 0.6, 0, rnd());
  }
  /* 花心最上层的一点暖光，让深色花心仍然有焦点。 */
  const coreCount = Math.round(500 * scale);
  for (let i = 0; i < coreCount; i++) {
    const a = rnd() * TAU;
    const r = Math.pow(rnd(), 0.7) * 0.13;
    const y = 0.94 + rnd() * 0.1;
    const colors = SCHEMES.map((scheme) => scheme.heart.clone().lerp(scheme.highlight, 0.35 + rnd() * 0.35));
    const pos = [Math.cos(a) * r, y, Math.sin(a) * r];
    push(pos, pos, colors, 0.55 + rnd() * 0.45, 0, rnd());
  }

  const stamenCount = Math.round(1400 * scale);
  for (let i = 0; i < stamenCount; i++) {
    const a = rnd() * TAU;
    const r = 0.18 + Math.pow(rnd(), 0.6) * 0.28;
    const h = Math.pow(rnd(), 0.7);
    const y = 0.62 + h * 0.42;
    const colors = SCHEMES.map((scheme) => scheme.mid.clone().lerp(scheme.edge, 0.45 + rnd() * 0.3));
    const pos = [Math.cos(a) * r * (1 - h * 0.2), y, Math.sin(a) * r * (1 - h * 0.2)];
    push(pos, pos, colors, 0.62 + rnd() * 0.55, 0.02, rnd());
  }

  const count = size.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(open, 3));
  geometry.setAttribute('aBud', new THREE.Float32BufferAttribute(bud, 3));
  geometry.setAttribute('aOpen', new THREE.Float32BufferAttribute(open, 3));
  geometry.setAttribute('aColorA', new THREE.Float32BufferAttribute(colorA, 3));
  geometry.setAttribute('aColorB', new THREE.Float32BufferAttribute(colorB, 3));
  geometry.setAttribute('aColorC', new THREE.Float32BufferAttribute(colorC, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geometry.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius = 8;
  return { geometry, count };
}
