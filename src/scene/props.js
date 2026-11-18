// props.js — containers (corrugated + stenciled), gantry crane, barge, masts,
// pilings, bollards, fenders + blob shadows. All geometry generated in code.
import { Program, makeMeshVAO, makeBuffer, vaoAttrib } from '../engine/gl.js';
import { buildBox, buildCylinder } from '../engine/geometry.js';
import { GLSL_COMMON, GLSL_LIGHTS } from '../engine/noise.glsl.js';
import { waveHeightCPU } from './sea.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const FS_COMMON = `
uniform vec4 uClipPlane;
uniform vec3 uCamPos;
uniform vec3 uMoonDir;
uniform float uMoonI;
uniform float uTime;
uniform vec3 uAmbient;
uniform float uFlash;
uniform float uFogDensity;
uniform vec3 uFogColor;
`;

// ------------------------------------------------ structure VS/FS (crane, masts, poles...)
const VS_STRUCT = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=3) in vec4 aI0;   // pos.xyz, rotY
layout(location=4) in vec4 aI1;   // scale.xyz, rough
layout(location=5) in vec4 aI2;   // color.rgb, seed
layout(location=6) in vec4 aI3;   // pitch, roll, -, -
uniform mat4 uViewProj;
out vec3 vWorld; out vec3 vN; out vec3 vCol; out vec2 vMeta;
mat3 rotYm(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotXm(float a){ float c=cos(a), s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 rotZm(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }
void main(){
  vec3 local = aPos*aI1.xyz;
  mat3 R = rotYm(aI0.w)*rotXm(aI3.x)*rotZm(aI3.y);
  vec3 w = R*local + aI0.xyz;
  vWorld = w; vN = R*aNrm; vCol = aI2.rgb; vMeta = vec2(aI1.w, aI2.w);
  gl_Position = uViewProj*vec4(w, 1.0);
}
`;

const FS_STRUCT = HEAD + GLSL_COMMON + GLSL_LIGHTS + FS_COMMON + `
in vec3 vWorld; in vec3 vN; in vec3 vCol; in vec2 vMeta;
out vec4 fragColor;
void main(){
  if (dot(vec4(vWorld,1.0), uClipPlane) < 0.0) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  float seed = vMeta.y;
  float rough = clamp(vMeta.x, 0.05, 1.0);
  vec3 alb = vCol*(0.82 + 0.36*vnoise3(vec3(vWorld.xz*0.4, vWorld.y*0.4 + seed*31.0)));
  float streak = fbm2(vec2(vWorld.x*0.5, vWorld.y*0.1) + seed*3.3);
  alb *= mix(1.0, 0.7, smoothstep(0.5, 0.85, streak));
  vec3 ld = lightsDiffuse(vWorld, N);
  vec3 ls = lightsSpecular(vWorld, N, V, rough);
  vec3 col = alb*(uAmbient*2.2*(1.0 + uFlash*3.0) + ld*1.2) + ls*0.5;
  col += vec3(0.75, 0.82, 0.95)*ggxSpec(N, V, uMoonDir, 0.5)*uMoonI*0.1;
  float dist = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, heightFog(dist, vWorld.y, uFogDensity));
  fragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------ container VS/FS
const VS_CONT = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aI0;   // pos.xyz, rotY
layout(location=4) in vec4 aI1;   // scale.xyz, rough(unused)
layout(location=5) in vec4 aI2;   // color.rgb, seed
layout(location=6) in vec4 aI3;   // tileU, tileV, rustBias, hasDoor
uniform mat4 uViewProj;
out vec3 vWorld; out vec3 vN; out vec3 vNL; out vec2 vUV;
out vec3 vLocal; out vec3 vScale; out vec3 vCol; out vec4 vI3;
mat3 rotYm(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
void main(){
  vec3 local = aPos*aI1.xyz;
  mat3 R = rotYm(aI0.w);
  vec3 w = R*local + aI0.xyz;
  vWorld = w; vN = R*aNrm; vNL = aNrm; vUV = aUV;
  vLocal = local; vScale = aI1.xyz; vCol = aI2.rgb; vI3 = aI3;
  gl_Position = uViewProj*vec4(w, 1.0);
}
`;

