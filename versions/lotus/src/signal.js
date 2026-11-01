/* 手势 → 花朵的纯函数层：不依赖 DOM / Three.js，便于单独校验数值。 */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 帧率无关的一阶阻尼：每帧按 1 - e^(-λ·dt) 逼近目标。
 * 同样的 λ 与经过时间，在 30 / 60 / 120fps 下得到同一结果。
 */
export function damp(current, target, lambda, dt) {
  const step = Math.max(0, Math.min(0.1, dt || 0));
  return current + (target - current) * (1 - Math.exp(-lambda * step));
}

/**
 * 两段式开合映射，拐点固定：
 *   x ≤ 0.85 → 0.95 · (x / 0.85)^1.5
 *   x > 0.85 → 0.95 + 0.05 · (x - 0.85) / 0.15
 * 验收：0→0，0.5→0.4285，0.6→0.5633，0.85→0.95，1→1。
 */
export function bloomFromOpenness(value) {
  const x = clamp01(Number.isFinite(value) ? value : 0);
  if (x <= 0.85) return 0.95 * Math.pow(x / 0.85, 1.5);
  return 0.95 + 0.05 * ((x - 0.85) / 0.15);
}

/** 掌心：手腕、食指/中指/无名指/小指根部五点平均，比单取 9 号点稳。 */
export function palmCenter(landmarks) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const id of ids) {
    x += landmarks[id].x;
    y += landmarks[id].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

/**
 * 掌旋角 + 置信度：融合「手腕→中指」与「食指→小指」两个方向。
 * - 食指→小指用于判断左右手，统一成「手掌右侧」向量；
 * - 手掌右侧逆时针转 90° 得到第二个「向上」估计，按向量长度加权；
 * - 画面预览是左右镜像的，所以直接使用原始横向分量求角，
 *   等价于对显示角度取反（手在屏幕上顺时针转，花在屏幕上逆时针转）。
 *
 * 置信度由两部分相乘：
 * - agree：两个方向估计是否一致，手指抖动导致方向打架时降低；
 * - front：食指→小指在画面中的投影长度，手掌越侧对镜头越低。
 * 置信度只用于场景层的旋转滤波权重，不改变张开度与位置。
 *
 * 返回弧度：0 = 指尖朝上，正值 = 花应逆时针转。
 * 方向几乎不可用时 angle 为 NaN，由调用方保持上一帧角度，避免突然回正。
 */
export function palmRollInfo(landmarks) {
  const wrist = landmarks[0];
  const mid = landmarks[9];
  const index = landmarks[5];
  const pinky = landmarks[17];

  const ux = mid.x - wrist.x;
  const uy = mid.y - wrist.y;
  let ax = pinky.x - index.x;
  let ay = pinky.y - index.y;

  const cross = ux * ay - uy * ax;
  if (cross < 0) {
    ax = -ax;
    ay = -ay;
  }

  const ux2 = ay;
  const uy2 = -ax;
  const w1 = Math.hypot(ux, uy);
  const w2 = Math.hypot(ux2, uy2);
  const bx = ux * w1 * 0.62 + ux2 * w2 * 0.38;
  const by = uy * w1 * 0.62 + uy2 * w2 * 0.38;

  const upAngle = Math.atan2(ux, -uy);
  const acrossAngle = Math.atan2(ay, ax);
  let diff = acrossAngle - upAngle;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;

  const agree = 1 - clamp01(Math.abs(diff) / 0.7);
  const front = clamp01(w2 / Math.max(1e-4, w1 * 0.55));
  const confidence = clamp01(0.35 + 0.65 * agree * front);
  const angle = Math.hypot(bx, by) < 0.02 ? NaN : Math.atan2(bx, -by);

  return { angle, confidence };
}

export function palmRoll(landmarks) {
  return palmRollInfo(landmarks).angle;
}

/**
 * 掌旋自适应滤波：软死区 + 按误差速度提高响应 + 按置信度降低权重。
 * - 误差小于 0.01rad（约 0.57°）时不动，直接吃掉 1–2° 的细颤；
 * - 真正转动时误差变大，λ 从 3 提到 15，不产生拖沓；
 * - 手掌侧对镜头（置信度低）时整体变慢，避免用不可靠方向带动花朵。
 */
export function stepAngle(current, target, confidence, dt) {
  const step = Math.max(0, Math.min(0.1, dt || 0));
  if (!step || !Number.isFinite(target)) return current;

  let error = target - current;
  while (error > Math.PI) error -= TAU;
  while (error < -Math.PI) error += TAU;

  const dead = 0.01;
  const abs = Math.abs(error);
  if (abs <= dead) return current;

  const shaped = (abs - dead) * Math.sign(error);
  const speed = Math.abs(shaped) / Math.max(0.008, step);
  const conf = Number.isFinite(confidence) ? clamp(confidence, 0.2, 1) : 1;
  const lambda = (3 + Math.min(12, speed * 1.4)) * conf;
  return current + shaped * (1 - Math.exp(-lambda * step));
}
