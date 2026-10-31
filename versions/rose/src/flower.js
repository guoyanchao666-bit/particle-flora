import * as THREE from '../../../vendor/three/three.module.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* 固定种子：每次打开都是同一朵花，形态可复现。 */
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = {
  deep: new THREE.Color('#a82f4f'),
  rose: new THREE.Color('#d95a78'),
  pink: new THREE.Color('#f295ab'),
  peach: new THREE.Color('#ffc2ae'),
  cream: new THREE.Color('#fff3e8'),
  leafDark: new THREE.Color('#65744b'),
  leafLight: new THREE.Color('#a1aa80'),
  stemDark: new THREE.Color('#5d6b44'),
  stemLight: new THREE.Color('#959d6f'),
};

/* 四层花瓣：外层低垂外翻，内层直立合抱。宽度大于间距，形成玫瑰的交叠。 */
const LAYERS = [
  { petals: 7, per: 800, r0: 0.3, len: 1.28, base: 0.0, rise: 0.98, droop: 0.26, width: 0.63, cup: 0.95 },
  { petals: 6, per: 520, r0: 0.26, len: 1.04, base: 0.24, rise: 1.1, droop: 0.04, width: 0.56, cup: 1.0 },
  { petals: 5, per: 360, r0: 0.2, len: 0.78, base: 0.46, rise: 1.0, droop: 0.0, width: 0.48, cup: 0.9 },
  { petals: 5, per: 140, r0: 0.12, len: 0.44, base: 0.72, rise: 0.7, droop: 0.0, width: 0.34, cup: 0.6 },
];

/* 花瓣轮廓：基部收窄，中部与上部保持宽，接近尖端才收口，像真实的玫瑰花瓣。 */
function petalWidth(s) {
  const base = clamp01(s / 0.1);
  const body = Math.pow(Math.max(0, 1 - Math.pow(Math.abs((s - 0.66) / 0.66), 3.4)), 0.32);
  const tip = Math.pow(Math.max(0, 1 - Math.pow(s, 18)), 0.22);
  return body * tip * (0.3 + 0.7 * Math.sqrt(base));
}

