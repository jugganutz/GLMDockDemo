// dock.js — wet quay apron: planar reflections, puddles, rain ripples, light pools
import { Program, makeMeshVAO } from '../engine/gl.js';
import { GLSL_COMMON, GLSL_LIGHTS } from '../engine/noise.glsl.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

function buildDockMesh() {
  const pos = [], nrm = [], uv = [], idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const pt of [a, b, c, d]) { pos.push(...pt); nrm.push(...n); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base+1, base+2, base, base+2, base+3);
  };
  const X = 100, Z0 = 0, Z1 = -80, W = -6;   // walls extend below wave troughs
  quad([ X,0,Z0], [ X,0,Z1], [-X,0,Z1], [-X,0,Z0], [0,1,0]);     // apron top
  quad([-X,0,Z0], [-X,W,Z0], [ X,W,Z0], [ X,0,Z0], [0,0,1]);     // water wall
  quad([ X,0,Z1], [ X,W,Z1], [-X,W,Z1], [-X,0,Z1], [0,0,-1]);    // back wall
  quad([ X,0,Z0], [ X,W,Z0], [ X,W,Z1], [ X,0,Z1], [1,0,0]);     // east wall
  quad([-X,0,Z1], [-X,W,Z1], [-X,W,Z0], [-X,0,Z0], [-1,0,0]);    // west wall
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

