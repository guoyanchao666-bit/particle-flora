import { createGarden } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const still = params.get('still') === '1';

/* 首帧编译着色器时可能有长帧，禁用 GSAP 的跳帧补偿，入场动画才不会卡住。 */
if (gsap) gsap.ticker.lagSmoothing(0);

const els = {
  canvas: $('#stage'),
  fallback: $('#fallback'),
  fallbackHelp: $('#fallbackHelp'),
  stateWord: $('#stateWord'),
  stateLine: $('#stateLine'),
  states: Array.from(document.querySelectorAll('.states button')),
  slider: $('#bloom'),
  out: $('#bloomOut'),
  fill: $('#rangeFill'),
  particleInput: $('#particleCount'),
  particleOut: $('#particleOut'),
  particleFill: $('#particleFill'),
  mode: $('#modeLine'),
  gestureBtn: $('#gestureBtn'),
  cameraPanel: $('#cameraPanel'),
  cameraState: $('#cameraState'),
  cameraStop: $('#cameraStop'),
  video: $('#cameraVideo'),
  overlay: $('#cameraOverlay'),
  perf: $('#perf'),
  notice: $('#notice'),
  help: $('#helpDialog'),
  helpOpen: $('#helpOpen'),
  helpClose: $('#helpClose'),
  helpDone: $('#helpDone'),
};

const STATES = {
  bud: {
    word: '含苞',
    line: '所有粒子收拢成一枚花苞，花茎与两片叶子清晰可辨。',
  },
  bloom: {
    word: '舒展',
    line: '花瓣向上抬起，前后错落，花心还藏在暖白里。',
  },
  stars: {
    word: '星野',
    line: '外层花瓣散入夜色，内层花瓣与花心留在原处。',
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/* 阈值带一点迟滞，手势在边界附近微抖时文字不会来回跳。 */
function stateFor(v, current) {
  const low = current === 'bud' ? 0.218 : 0.2;
  const high = current === 'stars' ? 0.802 : 0.82;
  if (v < low) return 'bud';
  if (v < high) return 'bloom';
  return 'stars';
}

let garden = null;
let tracker = null;
let manualUntil = 0;
let modeText = '';
let stateKey = 'bloom';
let shownPct = -1;
let sliderHeld = false;
let busy = false;
let noticeTimer = 0;
let drag = null;
let revealed = false;

function setMode(text) {
  if (text === modeText) return;
  modeText = text;
  els.mode.textContent = text;
}

function showNotice(text, duration = 4200) {
  els.notice.textContent = text;
  els.notice.classList.add('is-on');
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => els.notice.classList.remove('is-on'), duration);
}

function syncState(key) {
  if (key === stateKey) return;
  stateKey = key;
  const data = STATES[key];
  els.stateLine.textContent = data.line;
  for (const button of els.states) {
    const on = button.dataset.key === key;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  if (!gsap || reduceMotion) {
    els.stateWord.textContent = data.word;
    return;
  }
  gsap.killTweensOf(els.stateWord);
  els.stateWord.textContent = data.word;
  gsap.fromTo(els.stateWord, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.34, ease: 'power2.out' });
}

function paint(value) {
  const v = clamp01(value);
  const pct = Math.round(v * 100);
  if (pct !== shownPct) {
    shownPct = pct;
    if (!sliderHeld) els.slider.value = String(pct);
    els.out.textContent = String(pct);
    els.fill.style.setProperty('--p', pct + '%');
  }
  syncState(stateFor(v, stateKey));
}

function takeManual(value, { jump = false } = {}) {
  if (!garden) return;
  const v = clamp01(value);
  manualUntil = performance.now() + 2400;
  if (jump) garden.jumpTo(v);
  else garden.setTarget(v);
  paint(v);
  if (tracker?.running) setMode('手动接管 · 稍后恢复手势');
}

function revealCanvas() {
  if (revealed) return;
  revealed = true;
  if (!els.fallback.hidden) els.fallback.hidden = true;
  root.dataset.ready = 'true';
  if (!gsap || reduceMotion || still) {
    els.canvas.style.opacity = '1';
    return;
  }
  gsap.to(els.canvas, { opacity: 1, duration: 1.5, ease: 'power1.out' });
}

function showFallback() {
  els.fallback.hidden = false;
  root.dataset.ready = 'stalled';
  els.canvas.style.opacity = '0';
  els.perf.textContent = '画布未启动';
}

const mobile = window.matchMedia('(max-width: 760px)').matches;
const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const particleLimits = mobile
  ? { min: 3000, max: 16000, step: 1000 }
  : { min: 4000, max: 30000, step: 1000 };
let particleTarget = mobile ? 8000 : lowEnd ? 10000 : 13000;
let particleRebuildTimer = 0;
const quality = particleTarget / 12950;

function paintParticleCount(value) {
  els.particleInput.value = String(value);
  els.particleOut.textContent = value.toLocaleString('en-US');
  els.particleInput.setAttribute('aria-valuetext', `${value.toLocaleString('zh-CN')} 个粒子`);
  const ratio = (value - particleLimits.min) / (particleLimits.max - particleLimits.min);
  els.particleFill.style.setProperty('--p', `${clamp01(ratio) * 100}%`);
}

function normalizeParticleCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return particleTarget;
  const stepped = Math.round(numeric / particleLimits.step) * particleLimits.step;
  return Math.min(particleLimits.max, Math.max(particleLimits.min, stepped));
}

