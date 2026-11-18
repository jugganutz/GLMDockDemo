// rain.js — camera-space rain streaks + ground splash rings
import { Program, makeBuffer, vaoAttrib, makeMeshVAO } from '../engine/gl.js';
import { GLSL_COMMON, GLSL_LIGHTS } from '../engine/noise.glsl.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const UNIS = `
uniform mat4 uProj;
uniform mat4 uInvView;
uniform float uTime;
uniform vec2 uWindWorld;
uniform float uRainI;
`;

// ---- streaks: instanced quads positioned in camera space, wrapped around the eye
const VS = HEAD + GLSL_COMMON + GLSL_LIGHTS + `
layout(location=0) in vec2 aCorner;
layout(location=3) in vec4 aSeed;   // xz offset (disk), y height slot, w speed
layout(location=4) in vec4 aExtra;  // len, width, personal drift, glowSeed
uniform mat4 uProj;
uniform mat4 uInvView;
uniform float uTime;
uniform vec2 uWindWorld;
uniform float uRainI;
out float vAlpha;
out float vLit;
void main(){
  float span = 26.0;
  float fall = mod(aSeed.y - uTime*aSeed.w, span) - 8.0;    // -8 .. 18
  float wp = clamp(fall*0.045 + aExtra.z*0.2, -1.0, 2.0);
  vec3 cp = vec3(aSeed.x + uWindWorld.x*wp*3.0, fall, aSeed.z + uWindWorld.y*wp*3.0);
  vec3 dir = normalize(vec3(uWindWorld.x*0.55 - 0.06, -1.0, uWindWorld.y*0.55 + 0.04));
  vec3 side = normalize(cross(dir, vec3(0.0, 0.0, -1.0)));
  vec3 p = cp + side*(aCorner.x*aExtra.y) + dir*(aCorner.y*aExtra.x*0.5);
  vec3 wpos = (uInvView * vec4(p, 1.0)).xyz;
  vLit = lightsGlow(wpos)*0.85 + 0.06;
  float d = length(p);
  vAlpha = smoothstep(1.2, 2.6, d)*smoothstep(24.0, 13.0, d);
  vAlpha *= 0.06 + 0.16*uRainI;
  vAlpha *= 0.7 + 0.5*hash11(aExtra.z*61.7);
  gl_Position = uProj*vec4(p, 1.0);
}
`;

const FS = HEAD + `
in float vAlpha;
in float vLit;
out vec4 fragColor;
void main(){
  vec3 col = mix(vec3(0.42, 0.47, 0.52), vec3(1.0, 0.92, 0.78), clamp(vLit*2.2, 0.0, 1.0));
  fragColor = vec4(col*(0.25 + vLit*1.4), vAlpha);
}
`;

// ---- splash rings on the dock
const VS_S = HEAD + GLSL_COMMON + GLSL_LIGHTS + `
layout(location=0) in vec2 aCorner;
layout(location=3) in vec4 aData;   // x, z, phase, seed
uniform mat4 uViewProj;
uniform float uTime;
uniform float uRainI;
out vec2 vCor;
out float vLife;
out float vLit;
void main(){
  float period = 0.55 + aData.w*0.7;
  float life = fract(uTime/period + aData.z);
  float r = life*0.36;
  vec2 xz = aData.xy + aCorner*r;
  vec3 wpos = vec3(xz.x, 0.035, xz.y);
  vCor = aCorner;
  vLife = life;
  vLit = lightsGlow(wpos)*0.9;
  gl_Position = uViewProj*vec4(wpos, 1.0);
}
`;

const FS_S = HEAD + `
in vec2 vCor;
in float vLife;
in float vLit;
out vec4 fragColor;
uniform float uRainI;
void main(){
  float r = length(vCor);
  float ring = smoothstep(0.30, 0.05, abs(r - 0.85))*(1.0 - vLife);
  float pop  = smoothstep(0.42, 0.05, r)*max(0.0, 1.0 - vLife*7.0);
  float a = (ring*0.4 + pop*0.8)*(0.04 + 0.26*clamp(vLit*2.0, 0.0, 1.4))*clamp(uRainI, 0.0, 1.5);
  vec3 col = mix(vec3(0.5, 0.55, 0.6), vec3(1.0, 0.93, 0.78), clamp(vLit*2.0, 0.0, 1.0));
  fragColor = vec4(col, a);
}
`;

// ---- JS wiring
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_STREAKS = 3200;
const MAX_SPLASH = 420;

export function createRain(gl) {
  const streakProg = new Program(gl, VS, FS, 'rain');
  const splashProg = new Program(gl, VS_S, FS_S, 'splash');

  const rnd = mulberry(99212);

  // streak instance data
  const seedA = new Float32Array(MAX_STREAKS*4);
  const extraA = new Float32Array(MAX_STREAKS*4);
  for (let i = 0; i < MAX_STREAKS; i++) {
    const ang = rnd()*Math.PI*2;
    const rad = Math.sqrt(rnd())*20.0;
    seedA[i*4+0] = Math.cos(ang)*rad;
    seedA[i*4+1] = rnd()*26.0;
    seedA[i*4+2] = Math.sin(ang)*rad;
    seedA[i*4+3] = 9.0 + rnd()*7.0;             // fall speed m/s
    extraA[i*4+0] = 0.75 + rnd()*0.9;           // length
    extraA[i*4+1] = 0.010 + rnd()*0.012;        // half-width
    extraA[i*4+2] = rnd() - 0.5;                // drift
    extraA[i*4+3] = rnd();
  }
  const cornerBuf = makeBuffer(gl, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]));

  const streakVAO = gl.createVertexArray();
  gl.bindVertexArray(streakVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const seedBuf = makeBuffer(gl, seedA);
  const extraBuf = makeBuffer(gl, extraA);
  vaoAttrib(gl, streakVAO, 3, seedBuf, 4, 1);
  vaoAttrib(gl, streakVAO, 4, extraBuf, 4, 1);
  gl.bindVertexArray(null);

  // splash instance data: uniform over the apron
  const splashData = new Float32Array(MAX_SPLASH*4);
  for (let i = 0; i < MAX_SPLASH; i++) {
    splashData[i*4+0] = -95 + rnd()*190;
    splashData[i*4+1] = -78 + rnd()*76;
    splashData[i*4+2] = rnd();
    splashData[i*4+3] = rnd();
  }
  const splashVAO = gl.createVertexArray();
  gl.bindVertexArray(splashVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const splashBuf = makeBuffer(gl, splashData);
  vaoAttrib(gl, splashVAO, 3, splashBuf, 4, 1);
  gl.bindVertexArray(null);

  return {
    streakProg, splashProg, MAX_STREAKS, MAX_SPLASH,
    draw(st) {
      const g = st.gl;
      g.enable(g.DEPTH_TEST);
      g.depthMask(false);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE);   // additive
      g.disable(g.CULL_FACE);

      const n = Math.min(MAX_STREAKS, Math.floor(MAX_STREAKS*Math.min(1, st.params.rain*0.5 + 0.1)*st.params.qualityRainMult));

      streakProg.use();
      streakProg.set('uProj', st.cam.proj);
      streakProg.set('uInvView', st.invView);
      streakProg.set('uTime', st.time);
      streakProg.set('uWindWorld', st.windDir);
      streakProg.set('uRainI', st.params.rain);
      streakProg.setInt('uLightCount', st.lightCount);
      streakProg.setFV('uLightData', st.lightsFlat);
      g.bindVertexArray(streakVAO);
      g.drawArraysInstanced(g.TRIANGLES, 0, 6, n);

      // splashes only on the apron area near the camera interest
      const m = Math.min(MAX_SPLASH, Math.floor(MAX_SPLASH*Math.min(1, st.params.rain)*st.params.qualityRainMult));
      splashProg.use();
      splashProg.set('uViewProj', st.viewProj);
      splashProg.set('uTime', st.time);
      splashProg.set('uRainI', st.params.rain);
      splashProg.setInt('uLightCount', st.lightCount);
      splashProg.setFV('uLightData', st.lightsFlat);
      g.bindVertexArray(splashVAO);
      g.drawArraysInstanced(g.TRIANGLES, 0, 6, m);

      g.enable(g.CULL_FACE);
      g.disable(g.BLEND);
      g.depthMask(true);
      g.bindVertexArray(null);
    },
  };
}

