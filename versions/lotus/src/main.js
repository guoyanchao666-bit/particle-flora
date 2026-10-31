import { createLotus } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const still = params.get('still') === '1';

if (gsap) gsap.ticker.lagSmoothing(0);

const PALETTES = [
  { key: 'pink', name: '粉紫', line: '花瓣全部展开，粉紫光点从花心向外层流动。' },
  { key: 'blue', name: '蓝紫', line: '花瓣全部展开，蓝紫光点在边缘连成冷色薄光。' },
  { key: 'gold', name: '暖金', line: '花瓣全部展开，暖金光点沿花瓣边缘缓慢流动。' },
];

const els = {
  canvas: $('#stage'),
  fallback: $('#fallback'),
  fallbackHelp: $('#fallbackHelp'),
  stateWord: $('#stateWord'),
  stateLine: $('#stateLine'),
  states: Array.from(document.querySelectorAll('.states button')),
  swatches: Array.from(document.querySelectorAll('.swatch')),
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

const STATE_COPY = {
  bud: { word: '含苞', line: '花瓣向内合拢，光点收紧成一枚尖顶花苞。' },
  half: { word: '初绽', line: '外圈花瓣先向外翻开，内层仍护着花心。' },
  bloom: { word: '绽放', line: '花瓣全部展开，粉紫光点从花心向外层流动。' },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

function stateFor(v, current) {
  const low = current === 'bud' ? 0.255 : 0.24;
  const high = current === 'bloom' ? 0.705 : 0.72;
  if (v < low) return 'bud';
  if (v < high) return 'half';
  return 'bloom';
}

let lotus = null;
let tracker = null;
let manualUntil = 0;
let modeText = '';
let stateKey = 'bloom';
let paletteKey = 'pink';
let paletteName = '粉紫';
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

function syncState(key, force = false) {
  if (key === stateKey && !force) return;
  const changed = key !== stateKey;
  stateKey = key;
  const data = STATE_COPY[key];
  els.stateWord.textContent = data.word;
  els.stateLine.textContent = key === 'bloom' ? PALETTES.find((p) => p.key === paletteKey).line : data.line;
  for (const button of els.states) {
    const on = button.dataset.key === key;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  if (!changed || !gsap || reduceMotion) return;
  gsap.killTweensOf(els.stateWord);
  gsap.fromTo(els.stateWord, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.34, ease: 'power2.out' });
}

function setPalette(index, { fromUser = false } = {}) {
  const idx = Math.min(2, Math.max(0, Math.round(Number(index) || 0)));
  const palette = PALETTES[idx];
  if (!palette) return;
  paletteKey = palette.key;
  paletteName = palette.name;
  document.body.dataset.palette = palette.key;
  lotus?.setPalette(idx);
  for (const button of els.swatches) {
    const on = Number(button.dataset.palette) === idx;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  if (fromUser) syncState(stateKey, true);
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
  if (!lotus) return;
  const v = clamp01(value);
  manualUntil = performance.now() + 2400;
  if (jump) lotus.jumpTo(v);
  else lotus.setTarget(v);
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
  ? { min: 20000, max: 60000, step: 5000 }
  : { min: 20000, max: 120000, step: 5000 };
let particleTarget = mobile ? 40000 : lowEnd ? 50000 : 80000;
let particleRebuildTimer = 0;

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
  const rebuild = () => lotus?.setQuality(particleTarget / 80000);
  if (immediate) rebuild();
  else particleRebuildTimer = window.setTimeout(rebuild, 90);
}

try {
  lotus = createLotus(els.canvas, {
    quality: particleTarget / 80000,
    onReady: revealCanvas,
    onStats: ({ fps, particles }) => {
      els.perf.textContent = `${fps} fps · ${particles.toLocaleString('en-US')} 粒子`;
    },
    onContextLost: () => {
      showNotice('图形上下文丢失，正在尝试恢复；手动控制仍然可用。', 6000);
    },
  });
} catch (error) {
  console.error('lotus init failed:', error);
  showFallback();
}

els.particleInput.min = String(particleLimits.min);
els.particleInput.max = String(particleLimits.max);
els.particleInput.step = String(particleLimits.step);
paintParticleCount(particleTarget);
setPalette(0);
els.particleInput.addEventListener('input', () => applyParticleCount(els.particleInput.value));
els.particleInput.addEventListener('change', () => applyParticleCount(els.particleInput.value, { immediate: true }));

/* 手势模块按需加载，失败不影响莲花本身。 */
function createTracker(HandTracker) {
  return new HandTracker({
    video: els.video,
    canvas: els.overlay,
    onFrame(frame) {
      if (!lotus || !frame.present) return;
      if (performance.now() < manualUntil) return;
      const target = clamp01((frame.openness - 0.14) / 0.68);
      lotus.setTarget(target);
      lotus.setPointer(frame.point.x, frame.point.y);
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
      lotus?.setPointer(0, 0);
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
  lotus?.setPointer(0, 0);
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
  button.addEventListener('click', () => takeManual(Number(button.dataset.bloom)));
}
for (const button of els.swatches) {
  button.addEventListener('click', () => setPalette(Number(button.dataset.palette), { fromUser: true }));
}

els.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  drag = { y: event.clientY, start: lotus ? lotus.getTarget() : 0.78 };
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
  lotus?.setPointer(x, y);
}, { passive: true });
window.addEventListener('pointerleave', () => lotus?.setPointer(0, 0));

window.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (els.help.open) return;
  switch (event.code) {
    case 'Space': {
      event.preventDefault();
      const current = lotus ? lotus.getTarget() : 0.78;
      takeManual(current > 0.5 ? 0.04 : 0.95);
      break;
    }
    case 'Digit1': takeManual(0.04); break;
    case 'Digit2': takeManual(0.5); break;
    case 'Digit3': takeManual(0.95); break;
    case 'KeyP': setPalette((['pink', 'blue', 'gold'].indexOf(paletteKey) + 1) % 3, { fromUser: true }); break;
    case 'KeyR': takeManual(0.78); break;
    case 'KeyH': document.body.classList.toggle('ui-hidden'); break;
    case 'KeyC': if (!busy) els.gestureBtn.click(); break;
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

window.setInterval(() => {
  if (lotus) paint(lotus.getBloom());
}, 90);

window.setTimeout(() => {
  if (document.body.classList.contains('ui-hidden')) return;
  for (const el of document.querySelectorAll('.masthead, .lede, .console, .creed')) {
    if (parseFloat(getComputedStyle(el).opacity) < 0.9) {
      el.style.opacity = '1';
      el.style.visibility = 'visible';
    }
  }
}, 2600);
window.setTimeout(() => { if (!revealed) showFallback(); }, 8000);

if (gsap && !reduceMotion && !still) {
  gsap.from('.masthead', { autoAlpha: 0, y: -8, duration: 1, delay: 0.1, ease: 'power2.out' });
  gsap.from('.lede', { autoAlpha: 0, y: 14, duration: 1, delay: 0.28, ease: 'power2.out' });
  gsap.from('.console', { autoAlpha: 0, y: 14, duration: 1, delay: 0.4, ease: 'power2.out' });
  gsap.from('.creed', { autoAlpha: 0, duration: 1.2, delay: 0.7, ease: 'power1.out' });
}

window.__lotus = {
  setBloom(value) { takeManual(Number(value)); return lotus?.getBloom(); },
  jump(value) { takeManual(Number(value), { jump: true }); return lotus?.getBloom(); },
  bloom() { return lotus?.getBloom(); },
  key() { return stateKey; },
  palette() { return paletteKey; },
  setPalette(index) { setPalette(index, { fromUser: true }); return paletteKey; },
  setParticles(value) { applyParticleCount(value, { immediate: true }); return lotus?.stats(); },
  particleTarget() { return particleTarget; },
  particleRange() { return { ...particleLimits }; },
  stats() { return { ...(lotus?.stats() || {}), detectMs: tracker?.detectMs ?? 0, delegate: tracker?.delegate ?? 'none' }; },
  mode() { return tracker?.running ? 'gesture' : 'manual'; },
};

if (params.get('debug') === '1') {
  window.__errors = [];
  window.addEventListener('error', (event) => window.__errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__errors.push(String(event.reason)));
}

window.addEventListener('pagehide', () => tracker?.stop());
window.addEventListener('beforeunload', () => lotus?.dispose());
