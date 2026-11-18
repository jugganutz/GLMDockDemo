// render.js — pass orchestration: planar reflection → scene → post
import { createRT } from './engine/gl.js';
import { multiply, invert, perspective, lookAt, mat4, v3norm, clamp, lerp } from './engine/math.js';
import { createSky } from './scene/sky.js';
import { createSea } from './scene/sea.js';
import { createDock } from './scene/dock.js';
import { createProps } from './scene/props.js';
import { createRain } from './scene/rain.js';
import { createLights } from './scene/lights.js';
import { createPost } from './engine/post.js';

const FAR_PLANE = [0, 1, 0, 1e6];   // dot(p, plane) >= 0 keeps all
const REFL_PLANE = [0, 1, 0, -0.012];

export function createRenderer(gl, canvas, camera, hooks = {}) {
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  const isMobile = window.matchMedia('(pointer: coarse)').matches;

  const params = {
    rain: 1, wind: 1, fog: 1, tint: 0.35, exposure: 2.4,
    paused: false, cinematic: true, muted: true, sound: false,
    cones: true, lightScale: 1,
    resScale: 1, reflScale: 0.5, qualityRainMult: 1,
  };

  const sky = createSky(gl);
  const sea = createSea(gl);
  const dock = createDock(gl);
  const props = createProps(gl);
  const rain = createRain(gl);
  const lights = createLights(gl);
  const post = createPost(gl);

  const W = () => canvas.width, H = () => canvas.height;

  const sceneRT = createRT(gl, 8, 8, { float: hasFloat, depth: true });
  const reflRT = createRT(gl, 8, 8, { float: hasFloat, depth: true });
  const ldrRT = createRT(gl, 8, 8, { float: false, depth: false });
  const bloomA = createRT(gl, 8, 8, { float: hasFloat, depth: false });
  const bloomB = createRT(gl, 8, 8, { float: hasFloat, depth: false });

  let simT = 0;
  let lastW = 0, lastH = 0;
  let flashNext = 6 + Math.random()*18;
  let flashStart = -100;

  const S = mat4(); // Y-mirror
  S[5] = -1;
  const view = mat4(), proj = mat4(), viewProj = mat4(), invVP = mat4(), invView = mat4();
  const reflView = mat4(), reflViewProj = mat4(), reflInvVP = mat4();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2);
    const w = Math.max(2, Math.round(canvas.clientWidth*dpr*params.resScale));
    const h = Math.max(2, Math.round(canvas.clientHeight*dpr*params.resScale));
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    canvas.width = w; canvas.height = h;
    sceneRT.resize(w, h);
    ldrRT.resize(w, h);
    const rw = Math.max(2, Math.round(w*params.reflScale));
    const rh = Math.max(2, Math.round(h*params.reflScale));
    reflRT.resize(rw, rh);
    const bw = Math.max(2, Math.round(w*0.5)), bh = Math.max(2, Math.round(h*0.5));
    bloomA.resize(bw, bh);
    bloomB.resize(bw, bh);
  }

  function applyQuality(q) {
    if (q === 'low') Object.assign(params, { resScale: 0.72, reflScale: 0.34, qualityRainMult: 0.45 });
    else if (q === 'med') Object.assign(params, { resScale: 0.9, reflScale: 0.5, qualityRainMult: 0.8 });
    else if (q === 'high') Object.assign(params, { resScale: 1.0, reflScale: 0.55, qualityRainMult: 1.0 });
    else Object.assign(params, isMobile
      ? { resScale: 0.85, reflScale: 0.42, qualityRainMult: 0.6 }
      : { resScale: 1.0, reflScale: 0.5, qualityRainMult: 1.0 });
    lastW = 0; // force RT rebuild
    resize();
  }

  function buildState(frameT, reflEye) {
    return {
      gl, canvas, params,
      time: simT, frameT,
      cam, viewProj, invVP, invView,
      W: lastW, H: lastH,
      moonDir, skyZenith, skyHorizon, cloudOff, skyP,
      ambient, flash, fogDensity, fogColor,
      windDir, waveAmp, dockP, camRight, camUp,
      lightCount: lights.lightCount,
      lightsFlat: lights.lightsFlat,
      clipPlane: reflEye ? REFL_PLANE : FAR_PLANE,
      reflection: !!reflEye,
    };
  }

  const cam = { eye: [0, 8, -30], look: [0, 2, 0], view, proj };
  let moonDir = [0, 1, 0], skyZenith = [0, 0, 0], skyHorizon = [0, 0, 0];
  let cloudOff = [0, 0], skyP = [0.6, 1, 0.3, 0];
  let ambient = [0.02, 0.024, 0.03], flash = 0, fogDensity = 0.0028, fogColor = [0.03, 0.032, 0.036];
  let windDir = [0.6, 0.8], waveAmp = 1, dockP = [0.7, 1, 1, 0.5];
  let camRight = [1, 0, 0], camUp = [0, 1, 0];

  function frame(dtReal, tAbs) {
    resize();
    const dt = params.paused ? 0 : Math.min(dtReal, 0.05);
    simT += dt;

    // camera
    const cst = camera.update(dt, tAbs, params, W()/Math.max(H(), 1));
    view.set(cst.view); proj.set(cst.proj);
    cam.eye = cst.eye; cam.look = cst.look;

    // derived matrices
    multiply(viewProj, proj, view);
    invert(invVP, viewProj);
    invert(invView, view);
    multiply(reflView, view, S);
    multiply(reflViewProj, proj, reflView);
    invert(reflInvVP, reflViewProj);

    const eye = cst.eye;
    const reflEye = [eye[0], -eye[1], eye[2]];

    // cam basis from view rows
    camRight = [view[0], view[1], view[2]];
    camUp = [view[4], view[5], view[6]];

    // ---- atmosphere ----
    const tn = params.tint;
    skyZenith = [
      lerp(0.010, 0.017, tn)*1.6, lerp(0.017, 0.023, tn)*1.6, lerp(0.031, 0.031, tn)*1.6,
    ];
    skyHorizon = [
      lerp(0.042, 0.056, tn)*1.5, lerp(0.053, 0.063, tn)*1.5, lerp(0.072, 0.072, tn)*1.4,
    ];
    const moonI = clamp(0.72 + 0.28*Math.sin(simT*0.06 + 3.1), 0.42, 1.0);
    const mdir = v3norm([-0.42, 0.46, 0.42], []);
    moonDir = [mdir[0], mdir[1], mdir[2]];
    cloudOff = [simT*0.0075*(0.4 + params.wind), simT*0.0045*(0.4 + params.wind)];
    skyP = [0.62 + 0.10*params.wind, moonI*1.15, 0.32*(1 - 0.6*params.wind), flash];

    fogDensity = 0.0026*(0.45 + params.fog*0.75);
    fogColor = [
      skyHorizon[0]*0.5 + 0.008, skyHorizon[1]*0.5 + 0.010, skyHorizon[2]*0.5 + 0.014,
    ];
    ambient = [
      skyHorizon[0]*0.24 + skyZenith[0]*0.5, skyHorizon[1]*0.24 + skyZenith[1]*0.5, skyHorizon[2]*0.24 + skyZenith[2]*0.5,
    ];

    // wind
    const wa = 0.9 + Math.sin(simT*0.043)*0.5;
    const wm = 0.35 + 0.75*params.wind;
    windDir = [Math.sin(wa)*wm, Math.cos(wa)*wm];
    waveAmp = 0.65 + 0.55*params.wind;

    dockP = [clamp(params.rain*0.8, 0.15, 1), clamp(params.rain, 0.1, 1), 1.35, clamp(params.rain, 0, 1.2)*0.5];

    // ---- lightning ----
    if (simT > flashNext) {
      flashStart = simT;
      flashNext = simT + 14 + Math.random()*30;
      if (hooks.onThunder) hooks.onThunder(0.6 + Math.random()*2.4);
    }
    const fe = simT - flashStart;
    flash = 0;
    for (const p of [0, 0.09, 0.22]) {
      if (fe > p) flash += Math.exp(-(fe - p)*22);
    }
    flash = Math.min(flash, 1.4);

    // ---- dynamic actors ----
    lights.update(dt, simT, params);
    props.updateBarge(simT, waveAmp);

    const mainSt = buildState(tAbs, false);
    const reflSt = buildState(tAbs, true);
    reflSt.cam = { eye: reflEye, view: reflView, proj };
    reflSt.viewProj = reflViewProj;
    reflSt.invVP = reflInvVP;

    // ================= reflection pass =================
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflRT.fb);
    gl.viewport(0, 0, reflRT.w, reflRT.h);
    gl.clearColor(0.002, 0.003, 0.005, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);          // mirrored winds
    sky.draw(reflSt);
    props.draw(reflSt);
    reflSt.cam = { eye, view, proj };  // glow/cone billboards use real basis
    reflSt.viewProj = reflViewProj;
    lights.drawGlows(reflSt);
    lights.drawCones(reflSt);
    gl.enable(gl.CULL_FACE);

    // ================= main pass =================
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRT.fb);
    gl.viewport(0, 0, sceneRT.w, sceneRT.h);
    gl.clearColor(0.002, 0.003, 0.005, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    sky.draw(mainSt);
    sea.draw(mainSt);
    dock.draw(mainSt, reflRT.tex);
    props.draw(mainSt);
    props.drawShadows(mainSt);
    rain.draw(mainSt);
    lights.drawCones(mainSt);
    lights.drawGlows(mainSt);

    // ================= post =================
    post.fsBegin();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // bright → bloomA
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    post.bright.use();
    post.bright.tex('uTex', sceneRT.tex, 0);
    post.bright.set('uThresh', 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // separable blur ping-pong, two iterations
    const blurPass = (src, dst, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      post.blur.use();
      post.blur.tex('uTex', src.tex, 0);
      post.blur.set('uDirTexel', [dx/src.w, dy/src.h]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    for (let i = 0; i < 2; i++) {
      blurPass(bloomA, bloomB, 1, 0);
      blurPass(bloomB, bloomA, 0, 1);
    }

    // composite → LDR
    gl.bindFramebuffer(gl.FRAMEBUFFER, ldrRT.fb);
    gl.viewport(0, 0, ldrRT.w, ldrRT.h);
    post.composite.use();
    post.composite.tex('uTex', sceneRT.tex, 0);
    post.composite.tex('uBloomTex', bloomA.tex, 1);
    post.composite.set('uBloomStr', 0.65);
    post.composite.set('uExposure', params.exposure);
    post.composite.set('uTime', tAbs);
    post.composite.set('uDroplet', clamp(params.rain, 0, 1)*0.85);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // final to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    post.final.use();
    post.final.tex('uTex', ldrRT.tex, 0);
    post.final.set('uRes', [canvas.width, canvas.height]);
    post.final.set('uTime', tAbs);
    post.final.set('uGrainI', 0.045);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    post.fsEnd();
  }

  resize();

  return {
    params, resize, frame, applyQuality,
    stats: { get lights() { return lights.lightCount; } },
  };
}