const VS = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vN;
void main(){
  vWorld = aPos;
  vN = aNrm;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

const FS = HEAD + GLSL_COMMON + GLSL_LIGHTS + `
in vec3 vWorld;
in vec3 vN;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform vec3 uMoonDir;
uniform float uTime;
uniform vec2 uRes;
uniform sampler2D uReflTex;
uniform vec4 uDockP;      // x puddleAmt, y wet, z reflBoost, w rippleAmp
uniform vec3 uAmbient;
uniform float uFlash;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform vec4 uSkyP2;      // .y = moon intensity

vec2 rainRippleNormal(vec2 p, float amt){
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++){
    float sc = (k == 0) ? 2.6 : 4.8;
    vec2 g = p*sc;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h  = hash21(id + float(k)*17.31);
    float h2 = hash21(id + float(k)*31.7);
    float period = 1.1 + h*1.3;
    float life = fract(uTime/period + h2*9.7);
    vec2 dropC = (hash22(id*1.7 + float(k)*5.1) - 0.5)*0.7;
    vec2 dv = f - dropC;
    float r = length(dv);
    float rad = life*0.42;
    float ring = exp(-pow((r - rad)*13.0, 2.0)) * (1.0 - life)*(1.0 - life);
    acc += (dv/max(r, 1e-3)) * ring;
  }
  return acc * amt;
}

void main(){
  vec3 N0 = vN;
  bool isTop = N0.y > 0.5;
  vec2 p = vWorld.xz;
  float t = uTime;
  float wet = uDockP.y;

  vec3 alb;
  if (isTop){
    float grain  = fbm2(p*0.55);
    float grain2 = fbm2(p*3.4 + 7.0);
    alb = mix(vec3(0.050, 0.055, 0.060), vec3(0.088, 0.092, 0.098), grain);
    alb *= 0.8 + 0.4*grain2;
    alb *= 0.9 + 0.25*vnoise(p*9.0);
    // expansion joints
    vec2 jp = abs(fract(p/9.0) - 0.5);
    float joint = smoothstep(0.487, 0.470, max(jp.x, jp.y));
    alb = mix(alb, vec3(0.02, 0.021, 0.023), joint*0.85);
    // worn yellow safety lanes
    float lane = smoothstep(0.17, 0.13, abs(p.y + 20.0))*0.75
               + smoothstep(0.30, 0.25, abs(p.y + 8.0))*0.9;
    float paint = smoothstep(0.30, 0.55, fbm2(p*0.33 + 3.7));
    alb = mix(alb, vec3(0.30, 0.24, 0.05), lane*paint*0.7);
    // tyre wear lanes along the container rows
    alb *= 1.0 - 0.28*smoothstep(2.2, 0.8, abs(p.y + 14.0))*smoothstep(0.35, 0.75, fbm2(p*vec2(0.09, 0.5)));
    // oil stains
    float stain = smoothstep(0.72, 0.9, fbm2(p*0.21 + 91.7));
    alb = mix(alb, vec3(0.016, 0.015, 0.014), stain*0.55);
  } else {
    alb = vec3(0.045, 0.050, 0.056) * (0.7 + 0.5*fbm2(vec2(p.x*0.5, vWorld.y*0.35)));
    alb *= mix(1.0, 0.45, smoothstep(-0.4, -1.8, vWorld.y)); // waterline algae
    float streak = fbm2(vec2(p.x*1.4, vWorld.y*0.1) + 3.3);
    alb *= mix(1.0, 0.7, smoothstep(0.55, 0.8, streak));
  }

  // ---- puddles + wetness ----
  float puddle = 0.0;
  if (isTop){
    float pn = fbm2(p*0.10 + 31.7);
    float th = 0.67 - uDockP.x*0.115;
    puddle = smoothstep(th, th - 0.13, pn);
    alb *= mix(1.0, 0.5, wet*(0.35 + 0.65*puddle));
  }

  // ---- normal detail ----
  vec3 N = N0;
  if (isTop){
    vec3 g = noiseGrad3(p*1.5, 0.35);
    vec3 base = vec3(N.x - g.x*0.09, 1.0, N.z - g.z*0.09);
    vec2 rn = rainRippleNormal(p, uDockP.w * (0.45 + puddle*1.5));
    vec2 micro = vec2(vnoise(p*6.0 + t*2.0) - 0.5, vnoise(p*6.0 - t*1.7) - 0.5) * wet*0.1;
    N = normalize(vec3(base.x + rn.x*0.4 + micro.x, 1.0, base.z + rn.y*0.4 + micro.y));
  }

  vec3 V = normalize(uCamPos - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float F = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  vec3 col;

  if (isTop){
    // ---- planar reflection (screen-space sample of mirrored pass) ----
    vec2 suv = gl_FragCoord.xy / uRes;
    float g2n = fbm2(p*3.4 + 7.0);
    float rough = mix(0.55 + 0.3*g2n, 0.06, puddle);
    vec2 distort = N.xz * (0.045 + uDockP.w*0.20);
    float rr = rough*0.05;
    vec3 refl = texture(uReflTex, suv + distort).rgb * 2.0;
    refl += texture(uReflTex, suv + distort + vec2( 0.6, 0.2)*rr).rgb;
    refl += texture(uReflTex, suv + distort + vec2(-0.4, 0.5)*rr).rgb;
    refl += texture(uReflTex, suv + distort + vec2( 0.1,-0.7)*rr).rgb;
    refl += texture(uReflTex, suv + distort + vec2(-0.6,-0.2)*rr).rgb;
    refl /= 6.0;

    float wetRefl = mix(0.14 + wet*0.30, 1.05, puddle) * uDockP.z;
    vec3 reflC = refl * F * wetRefl * 3.4;

    vec3 ld = lightsDiffuse(vWorld, N);
    vec3 ls = lightsSpecular(vWorld, N, V, mix(0.38, 0.12, puddle));
    vec3 amb = uAmbient * (1.0 + uFlash*3.0);
    col = alb * amb + alb * ld * (1.0 - F*0.7) + ls*0.4 + reflC;
    col += vec3(0.7, 0.78, 0.9) * ggxSpec(N, V, uMoonDir, 0.65) * uSkyP2.y * 0.25;

    // rain-driven glints inside light pools
    float lum = dot(ld, vec3(0.4));
    float spark = step(0.994, hash21(floor(p*21.0) - floor(t*7.0)*0.37));
    col += spark * lum * 1.4 * wet * puddle;
  } else {
    vec3 ld = lightsDiffuse(vWorld, N0);
    col = alb * (uAmbient*(1.0 + uFlash*3.0) + ld) * 1.05 + alb * ld * 0.5;
    col += vec3(0.7, 0.78, 0.9) * ggxSpec(N0, V, uMoonDir, 0.8) * uSkyP2.y * 0.1;
    col *= 1.0 + wet*0.12;
  }

  float dist = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, heightFog(dist, vWorld.y, uFogDensity));
  fragColor = vec4(col, 1.0);
}
`;

export function createDock(gl) {
  const mesh = buildDockMesh();
  const vao = makeMeshVAO(gl, mesh);
  const prog = new Program(gl, VS, FS, 'dock');
  return {
    prog, vao,
    draw(st, reflTex) {
      const gl = st.gl, p = prog;
      p.use();
      gl.bindVertexArray(vao.vao);
      p.set('uViewProj', st.viewProj);
      p.set('uTime', st.time);
      p.set('uCamPos', st.cam.eye);
      p.set('uMoonDir', st.moonDir);
      p.set('uRes', [st.W, st.H]);
      p.set('uAmbient', st.ambient);
      p.set('uFlash', st.flash);
      p.set('uFogDensity', st.fogDensity);
      p.set('uFogColor', st.fogColor);
      p.set('uSkyP2', [0, st.skyP[1], 0, 0]);
      const dp = st.dockP;
      p.set('uDockP', dp);
      if (reflTex) p.tex('uReflTex', reflTex, 4);
      p.setInt('uLightCount', st.lightCount);
      p.setFV('uLightData', st.lightsFlat);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, vao.count, vao.indexType, 0);
      gl.bindVertexArray(null);
    },
  };
}