function petalColor(layer, s, uAbs, rnd) {
  let c;
  if (layer === 0) {
    c = C.rose.clone().lerp(C.pink, 0.28 + 0.5 * s);
    c.lerp(C.cream, 0.05);
  } else if (layer === 1) {
    c = C.deep.clone().lerp(C.rose, 0.42 + 0.5 * s);
    c.lerp(C.pink, Math.max(0, s - 0.6) * 0.5);
  } else if (layer === 2) {
    c = C.deep.clone().lerp(C.rose, 0.12 + 0.4 * s);
    c.lerp(C.pink, Math.max(0, s - 0.72) * 0.6);
  } else {
    c = C.deep.clone().lerp(C.rose, 0.05 + 0.28 * s);
    c.offsetHSL(0, 0.02, -0.03);
  }
  if (uAbs > 0.86) c.lerp(C.cream, 0.1 + 0.18 * (uAbs - 0.86) / 0.14 * (0.4 + 0.6 * s));
  c.offsetHSL((rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.055);
  return c;
}

/**
 * 生成单朵花的全部粒子。
 * 每个粒子同时拥有三种位置：花苞 aBud、花冠 aOpen、星场 aStar。
 * 三者在顶点着色器里按开合度连续插值，因此没有跳变，也没有换模型。
 */
export function buildFlower(quality = 1) {
  const rnd = mulberry32(0x0f10a1);
  const bud = [], open = [], star = [];
  const color = [], starColor = [], size = [];
  const seed = [], delay = [], sDelay = [], scatter = [], kind = [], edge = [];

  const push = (b, o, st, c, cs, sz, sc, dl, sd, sd2, kd = 0, ed = 0) => {
    bud.push(b[0], b[1], b[2]);
    open.push(o[0], o[1], o[2]);
    star.push(st[0], st[1], st[2]);
    color.push(c.r, c.g, c.b);
    starColor.push(cs.r, cs.g, cs.b);
    size.push(sz);
    scatter.push(sc);
    delay.push(dl);
    sDelay.push(sd);
    seed.push(sd2);
    kind.push(kd);
    edge.push(ed);
  };

  const scale = Math.max(0.2, quality);

  /* 花茎：一条轻微弯曲的线，粒子沿曲线散布。 */
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.02, -2.86, 0.05),
    new THREE.Vector3(-0.10, -2.18, 0.02),
    new THREE.Vector3(0.07, -1.42, -0.02),
    new THREE.Vector3(0.0, -0.74, 0.0),
    new THREE.Vector3(0.0, -0.28, 0.0),
  ]);
  const stemCount = Math.round(410 * scale);
  for (let i = 0; i < stemCount; i++) {
    const t = (i + rnd()) / stemCount;
    const p = stemCurve.getPoint(t);
    const a = rnd() * TAU;
    const r = 0.024 + rnd() * 0.016;
    const px = p.x + Math.cos(a) * r;
    const pz = p.z + Math.sin(a) * r;
    const py = p.y + (rnd() - 0.5) * 0.01;
    const c = C.stemDark.clone().lerp(C.stemLight, 0.22 + t * 0.5 + rnd() * 0.2);
    const pos = [px, py, pz];
    push(pos, pos, [0, 0, 0], c, C.cream, 1.0 + rnd() * 0.6, 0, 0, 1, rnd(), 2);
  }

  /* 两片叶子：同一套坐标，花苞与花冠状态下都保留。 */
  const leaf = (sign, baseY, length, tilt) => {
    const count = Math.round(260 * scale);
    const dirX = sign * Math.cos(tilt);
    const dirY = Math.sin(tilt);
    for (let i = 0; i < count; i++) {
      const v = 0.06 + rnd() * 0.94;
      const u = rnd() * 2 - 1;
      const half = 0.19 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.78)), 0.62) * (1 - 0.12 * v);
      const along = 0.1 + v * length;
      const px = sign * 0.02 + dirX * along - sign * dirY * u * half * 0.55;
      const py = baseY + dirY * along + u * half * 0.92;
      const pz = 0.05 + Math.sin(v * Math.PI) * 0.06 + u * 0.025;
      const vein = Math.abs(u) < 0.09;
      const c = C.leafDark.clone().lerp(C.leafLight, 0.12 + v * 0.34 + rnd() * 0.3 + (vein ? 0.2 : 0));
      const pos = [px, py, pz];
      push(pos, pos, [0, 0, 0], c, C.cream, (vein ? 1.2 : 0.95) + rnd() * 0.55, 0, 0, 1, rnd(), 2);
    }
  };
  leaf(1, -1.62, 0.78, 0.36);
  leaf(-1, -2.16, 0.66, 0.42);

  /* 花萼：包住花苞底部，张开后成为花冠的绿色基座。 */
  const calyxCount = Math.round(62 * scale);
  for (let s = 0; s < 5; s++) {
    const ang = (s / 5) * TAU + 0.4;
    for (let i = 0; i < calyxCount; i++) {
      const v = rnd();
      const r = 0.13 + Math.pow(v, 0.8) * 0.28;
      const y = -0.2 + v * 0.32 - v * v * 0.1;
      const px = Math.cos(ang) * r + (rnd() - 0.5) * 0.02;
      const pz = Math.sin(ang) * r + (rnd() - 0.5) * 0.02;
      const c = C.leafDark.clone().lerp(C.stemLight, 0.1 + v * 0.45);
      const pos = [px, y, pz];
      push(pos, pos, [0, 0, 0], c, C.cream, 0.9 + rnd() * 0.55, 0, 0, 1, rnd(), 2);
    }
  }
  const receptCount = Math.round(190 * scale);
  for (let i = 0; i < receptCount; i++) {
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd()) * 0.26;
    const y = -0.12 + rnd() * 0.24;
    const c = C.deep.clone().lerp(C.rose, 0.35 + rnd() * 0.35);
    const pos = [Math.cos(a) * r, y, Math.sin(a) * r];
    push(pos, pos, [0, 0, 0], c, C.cream, 0.9 + rnd() * 0.5, 0, 0, 1, rnd());
  }

  /* 单层花瓣。外层先建、内层后建，缓冲顺序就是前后遮挡顺序。 */
  const buildLayer = (layer) => {
    const cfg = LAYERS[layer];
    const count = Math.max(36, Math.round(cfg.per * scale));
    const phase = rnd() * TAU;
    const petals = cfg.petals;
    const jitter = [];
    for (let p = 0; p < petals; p++) {
      jitter.push({ turn: (rnd() - 0.5) * 0.08, len: 0.92 + rnd() * 0.16, rise: 0.9 + rnd() * 0.2, lift: (rnd() - 0.5) * 0.14 });
    }

    for (let p = 0; p < petals; p++) {
      const jit = jitter[p];
      const theta = (p / petals) * TAU + layer * 0.72 + phase + jit.turn;
      for (let i = 0; i < count; i++) {
        /* 拒绝采样：按宽度均匀铺面，同时把粒子压向花瓣外缘，让轮廓清楚。 */
        let s = 0.03 + rnd() * 0.97;
        let u = rnd() * 2 - 1;
        for (let tries = 0; tries < 7; tries++) {
          const wf = petalWidth(s);
          const uAbsTmp = Math.abs(u);
          const rim = Math.max(
            Math.pow(Math.max(0, (uAbsTmp - 0.62) / 0.38), 1.2),
            0.8 * Math.pow(Math.max(0, (s - 0.84) / 0.16), 1.4),
          );
          if (rnd() < wf * (0.34 + 0.66 * rim)) break;
          s = 0.03 + rnd() * 0.97;
          u = rnd() * 2 - 1;
        }
        const uAbs = Math.abs(u);
        const wf = petalWidth(s);

        /* 花冠：极坐标下的花瓣曲面，边缘抬起形成杯状。 */
        const halfW = cfg.width * wf * jit.len;
        const rad = cfg.r0 + cfg.len * s * jit.len;
        const ang = theta + (u * halfW) / Math.max(0.44, rad * 0.92) + layer * 0.04 * s;
        const rr = rad - 0.1 * u * u * Math.pow(s, 1.5);
        const y = cfg.base + jit.lift
          + cfg.rise * jit.rise * Math.pow(s, 0.92)
          - cfg.droop * Math.pow(s, 2.35)
          + cfg.cup * 0.26 * u * u * (0.3 + 0.7 * s)
          + 0.026 * Math.sin(u * 9.0 + s * 4.0) * s * s;
        const ox = Math.cos(ang) * rr;
        const oz = Math.sin(ang) * rr;
        const oy = y + 0.016 * Math.sin(theta * 3.0 + s * 6.0);

        /* 花苞：花瓣绕轴螺旋包裹，形成上尖下圆、有交叠缝的完整花苞。 */
        const wrap = theta + 1.18 * s + layer * 0.1;
        const bulge = Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + s * 0.88)), 0.66);
        let br = (0.055 + 0.385 * bulge) * (1 - 0.075 * layer);
        br *= 1 - 0.58 * Math.pow(Math.max(0, s - 0.77) / 0.23, 1.35);
        br += u * 0.03;
        br += 0.011 * Math.sin(s * 19 + layer * 2);
        br += ((p * 7) % 5) * 0.006;
        const by = -0.1 + Math.pow(s, 0.94) * 1.46 - 0.03 * Math.pow(s, 5);
        const bx = Math.cos(wrap) * br;
        const bz = Math.sin(wrap) * br;

        /* 星场：覆盖画布的均匀分布，少部分贴近花心，散开过程才连续。 */
        let sx, sy, sz;
        if (rnd() < 0.1) {
          const a2 = rnd() * TAU;
          const r2 = Math.sqrt(rnd()) * 0.42;
          sx = Math.cos(a2) * r2;
          sy = Math.sin(a2) * r2 * 0.8;
          sz = -0.4 + rnd() * 1.2;
        } else {
          sx = rnd() * 2 - 1;
          sy = rnd() * 2 - 1;
          sz = -5.0 + rnd() * 5.2;
        }

        const c = petalColor(layer, s, uAbs, rnd);
        const cs = rnd() < 0.2
          ? C.rose.clone().lerp(C.pink, 0.2 + rnd() * 0.4)
          : c.clone().lerp(C.cream, 0.3 + rnd() * 0.32);

        const sizeBase = layer === 0 ? 1.22 + rnd() * 1.0 : 1.02 + rnd() * 0.86;
        const delayV = clamp01(0.12 + layer * 0.14 + (1 - s) * 0.32 + rnd() * 0.18);
        const sc = layer === 0 ? 1 : layer === 1 ? 0.25 : layer === 2 ? 0.02 : 0;

        push(
          [bx, by, bz],
          [ox, oy, oz],
          [sx, sy, sz],
          c,
          cs,
          sizeBase,
          sc,
          delayV,
          clamp01(rnd() * 0.72 + (layer === 0 ? 0 : 0.16)),
          rnd(),
          0,
          uAbs,
        );
      }
    }
  };

  buildLayer(0);
  buildLayer(1);

  buildLayer(2);
  buildLayer(3);

  /* 花心：一簇暖白花蕊，最后绘制，成为整朵花的暖色焦点。 */
  const stamenCount = Math.round(300 * scale);
  for (let i = 0; i < stamenCount; i++) {
    const a = rnd() * TAU;
    const r = Math.pow(rnd(), 0.7) * 0.2;
    const y = 0.62 + (1 - r / 0.2) * 0.16 + rnd() * 0.1;
    const c = C.cream.clone().lerp(C.peach, 0.5 + rnd() * 0.3).lerp(C.rose, rnd() < 0.2 ? 0.3 : 0);
    const pos = [Math.cos(a) * r, y, Math.sin(a) * r];
    push(pos, pos, [0, 0, 0], c, C.cream, 0.75 + rnd() * 0.7, 0.02, 0, 1, rnd(), 1);
  }

  const count = size.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(open, 3));
  geometry.setAttribute('aBud', new THREE.Float32BufferAttribute(bud, 3));
  geometry.setAttribute('aOpen', new THREE.Float32BufferAttribute(open, 3));
  geometry.setAttribute('aStar', new THREE.Float32BufferAttribute(star, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('aStarColor', new THREE.Float32BufferAttribute(starColor, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geometry.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
  geometry.setAttribute('aScatterDelay', new THREE.Float32BufferAttribute(sDelay, 1));
  geometry.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatter, 1));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius = 9;

  return { geometry, count };
}
