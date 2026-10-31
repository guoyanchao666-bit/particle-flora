import { FilesetResolver, HandLandmarker } from '../../../vendor/mediapipe/vision_bundle.mjs';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = new Set([4, 8, 12, 16, 20]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/**
 * 以“指尖到手腕 / 指节到手腕”的比值衡量张开程度。
 * 比值不受手掌大小、画面远近和手腕旋转影响，比直接看指尖 y 坐标稳得多。
 * 完全握拳约 0.0，完全张开约 0.9~1.0。
 */
export function measureOpenness(lm) {
  const wrist = lm[0];
  let sum = 0;
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  for (const [tip, pip] of pairs) {
    const tipD = dist(lm[tip], wrist);
    const pipD = dist(lm[pip], wrist);
    const ratio = tipD / Math.max(1e-4, pipD);
    sum += clamp01((ratio - 1.02) / 0.42);
  }
  const thumbD = dist(lm[4], wrist);
  const thumbBaseD = dist(lm[5], wrist);
  const thumb = clamp01((thumbD / Math.max(1e-4, thumbBaseD) - 1.15) / 0.55);
  return clamp01((sum / 4) * 0.86 + thumb * 0.14);
}

function alphaFor(cutoff, dt) {
  const tau = 1 / (TAU * cutoff);
  return 1 / (1 + tau / Math.max(1e-4, dt));
}

class LowPass {
  constructor() { this.value = null; }
  filter(x, alpha) {
    this.value = this.value === null ? x : alpha * x + (1 - alpha) * this.value;
    return this.value;
  }
  reset() { this.value = null; }
}

/** One Euro Filter：慢速时抑抖，快速时低延迟，适合手势这种“要跟手”的信号。 */
class OneEuro {
  constructor(minCutoff = 1.8, beta = 0.12, dCutoff = 1.2) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.last = null;
  }
  filter(value, dt) {
    if (!Number.isFinite(value)) return this.x.value ?? 0;
    const step = Math.min(0.12, Math.max(0.008, dt || 0.016));
    if (this.last === null) {
      this.last = value;
      return this.x.filter(value, 1);
    }
    const rawDx = (value - this.last) / step;
    this.last = value;
    const edx = this.dx.filter(rawDx, alphaFor(this.dCutoff, step));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alphaFor(cutoff, step));
  }
  reset() { this.x.reset(); this.dx.reset(); this.last = null; }
}

const deadzone = (v) => (Math.abs(v) < 0.07 ? 0 : (v - Math.sign(v) * 0.07) / 0.93);