const FS_CONT = HEAD + GLSL_COMMON + GLSL_LIGHTS + FS_COMMON + `
uniform sampler2D uTextTex;
in vec3 vWorld; in vec3 vN; in vec3 vNL; in vec2 vUV;
in vec3 vLocal; in vec3 vScale; in vec3 vCol; in vec4 vI3;
out vec4 fragColor;
void main(){
  if (dot(vec4(vWorld,1.0), uClipPlane) < 0.0) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  float seed = fract(vI3.x*13.7 + vI3.y*7.3);
  vec3 alb = vCol*(0.82 + 0.36*vnoise3(vec3(vLocal.xy*0.5, vLocal.z*0.5 + seed*31.0)));
  bool side = abs(vNL.z) > 0.5;
  bool endF = abs(vNL.x) > 0.5;
  if (side){
    float ribs = cos(vLocal.x*22.44);
    vec3 tT = normalize(cross(vec3(0.0,1.0,0.0), N));
    N = normalize(N + tT*ribs*0.38);
    alb *= 0.84 + 0.32*smoothstep(-0.35, 0.85, ribs);
  }
  float bt = clamp(0.5 - vLocal.y/vScale.y, 0.0, 1.0);   // 0 top .. 1 bottom
  float rust = smoothstep(0.72 - vI3.z, 0.86 - vI3.z, fbm2(vec2(vLocal.x*0.5 + seed*37.0, vLocal.y*0.07)));
  rust *= 0.35 + 1.15*bt;
  vec3 rustCol = vec3(0.20, 0.10, 0.05)*(0.55 + 0.6*vnoise(vec2(vLocal.x*3.0, vLocal.y*2.0) + seed*9.0));
  alb = mix(alb, rustCol, clamp(rust, 0.0, 0.88));
  alb *= 1.0 - 0.42*smoothstep(0.78, 1.0, bt);
  float m = max(max(abs(vLocal.x)/vScale.x, abs(vLocal.y)/vScale.y), abs(vLocal.z)/vScale.z);
  alb *= mix(1.0, 0.5, smoothstep(0.80, 0.93, m));
  if (endF && vI3.w > 0.5){
    float zz = vLocal.z/max(vScale.z, 0.01);
    float rr = abs(fract(zz*4.0 + 0.5) - 0.5);
    float rod = smoothstep(0.09, 0.03, rr);
    alb = mix(alb, alb*1.6 + vec3(0.06, 0.055, 0.05), rod*0.6);
    alb *= 1.0 - 0.5*smoothstep(0.02, 0.008, abs(zz));
    vec2 tuv = clamp(vec2((vUV.x - 0.12)/0.76, (vUV.y - 0.60)/0.30), 0.0, 1.0);
    float mask = texture(uTextTex, vI3.xy + tuv*0.5).r;
    mask *= smoothstep(0.15, 0.5, fbm2(vLocal.xy*2.3 + seed*5.0) + 0.2);
    alb = mix(alb, vec3(0.66, 0.68, 0.7), mask*0.85);
  }
  vec3 ld = lightsDiffuse(vWorld, N);
  vec3 ls = lightsSpecular(vWorld, N, V, 0.42);
  vec3 col = alb*(uAmbient*2.4*(1.0 + uFlash*3.0) + ld) + ls*0.45;
  col += vec3(0.75, 0.82, 0.95)*ggxSpec(N, V, uMoonDir, 0.6)*uMoonI*0.12;
  float dist = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, heightFog(dist, vWorld.y, uFogDensity));
  fragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------ blob shadow decals
const VS_SHADOW = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=3) in vec4 aP;   // x, y, z, rot
layout(location=4) in vec4 aS;   // radiusX, radiusZ, strength, -
uniform mat4 uViewProj;
out float vR; out float vStrength;
void main(){
  float c = cos(aP.w), s = sin(aP.w);
  vec2 e = aCorner*vec2(aS.x, aS.y);
  vec2 xz = aP.xz + vec2(c*e.x + s*e.y, -s*e.x + c*e.y);
  vR = length(aCorner);
  vStrength = aS.z;
  gl_Position = uViewProj*vec4(xz.x, aP.y, xz.y, 1.0);
}
`;

