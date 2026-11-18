// sea.js — Gerstner-wave ocean with sky reflections, light pillars, foam
import { Program, makeMeshVAO } from '../engine/gl.js';
import { buildGrid } from '../engine/geometry.js';
import { GLSL_COMMON, GLSL_LIGHTS, GLSL_SKY } from '../engine/noise.glsl.js';

// wave set — also used by CPU for barge bobbing (dirs normalized)
export const WAVES = [
  { d: [0.943, 0.330], L: 60.0, A: 0.50, s: 1.00 },
  { d: [0.759, -0.651], L: 34.0, A: 0.34, s: 1.08 },
  { d: [-0.243, 0.970], L: 19.0, A: 0.20, s: 1.20 },
  { d: [0.976, 0.217], L: 10.5, A: 0.11, s: 1.35 },
];
export function waveHeightCPU(x, z, t, amp = 1) {
  let y = 0;
  for (const w of WAVES) {
    const k = 2 * Math.PI / w.L;
    const c = Math.sqrt(9.81 / k);
    const f = k * (w.d[0] * x + w.d[1] * z - c * w.s * t);
    y += w.A * amp * Math.sin(f);
  }
  return y;
}

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const COMMON_WAVES = `
uniform mat4 uViewProj;
uniform float uTime;
uniform float uWaveAmp;
const vec4 WD[6] = vec4[6](
  vec4(0.943,0.330,60.0,0.50), vec4(0.759,-0.651,34.0,0.34), vec4(-0.243,0.970,19.0,0.20),
  vec4(0.976,0.217,10.5,0.11), vec4(0.148,-0.989,5.8,0.06), vec4(-0.786,0.618,3.1,0.032));
const vec4 WP[6] = vec4[6](
  vec4(0.60,1.00,0,0), vec4(0.65,1.08,0,0), vec4(0.75,1.20,0,0),
  vec4(0.85,1.35,0,0), vec4(0.90,1.50,0,0), vec4(1.00,1.65,0,0));
vec3 gerstner(vec2 p){
  vec3 P = vec3(p.x, 0.0, p.y);
  float y = 0.0;
  for (int i = 0; i < 6; i++){
    float k = 6.2831853/WD[i].z;
    float c = sqrt(9.81/k);
    float f = k*(dot(WD[i].xy, p) - c*WP[i].y*uTime);
    float a = WD[i].w * uWaveAmp;
    P.x += WD[i].x*WP[i].x*a*cos(f);
    P.z += WD[i].y*WP[i].x*a*cos(f);
    y   += a*sin(f);
  }
  P.y = y;
  return P;
}
`;

const VS = HEAD + COMMON_WAVES + `
layout(location=0) in vec3 aPos;
out vec3 vWorld;
out vec3 vNrm;
out float vCrest;
void main(){
  vec3 P = gerstner(aPos.xz);
  float e = 0.55;
  vec3 tx = gerstner(aPos.xz + vec2(e, 0.0)) - P;
  vec3 tz = gerstner(aPos.xz + vec2(0.0, e)) - P;
  vec3 N = normalize(cross(tz, tx));
  float ampT = 0.0;
  for (int i = 0; i < 6; i++) ampT += WD[i].w * uWaveAmp;
  vCrest = P.y / max(ampT, 0.05);
  vWorld = P;
  vNrm = N;
  gl_Position = uViewProj * vec4(P, 1.0);
}
`;