function applyParticleCount(value, { immediate = false } = {}) {
  particleTarget = normalizeParticleCount(value);
  paintParticleCount(particleTarget);
  clearTimeout(particleRebuildTimer);
  const rebuild = () => garden?.setQuality(particleTarget / 12950);
  if (immediate) rebuild();
  else particleRebuildTimer = window.setTimeout(rebuild, 90);
}

els.particleInput.min = String(particleLimits.min);
els.particleInput.max = String(particleLimits.max);
els.particleInput.step = String(particleLimits.step);
paintParticleCount(particleTarget);
els.particleInput.addEventListener('input', () => applyParticleCount(els.particleInput.value));
els.particleInput.addEventListener('change', () => applyParticleCount(els.particleInput.value, { immediate: true }));

try {
  garden = createGarden(els.canvas, {
    quality,
    onReady: revealCanvas,
    onStats: ({ fps, particles }) => {
      els.perf.textContent = `${fps} fps · ${particles.toLocaleString('en-US')} 粒子`;
    },
    onContextLost: () => {
      showNotice('图形上下文丢失，正在尝试恢复；手动控制仍然可用。', 6000);
    },
  });
} catch (error) {
  console.error('garden init failed:', error);
  showFallback();
}

if (garden && params.has('b')) {
  const start = clamp01(Number(params.get('b')) || 0);
  garden.jumpTo(start);
  paint(start);
}

if (garden && still) garden.setMotion(0);

/* 手势模块按需加载：即使 MediaPipe 或摄像头失败，花园本身照常运行。 */
function createTracker(HandTracker) {
  return new HandTracker({
    video: els.video,
    canvas: els.overlay,
    onFrame(frame) {
      if (!garden || !frame.present) return;
      if (performance.now() < manualUntil) return;
      const target = clamp01((frame.openness - 0.14) / 0.68);
      garden.setTarget(target);
      garden.setPointer(frame.point.x * 0.85, frame.point.y * 0.85);
    },
    onStatus(status, text) {
      if (els.cameraState.textContent !== text) els.cameraState.textContent = text;
      els.cameraPanel.hidden = status === 'idle' || status === 'error';
      if (status === 'tracking') setMode('手势追踪中 · 张开或握拳');
      else if (status === 'searching') setMode('寻找手掌 · 保持当前形态');
      else if (status === 'loading' || status === 'requesting') setMode('正在连接摄像头');
    },
    onError(message) {
      busy = false;
      els.gestureBtn.disabled = false;
      els.gestureBtn.textContent = '重试手势';
      els.gestureBtn.classList.remove('is-live');
      els.cameraPanel.hidden = true;
      setMode('手动模式 · 摄像头不可用');
      showNotice(message, 5600);
      garden?.setPointer(0, 0);
    },
  });
}

async function enableCamera() {
  if (busy) return;
  busy = true;
  els.gestureBtn.disabled = true;
  els.gestureBtn.textContent = '正在连接';
  els.cameraPanel.hidden = false;
  els.cameraState.textContent = '正在准备手势模块';
  try {
    if (!tracker) {
      const module = await import('./gesture.js');
      tracker = createTracker(module.HandTracker);
    }
    await tracker.start();
    els.gestureBtn.textContent = '关闭手势';
    els.gestureBtn.classList.add('is-live');
    setMode('手势追踪中 · 张开或握拳');
    showNotice('把一只手掌放进画面，张开或握拳。', 3400);
  } catch (error) {
    els.cameraPanel.hidden = true;
    els.gestureBtn.textContent = '重试手势';
    els.gestureBtn.classList.remove('is-live');
    setMode('手动模式 · 摄像头不可用');
    showNotice(error?.friendly || '手势模块未能启动，已回到手动模式', 5400);
  } finally {
    busy = false;
    els.gestureBtn.disabled = false;
  }
}

function disableCamera() {
  tracker?.stop();
  els.gestureBtn.textContent = '启用手势';
  els.gestureBtn.classList.remove('is-live');
  els.cameraPanel.hidden = true;
  setMode('手动模式 · 拖动滑块或按空格');
  garden?.setPointer(0, 0);
}

els.gestureBtn.addEventListener('click', () => {
  if (tracker?.running) disableCamera();
  else enableCamera();
});

els.cameraStop.addEventListener('click', disableCamera);