const FS_SHADOW = HEAD + `
in float vR; in float vStrength;
out vec4 fragColor;
void main(){
  float a = vStrength*pow(max(1.0 - vR, 0.0), 1.7);
  fragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

// ------------------------------------------------ JS builders
function instBuffers(gl, list, dynamic = false) {
  const n = list.length;
  const cols = [new Float32Array(n*4), new Float32Array(n*4), new Float32Array(n*4), new Float32Array(n*4)];
  const zero = [0, 0, 0, 0];
  list.forEach((inst, i) => { for (let c = 0; c < 4; c++) cols[c].set(inst[c] || zero, i*4); });
  return cols.map((d) => makeBuffer(gl, d, gl.ARRAY_BUFFER, dynamic));
}
function attachInst(gl, vao, bufs, locs = [3, 4, 5, 6]) {
  locs.forEach((l, i) => vaoAttrib(gl, vao, l, bufs[i], 4, 1));
}

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

function makeTextTexture(gl) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 1024, 512);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const codes = ['MSCU 738 491 2', 'TCLU 452 107 7', 'CMAU 220 554 6', 'HLCU 903 118 0'];
  codes.forEach((code, i) => {
    const tx = (i % 2)*512 + 256, ty = Math.floor(i/2)*256 + 128;
    x.fillStyle = '#c9ced4';
    x.font = '700 52px Arial, sans-serif';
    x.fillText(code, tx, ty - 16);
    x.fillStyle = '#99a1aa';
    x.font = '600 30px Arial, sans-serif';
    x.fillText('MAX GROSS 30 480 KG', tx, ty + 52);
    x.font = '600 26px Arial, sans-serif';
    x.fillText('TARE 3 880 K  CU-CAP 22', tx, ty + 94);
  });
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createProps(gl) {
  const box = buildBox();
  const cylMesh = makeMeshVAO(gl, buildCylinder(14));
  const boxMesh = makeMeshVAO(gl, box);
  const contVAO = makeMeshVAO(gl, box);   // separate VAO for container instancing
  const bargeVAO = makeMeshVAO(gl, box);

  const structProg = new Program(gl, VS_STRUCT, FS_STRUCT, 'struct');
  const contProg = new Program(gl, VS_CONT, FS_CONT, 'container');
  const shadowProg = new Program(gl, VS_SHADOW, FS_SHADOW, 'shadow');
  const textTex = makeTextTexture(gl);

  const rnd = mulberry(20261117);
  const SB = [];  // structure boxes
  const SC = [];  // structure cylinders
  const CT = [];  // containers
  const SH = [];  // blob shadows

  const addB = (x, y, z, rot, sx, sy, sz, rough, col, seed = rnd(), pitch = 0, roll = 0) =>
    SB.push([[x, y, z, rot], [sx, sy, sz, rough], [col[0], col[1], col[2], seed], [pitch, roll, 0, 0]]);
  const addC = (x, y, z, rot, sx, sy, sz, rough, col, seed = rnd(), pitch = 0, roll = 0) =>
    SC.push([[x, y, z, rot], [sx, sy, sz, rough], [col[0], col[1], col[2], seed], [pitch, roll, 0, 0]]);

  // ---- palette ----
  const CRANE_RED = [0.088, 0.036, 0.030];
  const CRANE_DK = [0.050, 0.050, 0.056];
  const CONCRETE = [0.055, 0.058, 0.062];
  const IRON = [0.038, 0.040, 0.044];
  const PALETTE = [
    [0.255, 0.10, 0.075], [0.075, 0.13, 0.17], [0.10, 0.155, 0.11],
    [0.28, 0.155, 0.04], [0.16, 0.16, 0.17], [0.19, 0.12, 0.06],
    [0.12, 0.105, 0.06],
  ];

  // ---- container rows on the apron ----
  const rows = [ { z: -13, n: 8, x0: -63 }, { z: -26, n: 7, x0: -58 }, { z: -39, n: 6, x0: -52 } ];
  rows.forEach((r) => {
    for (let i = 0; i < r.n; i++) {
      const x = r.x0 + i*13.8 + (rnd() - 0.5)*0.6;
      const tiers = rnd() < 0.32 ? 2 : 1;
      const rotY = rnd() < 0.12 ? Math.PI/2 : 0;
      const col = PALETTE[Math.floor(rnd()*PALETTE.length)];
      const tileU = Math.floor(rnd()*2)*0.5;
      const tileV = rnd() < 0.5 ? 0.5 : 0.0;
      const rust = 0.04 + rnd()*0.24;
      for (let tier = 0; tier < tiers; tier++) {
        const y = 1.31 + tier*2.62;
        CT.push([[x, y, r.z, rotY], [12.2, 2.6, 2.44, 0.5], [col[0], col[1], col[2], rnd()], [tileU, tileV, rust, 1]]);
      }
      SH.push([[x, 0.02, r.z, rotY], [7.4, 2.6, 0.55, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    }
  });
  // scattered singles with doors aimed across the quay
  [[-55, -5.2], [12, -5.0], [57, -5.4]].forEach(([x, z]) => {
    const col = PALETTE[Math.floor(rnd()*PALETTE.length)];
    CT.push([[x, 1.31, z, Math.PI/2], [12.2, 2.6, 2.44, 0.5], [col[0], col[1], col[2], rnd()], [0, 0.5, 0.1 + rnd()*0.15, 1]]);
    SH.push([[x, 0.02, z, Math.PI/2], [2.6, 7.4, 0.55, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  });

  // ---- gantry crane over the berth ----
  const legH = 34;
  [[-13], [13]].forEach(([x]) => {
    addB(x, 17, 18, 0, 1.5, legH, 1.5, 0.6, CRANE_RED);
    addB(x, 17, -16, 0, 1.5, legH, 1.5, 0.6, CRANE_RED);
    addB(x, 33, 1, 0, 1.2, 1.2, 35, 0.55, CRANE_DK);          // longitudinal tie
    SH.push([[x, 0.02, 18, 0], [1.9, 1.9, 0.6, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    SH.push([[x, 0.02, -16, 0], [1.9, 1.9, 0.6, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  });
  addB(0, 34.4, 18, 0, 27.5, 1.4, 1.4, 0.55, CRANE_DK);       // portal beam (sea end)
  addB(0, 34.4, -16, 0, 27.5, 1.4, 1.4, 0.55, CRANE_DK);      // portal beam (land end)  // A-frames up to the girder
  [[18, 1], [18, -1], [-16, 1], [-16, -1]].forEach(([z, sgn]) => {
    addB(sgn*6.5, 36.2, z, 0, 1.1, 13.8, 1.1, 0.55, CRANE_RED, rnd(), 0, sgn*1.238);
  });
  addB(0, 39.5, 2, 0, 3.0, 2.8, 62, 0.55, CRANE_RED);         // main girder
  addB(7.5, 41.6, -4, 0, 6.0, 3.0, 8.5, 0.6, CRANE_RED);      // machinery house
  addB(7.5, 43.25, -4, 0, 6.6, 0.25, 9.0, 0.7, CRANE_DK);
  addB(0, 37.0, 22, 0, 3.4, 2.2, 4.0, 0.5, CRANE_DK);         // trolley
  [[-0.9], [0.9]].forEach(([x]) => {
    addC(x, 29.9, 22, 0, 0.09, 12.2, 0.09, 0.35, [0.02, 0.02, 0.022]);
  });
  addB(0, 23.4, 22, 0, 12.0, 0.45, 0.8, 0.5, [0.025, 0.025, 0.027]); // spreader
  // pier slabs under the sea-side legs (extend below wave troughs)
  addB(-13, -3.5, 18, 0, 8, 7, 11, 0.8, CONCRETE);
  addB(13, -3.5, 18, 0, 8, 7, 11, 0.8, CONCRETE);

  // ---- lamp masts along the quay edge ----
  const LAMPS_X = [-70, -35, 0, 35, 70];
  LAMPS_X.forEach((x) => {
    addC(x, 4.7, -4, 0, 0.34, 9.4, 0.34, 0.5, IRON);
    addC(x, 9.35, -2.6, 0, 0.2, 2.8, 0.2, 0.5, IRON, rnd(), Math.PI/2, 0);
    addB(x, 9.0, -1.55, 0, 0.6, 0.42, 0.75, 0.6, [0.028, 0.028, 0.03]);
    SH.push([[x, 0.02, -4, 0], [1.4, 1.4, 0.5, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  });

  // ---- bollards ----
  for (let x = -88; x <= 88; x += 11) {
    addC(x, 0.52, -2.4, 0, 0.72, 1.0, 0.72, 0.55, [0.05, 0.05, 0.052]);
    addC(x, 0.16, -2.4, 0, 1.05, 0.32, 1.05, 0.7, [0.055, 0.055, 0.055]);
    SH.push([[x, 0.02, -2.4, 0], [0.85, 0.85, 0.45, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  }

  // ---- fenders on the water wall ----
  for (let x = -90; x <= 90; x += 9) {
    addC(x, -1.55, 0.24, 0, 0.4, 2.8, 0.4, 0.8, [0.030, 0.030, 0.031], rnd(), 0, Math.PI/2);
  }

  // ---- piling clusters in the water ----
  const PILES = [[-42], [-16], [16], [46], [-62], [62]];
  PILES.forEach(([px]) => {
    const offs = [[0, 0], [0.75, 0.3], [1.45, -0.22]];
    offs.forEach(([ox, oz]) => {
      addC(px + ox, -0.7, 4.5 + oz, 0, 0.52, 7.8, 0.52, 0.85, [0.042, 0.038, 0.034], rnd(),
        (rnd() - 0.5)*0.06, (rnd() - 0.5)*0.06);
    });
  });

  // ---- moored barge (dynamic, bobs on the swell) ----
  const BARGE_ITEMS = [
    [[0, -0.55, 0, 0], [26, 3.4, 7.0, 0.55], [0.030, 0.032, 0.034, 0.5], [0, 0, 0, 0]],
    [[0, 1.33, 0, 0], [26.4, 0.75, 6.3, 0.6], [0.020, 0.021, 0.023, 0.5], [0, 0, 0, 0]],
    [[-9.6, 1.5, 0, 0], [4.6, 3.0, 5.6, 0.65], [0.050, 0.052, 0.055, 0.4], [0, 0, 0, 0]],
    [[-9.6, 3.25, 0, 0], [5.1, 0.28, 6.1, 0.7], [0.030, 0.032, 0.034, 0.4], [0, 0, 0, 0]],
    [[-2.5, 2.1, 0, 0], [2.2, 2.4, 2.2, 0.5], [0.028, 0.029, 0.031, 0.5], [0, 0, 0, 0]],
    [[-2.5, 4.3, 2.6, 0], [0.42, 7.0, 0.42, 0.5], [0.026, 0.027, 0.028, 0.4], [-0.62, 0, 0, 0]],
    [[-11.4, 3.2, 1.2, 0], [0.14, 4.8, 0.14, 0.5], [0.040, 0.042, 0.045, 0.4], [0, 0, 0, 0]],
    [[3.2, 2.42, 1.1, 0], [6.1, 2.6, 2.44, 0.55], [0.065, 0.12, 0.16, 0.5], [0, 0, 0, 0]],
    [[10.0, 2.42, -1.2, 0], [6.1, 2.6, 2.44, 0.55], [0.155, 0.155, 0.165, 0.5], [0, 0, 0, 0]],
    [[6.6, 5.02, -0.1, 0], [6.1, 2.6, 2.44, 0.55], [0.30, 0.15, 0.035, 0.5], [0, 0, 0, 0]],
  ];
  const BGX = 34, BGZ = 16, BGR = 0.12;
  const bcg = Math.cos(BGR), bsg = Math.sin(BGR);
  const bargeCols = [0, 1, 2, 3].map(() => new Float32Array(BARGE_ITEMS.length*4));
  const bargeBufs = bargeCols.map((d) => makeBuffer(gl, d, gl.ARRAY_BUFFER, true));

  function updateBarge(t, amp) {
    const cx = BGX, cz = BGZ;
    const h = waveHeightCPU(cx, cz, t, amp)*0.45;
    const hx = (waveHeightCPU(cx + 4, cz, t, amp) - waveHeightCPU(cx - 4, cz, t, amp))/8;
    const hz = (waveHeightCPU(cx, cz + 4, t, amp) - waveHeightCPU(cx, cz - 4, t, amp))/8;
    BARGE_ITEMS.forEach((it, i) => {
      const [lx, ly, lz] = it[0];
      const wx = cx + bcg*lx + bsg*lz;
      const wz = cz - bsg*lx + bcg*lz;
      const base = i*4;
      bargeCols[0].set([wx, ly + h, wz, 0], base);
      bargeCols[1].set(it[1], base);
      bargeCols[2].set(it[2], base);
      bargeCols[3].set([hz*0.35, -hx*0.35, 0, 0], base);
    });
    const glb = gl;
    glb.bindBuffer(glb.ARRAY_BUFFER, bargeBufs[0]); glb.bufferSubData(glb.ARRAY_BUFFER, 0, bargeCols[0]);
    glb.bindBuffer(glb.ARRAY_BUFFER, bargeBufs[1]); glb.bufferSubData(glb.ARRAY_BUFFER, 0, bargeCols[1]);
    glb.bindBuffer(glb.ARRAY_BUFFER, bargeBufs[2]); glb.bufferSubData(glb.ARRAY_BUFFER, 0, bargeCols[2]);
    glb.bindBuffer(glb.ARRAY_BUFFER, bargeBufs[3]); glb.bufferSubData(glb.ARRAY_BUFFER, 0, bargeCols[3]);
  }
  updateBarge(0, 1);

  // ---- VAO wiring ----
  const sbB = instBuffers(gl, SB);
  attachInst(gl, boxMesh.vao, sbB);
  const scB = instBuffers(gl, SC);
  attachInst(gl, cylMesh.vao, scB);
  const cb = instBuffers(gl, CT);
  attachInst(gl, contVAO.vao, cb);
  attachInst(gl, bargeVAO.vao, bargeBufs);

  // shadow VAO: corner quad + per-instance data
  const shVAO = gl.createVertexArray();
  gl.bindVertexArray(shVAO);
  const cornersF = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
  const shCorner = makeBuffer(gl, cornersF);
  gl.bindBuffer(gl.ARRAY_BUFFER, shCorner);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const SH_INST = [];
  const shList = SH.map((s) => [s[0], s[1]]);
  const shBufs = instBuffers(gl, shList, false);
  attachInst(gl, shVAO, shBufs, [3, 4]);
  gl.bindVertexArray(null);
  const shCount = shList.length;

  const counts = { sb: SB.length, sc: SC.length, cont: CT.length, barge: BARGE_ITEMS.length, shadow: shCount };

  function setCommon(p, st) {
    p.set('uViewProj', st.viewProj);
    p.set('uClipPlane', st.clipPlane);
    p.set('uCamPos', st.cam.eye);
    p.set('uMoonDir', st.moonDir);
    p.set('uMoonI', st.skyP[1]);
    p.set('uTime', st.time);
    p.set('uAmbient', st.ambient);
    p.set('uFlash', st.flash);
    p.set('uFogDensity', st.fogDensity);
    p.set('uFogColor', st.fogColor);
    p.setInt('uLightCount', st.lightCount);
    p.setFV('uLightData', st.lightsFlat);
  }

  return {
    structProg, contProg, shadowProg, counts,
    updateBarge,
    draw(st) {
      const g = st.gl;
      g.enable(g.DEPTH_TEST);
      g.depthMask(true);
      if (st.reflection) {
        // mirrored view flips winding — cull off for the reflection pass
        g.disable(g.CULL_FACE);
      } else {
        g.enable(g.CULL_FACE);
        g.cullFace(g.BACK);
        g.frontFace(g.CCW);
      }

      // structure (boxes)
      structProg.use();
      setCommon(structProg, st);
      g.bindVertexArray(boxMesh.vao);
      g.drawElementsInstanced(g.TRIANGLES, boxMesh.count, boxMesh.indexType, 0, counts.sb);
      // structure (cylinders)
      g.bindVertexArray(cylMesh.vao);
      g.drawElementsInstanced(g.TRIANGLES, cylMesh.count, cylMesh.indexType, 0, counts.sc);
      // barge
      g.bindVertexArray(bargeVAO.vao);
      g.drawElementsInstanced(g.TRIANGLES, bargeVAO.count, bargeVAO.indexType, 0, counts.barge);

      // containers
      contProg.use();
      setCommon(contProg, st);
      contProg.tex('uTextTex', textTex, 5);
      g.bindVertexArray(contVAO.vao);
      g.drawElementsInstanced(g.TRIANGLES, contVAO.count, contVAO.indexType, 0, counts.cont);

      g.bindVertexArray(null);
    },
    drawShadows(st) {
      const g = st.gl;
      shadowProg.use();
      shadowProg.set('uViewProj', st.viewProj);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.depthMask(false);
      g.disable(g.CULL_FACE);
      g.bindVertexArray(shVAO);
      g.drawArraysInstanced(g.TRIANGLES, 0, 6, counts.shadow);
      g.depthMask(true);
      g.disable(g.BLEND);
      g.enable(g.CULL_FACE);
      g.bindVertexArray(null);
    },
  };
}