export class HandTracker {
  constructor({ video, canvas, onFrame, onStatus, onError }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.onFrame = onFrame || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});

    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.raf = 0;
    this.lastDetect = 0;
    this.lastTime = 0;
    this.lastVideoTime = -1;
    this.lastDraw = 0;
    this.lastSeen = 0;
    this.present = false;
    this.searching = false;
    this.errors = 0;
    this.detectMs = 0;
    this.delegate = 'none';

    this.openFilter = new OneEuro(2.4, 0.2, 1.4);
    this.pxFilter = new OneEuro(1.8, 0.1, 1.2);
    this.pyFilter = new OneEuro(1.8, 0.1, 1.2);
    this.openness = 0.55;
  }

  async loadModel(url, onProgress) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('MODEL_HTTP_' + response.status);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body || !total) {
      const buffer = await response.arrayBuffer();
      onProgress?.(100);
      return new Uint8Array(buffer);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(99, Math.round((received / total) * 100)));
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    onProgress?.(100);
    return merged;
  }

  async getStream() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNSUPPORTED');
    const attempts = [
      { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    let lastError;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') break;
      }
    }
    throw lastError || new Error('CAMERA_FAILED');
  }

  async start() {
    if (this.running) return;
    if (!window.isSecureContext) {
      throw Object.assign(new Error('INSECURE_CONTEXT'), { friendly: '摄像头需要 localhost 或 HTTPS 环境，已留在手动模式' });
    }

    this.onStatus('requesting', '正在请求摄像头');
    let stream;
    try {
      stream = await this.getStream();
    } catch (error) {
      const name = error?.name || '';
      let message = '摄像头未能启动，已回到手动模式';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') message = '摄像头权限被拒绝，已回到手动模式';
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') message = '没有找到可用摄像头，已回到手动模式';
      else if (name === 'NotReadableError' || name === 'TrackStartError') message = '摄像头被其他程序占用，已回到手动模式';
      else if (name === 'CAMERA_UNSUPPORTED') message = '当前浏览器不支持摄像头，已回到手动模式';
      throw Object.assign(error, { friendly: message });
    }

    this.stream = stream;
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch {
      /* 自动播放被拦截时，detectForVideo 仍能读取已解码帧。 */
    }

    try {
      if (!this.landmarker) {
        this.onStatus('loading', '正在加载手势模型');
        const base = new URL('../../../vendor/mediapipe/', import.meta.url).href;
        const modelUrl = new URL('../../../models/hand_landmarker.task', import.meta.url).href;
        const [vision, modelBuffer] = await Promise.all([
          FilesetResolver.forVisionTasks(base + 'wasm'),
          this.loadModel(modelUrl, (percent) => {
            if (percent < 100) this.onStatus('loading', `正在加载手势模型 ${percent}%`);
          }),
        ]);
        const common = {
          baseOptions: { modelAssetBuffer: modelBuffer },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };
        try {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            ...common,
            baseOptions: { ...common.baseOptions, delegate: 'GPU' },
          });
          this.delegate = 'GPU';
        } catch {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            ...common,
            baseOptions: { ...common.baseOptions, delegate: 'CPU' },
          });
          this.delegate = 'CPU';
        }
      }
    } catch (error) {
      this.stopTracks();
      throw Object.assign(error, { friendly: '手势模型加载失败，已留在手动模式' });
    }

    this.running = true;
    this.present = false;
    this.searching = false;
    this.errors = 0;
    this.lastSeen = 0;
    this.openFilter.reset();
    this.pxFilter.reset();
    this.pyFilter.reset();
    this.onStatus('searching', '把手放进画面');
    this.loop();
  }

  loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now();
    if (now - this.lastDetect < 40) return;
    if (this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const dt = Math.min(0.12, (now - this.lastDetect) / 1000 || 0.033);
    this.lastDetect = now;

    let result;
    const started = performance.now();
    try {
      result = this.landmarker.detectForVideo(this.video, now);
      this.detectMs = this.detectMs * 0.85 + (performance.now() - started) * 0.15;
    } catch {
      this.errors++;
      if (this.errors > 14) {
        this.fail('手势识别意外中断，已回到手动模式');
      }
      return;
    }
    this.errors = 0;

    const landmarks = result?.landmarks?.[0];
    if (landmarks) {
      const raw = measureOpenness(landmarks);
      this.openness = this.openFilter.filter(raw, dt);

      const palm = landmarks[0];
      const mid = landmarks[9];
      const cx = (palm.x + mid.x) / 2;
      const cy = (palm.y + mid.y) / 2;
      const px = deadzone(clamp((0.5 - cx) * 1.9, -1, 1));
      const py = deadzone(clamp((0.5 - cy) * 1.9, -1, 1));

      const smoothX = this.pxFilter.filter(px, dt);
      const smoothY = this.pyFilter.filter(py, dt);
      this.lastSeen = now;
      this.present = true;
      this.searching = false;

      this.onFrame({
        present: true,
        openness: this.openness,
        point: { x: clamp(smoothX, -1, 1), y: clamp(smoothY, -1, 1) },
        landmarks,
      });

      if (this.openness > 0.68) this.onStatus('tracking', '手掌张开');
      else if (this.openness < 0.3) this.onStatus('tracking', '正在握拳');
      else this.onStatus('tracking', '感知手势');
    } else {
      if (this.present) {
        this.present = false;
        this.onFrame({ present: false, openness: this.openness, point: { x: 0, y: 0 } });
        this.searching = false;
      }
      if (!this.searching && now - this.lastSeen > 420) {
        this.searching = true;
        this.onStatus('searching', '寻找手掌');
      }
    }

    if (now - this.lastDraw > 78) {
      this.draw(landmarks);
      this.lastDraw = now;
    }
  };

  draw(landmarks) {
    if (!this.ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;

    /* 与 CSS 的 object-fit: cover 对齐，非 4:3 摄像头也不会错位。 */
    const vw = this.video.videoWidth || width;
    const vh = this.video.videoHeight || height;
    const fit = Math.max(width / vw, height / vh);
    const ox = (width - vw * fit) / 2;
    const oy = (height - vh * fit) / 2;
    const at = (p) => [p.x * vw * fit + ox, p.y * vh * fit + oy];
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(242, 163, 179, 0.5)';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const p1 = at(landmarks[a]);
      const p2 = at(landmarks[b]);
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
    }
    ctx.stroke();

    for (let i = 0; i < landmarks.length; i++) {
      const [x, y] = at(landmarks[i]);
      const tip = TIPS.has(i);
      ctx.beginPath();
      ctx.arc(x, y, tip ? 2.6 : 1.5, 0, TAU);
      ctx.fillStyle = tip ? '#fff3e8' : 'rgba(255, 243, 232, 0.55)';
      ctx.fill();
    }
  }

  fail(message) {
    this.stopTracks();
    this.onStatus('error', message);
    this.onError(message);
  }

  stopTracks() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try { this.video.pause(); } catch { /* noop */ }
    this.video.srcObject = null;
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.present = false;
    this.searching = false;
  }

  stop() {
    this.stopTracks();
    this.onStatus('idle', '手动模式');
  }

  dispose() {
    this.stopTracks();
    try { this.landmarker?.close(); } catch { /* noop */ }
    this.landmarker = null;
  }
}