els.slider.addEventListener('pointerdown', () => { sliderHeld = true; });
window.addEventListener('pointerup', () => { sliderHeld = false; });
els.slider.addEventListener('input', () => {
  takeManual(Number(els.slider.value) / 100);
});

for (const button of els.states) {
  button.addEventListener('click', () => {
    takeManual(Number(button.dataset.bloom));
  });
}

/* 在画布上上下拖动也能开合，手机上比滑块更好用。 */
els.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  drag = { y: event.clientY, start: garden ? garden.getTarget() : 0.55 };
  els.canvas.setPointerCapture?.(event.pointerId);
});
els.canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const delta = ((drag.y - event.clientY) / Math.max(320, window.innerHeight)) * 1.9;
  takeManual(clamp01(drag.start + delta));
});
const endDrag = () => { drag = null; };
els.canvas.addEventListener('pointerup', endDrag);
els.canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch' || drag) return;
  const x = clamp11((event.clientX / window.innerWidth - 0.5) * 1.7);
  const y = clamp11((0.5 - event.clientY / window.innerHeight) * 1.7);
  garden?.setPointer(x, y);
}, { passive: true });

window.addEventListener('pointerleave', () => garden?.setPointer(0, 0));

function stepTo(value) {
  takeManual(value);
}

window.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (els.help.open) return;
  switch (event.code) {
    case 'Space': {
      event.preventDefault();
      const current = garden ? garden.getTarget() : 0.55;
      stepTo(current > 0.5 ? 0.03 : 1);
      break;
    }
    case 'Digit1': stepTo(0.03); break;
    case 'Digit2': stepTo(0.55); break;
    case 'Digit3': stepTo(1); break;
    case 'KeyR': stepTo(0.55); break;
    case 'KeyH':
      document.body.classList.toggle('ui-hidden');
      break;
    case 'KeyC':
      if (!busy) els.gestureBtn.click();
      break;
    default: break;
  }
});

function openHelp() {
  if (!els.help.open) els.help.showModal();
}
els.helpOpen.addEventListener('click', openHelp);
els.fallbackHelp.addEventListener('click', openHelp);
els.helpClose.addEventListener('click', () => els.help.close());
els.helpDone.addEventListener('click', () => els.help.close());
els.help.addEventListener('click', (event) => {
  if (event.target !== els.help) return;
  const rect = els.help.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) els.help.close();
});

/* 开合数值从渲染器读回，手势、滑块、键盘始终显示同一个状态。 */
window.setInterval(() => {
  if (garden) paint(garden.getBloom());
}, 90);

/* 兜底：如果入场动画因长帧或脚本异常停住，界面必须仍然可见。 */
window.setTimeout(() => {
  if (document.body.classList.contains('ui-hidden')) return;
  for (const el of document.querySelectorAll('.masthead, .lede, .console, .creed')) {
    if (parseFloat(getComputedStyle(el).opacity) < 0.9) {
      el.style.opacity = '1';
      el.style.visibility = 'visible';
    }
  }
}, 2600);

/* 首帧迟迟不来时给出说明，而不是让画布一直黑着。 */
window.setTimeout(() => {
  if (!revealed) showFallback();
}, 8000);

/* 入场：元素先可见，再逐层轻微落位；减弱动态时全部跳过。 */
if (gsap && !reduceMotion && !still) {
  gsap.from('.masthead', { autoAlpha: 0, y: -8, duration: 1, delay: 0.1, ease: 'power2.out' });
  gsap.from('.lede', { autoAlpha: 0, y: 14, duration: 1, delay: 0.28, ease: 'power2.out' });
  gsap.from('.console', { autoAlpha: 0, y: 14, duration: 1, delay: 0.4, ease: 'power2.out' });
  gsap.from('.creed', { autoAlpha: 0, duration: 1.2, delay: 0.7, ease: 'power1.out' });
}

window.__garden = {
  setBloom(value) { takeManual(Number(value)); return garden?.getBloom(); },
  jump(value) { takeManual(Number(value), { jump: true }); return garden?.getBloom(); },
  bloom() { return garden?.getBloom(); },
  key() { return stateKey; },
  mode() { return tracker?.running ? 'gesture' : 'manual'; },
  stats() { return { ...(garden?.stats() || {}), detectMs: tracker?.detectMs ?? 0, delegate: tracker?.delegate ?? 'none' }; },
  setParticles(value) { applyParticleCount(value, { immediate: true }); return garden?.stats(); },
  particleTarget() { return particleTarget; },
  particleRange() { return { ...particleLimits }; },
  cameraPanelVisible() { return !els.cameraPanel.hidden; },
};

if (params.get('debug') === '1') {
  window.__errors = [];
  window.addEventListener('error', (event) => window.__errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__errors.push(String(event.reason)));
}

window.addEventListener('pagehide', () => tracker?.stop());
window.addEventListener('beforeunload', () => garden?.dispose());
