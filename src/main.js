// main.js — boot, UI wiring, render loop
import { createGL } from './engine/gl.js';
import { createCamera } from './camera.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('gl');
const loading = document.getElementById('loading');
const fatal = document.getElementById('fatal');
const fpsEl = document.getElementById('fps');
const hintEl = document.getElementById('hint');
const panel = document.getElementById('panel');
const gear = document.getElementById('gear');

const btnCine = document.getElementById('btnCine');
const btnPause = document.getElementById('btnPause');
const btnSound = document.getElementById('btnSound');
const selQuality = document.getElementById('selQuality');

const sliders = [
  { id: 'sRain', out: 'oRain', key: 'rain', fmt: v => v.toFixed(2) },
  { id: 'sWind', out: 'oWind', key: 'wind', fmt: v => v.toFixed(2) },
  { id: 'sFog',  out: 'oFog',  key: 'fog',  fmt: v => v.toFixed(2) },
  { id: 'sTint', out: 'oTint', key: 'tint', fmt: v => v.toFixed(2) },
  { id: 'sExp',  out: 'oExp',  key: 'exposure', fmt: v => v.toFixed(2) },
];

const glCtx = createGL(canvas);
if (!glCtx || typeof glCtx.createVertexArray !== 'function') {
  loading.classList.add('done');
  fatal.classList.add('show');
} else {
  boot(glCtx);
}

function boot(gl) {
  const audio = createAudio();
  const camera = createCamera(canvas);
  const renderer = createRenderer(gl, canvas, camera, {
    onThunder: (d) => audio.thunder(d),
  });
  const P = renderer.params;

  // ---------- UI state helpers ----------
  const setBtn = (el, on) => el.classList.toggle('on', on);
  let hintHidden = false;
  const hideHint = () => {
    if (hintHidden) return; hintHidden = true;
    setTimeout(() => hintEl.classList.add('fade'), 60);
  };
  setTimeout(hideHint, 12000);

  // any pointer on the scene hands control to the user
  window.__dockOnInteract = () => {
    hideHint();
    if (P.cinematic) {
      P.cinematic = false;
      camera.goManual();
      setBtn(btnCine, false);
    }
  };

  gear.addEventListener('click', () => panel.classList.toggle('hidden'));
  if (window.matchMedia('(max-width: 700px)').matches) panel.classList.add('hidden');

  // ---------- buttons ----------
  btnCine.addEventListener('click', () => {
    P.cinematic = !P.cinematic;
    setBtn(btnCine, P.cinematic);
    if (P.cinematic) camera.goCinematic();
    else { camera.goManual(); hideHint(); }
  });
  btnPause.addEventListener('click', () => {
    P.paused = !P.paused;
    setBtn(btnPause, P.paused);
  });
  btnSound.addEventListener('click', () => {
    if (!audio.on) audio.start();
    P.muted = !P.muted;
    audio.setMuted(P.muted);
    setBtn(btnSound, !P.muted);
  });

  selQuality.addEventListener('change', () => renderer.applyQuality(selQuality.value));
  renderer.applyQuality(selQuality.value); // honors mobile detection at boot

  // dev: override camera via URL, e.g. ?eye=0,6,30&look=0,4,-10
  const qp = new URLSearchParams(location.search);
  if (qp.has('eye')) {
    const e = qp.get('eye').split(',').map(Number);
    const l = qp.get('look').split(',').map(Number);
    camera.setManual(e, l, parseFloat(qp.get('fov') || '55'));
    P.cinematic = false;
    setBtn(btnCine, false);
  }

  // ---------- sliders ----------
  sliders.forEach(({ id, out, key, fmt }) => {
    const el = document.getElementById(id);
    const o = document.getElementById(out);
    const upd = () => {
      P[key] = parseFloat(el.value);
      o.textContent = fmt(P[key]);
    };
    el.addEventListener('input', upd);
    upd();
  });

  // pause the sim when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && P.cinematic) { /* keep clock consistent */ }
  });

  // ---------- loop ----------
  let last = performance.now();
  let fpsT = 0, fpsN = 0;
  let booted = false;

  function loop(now) {
    const dt = Math.min((now - last)/1000, 0.1);
    last = now;
    try {
      renderer.frame(dt, now/1000);
    } catch (err) {
      console.error(err);
      fatal.firstElementChild.innerHTML = '<b>Render failure</b>' + String(err && err.message || err);
      fatal.classList.add('show');
      return; // stop the loop on fatal
    }
    audio.update(dt, P);

    fpsT += dt; fpsN++;
    if (fpsT > 0.5) {
      const fps = fpsN/fpsT;
      fpsEl.textContent = `${fps.toFixed(0)} fps · ${canvas.width}×${canvas.height} · ${renderer.stats.lights} lights`;
      fpsT = 0; fpsN = 0;
    }

    if (!booted) {
      booted = true;
      setTimeout(() => loading.classList.add('done'), 250);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // watch for resizes (also fires on rotate)
  window.addEventListener('resize', () => renderer.resize());
}