const FS = HEAD + GLSL_COMMON + GLSL_LIGHTS + GLSL_SKY + `
in vec3 vWorld;
in vec3 vNrm;
in float vCrest;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec2 uCloudOff;
uniform vec4 uSkyP;
uniform vec3 uAmbient;
uniform float uFlash;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform vec2 uWindDir;
uniform vec4 uSeaP;   // x: foam amount, y: wave amp, z: -, w: -

const vec2 PILING[6] = vec2[6](vec2(-42.0,4.5), vec2(-16.0,4.5), vec2(16.0,4.5), vec2(46.0,4.5), vec2(-62.0,4.5), vec2(62.0,4.5));

void main(){
  vec3 N = normalize(vNrm);
  vec2 xz = vWorld.xz;
  float t = uTime;

  // wind-elongated micro ripples
  vec2 wd = uWindDir;
  vec2 wp = vec2(dot(xz, wd), dot(xz, vec2(-wd.y, wd.x)));
  vec3 g1 = noiseGrad3(wp * vec2(0.14, 0.75), 0.35);
  vec3 g2 = noiseGrad3(wp * vec2(0.5, 2.6) + 7.3, 0.35);
  N = normalize(N + vec3(g1.x*0.20 + g2.x*0.13, 0.0, g1.z*0.20 + g2.z*0.13));

  vec3 V = normalize(uCamPos - vWorld);
  float ndv = max(dot(N, V), 0.0);
  if (ndv < 0.05) N = normalize(N + V*0.08); // keep grazing angles sane
  ndv = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  vec3 deep = vec3(0.012, 0.020, 0.026);
  vec3 base = deep + vec3(0.004, 0.011, 0.012) * max(vCrest, 0.0) * 2.2;

  // sky reflection — shared function keeps the world coherent
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);
  vec3 sky = skyColor(R, uMoonDir, uSkyZenith, uSkyHorizon, uCloudOff, vec4(uSkyP.xyz, 0.0));

  // moon glitter path
  float ms = ggxSpec(N, V, uMoonDir, 0.13) * uSkyP.y * 2.4
           + ggxSpec(N, V, uMoonDir, 0.5) * uSkyP.y * 0.35;

  // light pillars from dock lamps
  vec3 pillar = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++){
    if (i >= uLightCount) break;
    vec4 L0 = lightItem(i,0); vec4 L1 = lightItem(i,1); vec4 L2 = lightItem(i,2);
    vec3 lp = L0.xyz;
    float d = distance(vWorld, lp);
    if (d > L1.w * 1.5 || lp.y < vWorld.y + 0.4) continue;
    vec3 Lv = (lp - vWorld) / d;
    float att = lightAtten(vWorld, lp, L1.w*1.5);
    att *= 0.5 + 0.5*lightCone(vWorld, lp, L1.xyz, L2.w);
    vec3 Np = normalize(N + vec3(vnoise(xz*1.7 + t*1.3)-0.5, 0.0, vnoise(xz*1.7 - t*1.1)-0.5)*0.35);
    pillar += L2.rgb * L0.w * att * (ggxSpec(Np, V, Lv, 0.085)*1.9 + ggxSpec(Np, V, Lv, 0.5)*0.25);
  }

  // foam: near the quay wall, around pilings, on crests
  float foam = smoothstep(11.0, 1.2, xz.y) * (0.45 + 0.55*vnoise(xz*0.6 - uWindDir*(t*0.55)));
  float dmin = 1e9;
  for (int i = 0; i < 6; i++) dmin = min(dmin, distance(xz, PILING[i]));
  foam += smoothstep(3.0, 0.8, dmin) * (0.35 + 0.65*vnoise(xz*2.0 - t*1.7)) * 0.9;
  foam += smoothstep(0.55, 1.0, vCrest) * smoothstep(0.45, 0.85, fbm2(xz*0.35 + t*0.13)) * 0.75;
  foam = clamp(foam, 0.0, 1.0) * uSeaP.x;

  vec3 ld = lightsDiffuse(vWorld, N) * 0.16;
  vec3 col = base * (uAmbient * (1.0 + uFlash*3.0) + ld) * (1.0 - F);
  col += sky * F;
  col += pillar;
  col += vec3(0.78, 0.84, 0.95) * ms;

  vec3 foamCol = (uAmbient*2.4 + lightsDiffuse(vWorld, normalize(N + vec3(0.0, 0.25, 0.0)))*0.8
                 + vec3(0.015, 0.02, 0.022)) * vec3(0.72, 0.78, 0.84);
  col = mix(col, foamCol, foam);

  float dist = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, heightFog(dist, vWorld.y, uFogDensity));

  fragColor = vec4(col, 1.0);
}
`;

export function createSea(gl) {
  const mesh = buildGrid(190, 160, -1500, 1500, 0, 1, (u, v) => {
    const x = -1500 + 3000 * u;
    const z = -12 + 1640 * Math.pow(v, 2.4);
    return [x, z];
  });
  const vao = makeMeshVAO(gl, mesh);
  const prog = new Program(gl, VS, FS, 'sea');
  return {
    prog, vao,
    draw(st) {
      const gl = st.gl, p = prog;
      p.use();
      gl.bindVertexArray(vao.vao);
      p.set('uViewProj', st.viewProj);
      p.set('uTime', st.time);
      p.set('uWaveAmp', st.waveAmp);
      p.set('uCamPos', st.cam.eye);
      p.set('uMoonDir', st.moonDir);
      p.set('uSkyZenith', st.skyZenith);
      p.set('uSkyHorizon', st.skyHorizon);
      p.set('uCloudOff', st.cloudOff);
      p.set('uSkyP', st.skyP);
      p.set('uAmbient', st.ambient);
      p.set('uFlash', st.flash);
      p.set('uFogDensity', st.fogDensity);
      p.set('uFogColor', st.fogColor);
      p.set('uWindDir', st.windDir);
      p.set('uSeaP', [0.35 + st.params.rain * 0.3, st.waveAmp, 0, 0]);
      p.setInt('uLightCount', st.lightCount);
      p.setFV('uLightData', st.lightsFlat);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, vao.count, vao.indexType, 0);
      gl.bindVertexArray(null);
    },
  };
}
