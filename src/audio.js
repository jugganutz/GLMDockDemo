// audio.js — fully synthesized ambience: rain hiss, sea rumble, lamp hum, thunder
export function createAudio() {
  let ctx = null, master = null;
  let rainGain = null, seaGain = null, humGain = null;
  let started = false, muted = true;
  let seaLfoT = 0, gustT = 0;

  function noiseBuffer(sec, brownish = false) {
    const n = Math.floor(ctx.sampleRate*sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random()*2 - 1;
      if (brownish) { last = (last + 0.03*w)/1.03; d[i] = last*3.2; }
      else d[i] = w*0.3;
    }
    return b;
  }

  function start() {
    if (started) return;
    started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);

    // ---- rain hiss (white noise, band-limited) ----
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer(3.1, false);
    rainSrc.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6200;
    rainGain = ctx.createGain(); rainGain.gain.value = 0.05;
    rainSrc.connect(hp); hp.connect(lp); lp.connect(rainGain); rainGain.connect(master);
    rainSrc.start();

    // ---- sea rumble (brown noise, deep) ----
    const seaSrc = ctx.createBufferSource();
    seaSrc.buffer = noiseBuffer(4.0, true);
    seaSrc.loop = true;
    const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 240;
    seaGain = ctx.createGain(); seaGain.gain.value = 0.22;
    seaSrc.connect(slp); slp.connect(seaGain); seaGain.connect(master);
    seaSrc.start();

    // ---- sodium lamp hum ----
    humGain = ctx.createGain(); humGain.gain.value = 0.012;
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 100;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 200;
    const o2g = ctx.createGain(); o2g.gain.value = 0.35;
    o1.connect(humGain); o2.connect(o2g); o2g.connect(humGain); humGain.connect(master);
    o1.start(); o2.start();
  }

  function setMuted(m) {
    muted = m;
    if (!started) return;
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.5);
  }

  function thunder(delay) {
    if (!started || muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4.2, true);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(320, t0);
    f.frequency.exponentialRampToValueAtTime(60, t0 + 3.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + 4.0);
    // sub thump
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 46;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.30, t0 + 0.12);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    o.connect(og); og.connect(master);
    o.start(t0); o.stop(t0 + 2.4);
  }

  // called every frame — cheap smoothing of levels
  function update(dt, params) {
    if (!started || muted) return;
    const t = ctx.currentTime;
    gustT += dt;
    const gust = 0.5 + 0.5*Math.sin(gustT*0.55) + 0.25*Math.sin(gustT*1.9);
    const rainLvl = (0.028 + 0.075*Math.min(params.rain, 2))*(0.75 + 0.45*gust*(0.3 + params.wind*0.7));
    rainGain.gain.value += (rainLvl - rainGain.gain.value)*Math.min(1, dt*3);
    seaLfoT += dt;
    const swell = 0.72 + 0.28*Math.sin(seaLfoT*0.22) + 0.12*Math.sin(seaLfoT*0.071);
    const seaLvl = seaBase(params.wind)*swell;
    seaGain.gain.value += (seaLvl - seaGain.gain.value)*Math.min(1, dt*2);
    humGain.gain.value = 0.009 + 0.006*Math.min(params.wind, 1.2);
  }
  function seaBase(wind) { return 0.16 + 0.14*wind; }

  function unlock() { if (started && ctx.state === 'suspended') ctx.resume(); }

  return {
    start, setMuted, thunder, update, unlock,
    get muted() { return muted; },
    get on() { return started; },
  };
}
