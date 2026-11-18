// post.js — bloom (bright + separable blur), lens droplets, ACES, FXAA, vignette, grain
import { Program } from './gl.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const VS = HEAD + `
out vec2 vUV;
void main(){
  vec2 xy = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = xy;
  gl_Position = vec4(xy*2.0 - 1.0, 0.0, 1.0);
}
`;

const BRIGHT_FS = HEAD + `
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThresh;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = max(max(c.r, c.g), c.b);
  float t = max(l - uThresh, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * t, 1.0);
}
`;

const BLUR_FS = HEAD + `
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDirTexel;
void main(){
  vec3 c = texture(uTex, vUV).rgb*0.227027;
  c += (texture(uTex, vUV + uDirTexel*1.3846).rgb + texture(uTex, vUV - uDirTexel*1.3846).rgb)*0.316216;
  c += (texture(uTex, vUV + uDirTexel*3.2308).rgb + texture(uTex, vUV - uDirTexel*3.2308).rgb)*0.070270;
  fragColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FS = HEAD + `
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform sampler2D uBloomTex;
uniform float uBloomStr;
uniform float uExposure;
uniform float uTime;
uniform float uDroplet;

float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }

vec2 droplet(vec2 uv, float t){
  vec2 g = uv*vec2(30.0, 20.0);
  g.y += t*0.42;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id);
  if (h < 0.78) return vec2(0.0);
  vec2 c = (hash22(id + 7.7) - 0.5)*0.55;
  float d = length(f - c);
  float r = 0.15 + h*0.13;
  float m = smoothstep(r, r*0.62, d);
  return (f - c)*m;
}

void main(){
  vec2 uv = vUV;
  vec2 dp = droplet(uv, uTime)*0.06*uDroplet;
  vec3 c = texture(uTex, uv + dp).rgb;
  c *= 1.0 + length(dp)*2.2;
  vec3 bloom = texture(uBloomTex, uv).rgb;
  c += bloom*uBloomStr;
  c *= uExposure;
  c = (c*(2.51*c + 0.03))/(c*(2.43*c + 0.59) + 0.14);
  c = pow(clamp(c, 0.0, 1.0), vec3(0.4545));
  c = c*vec3(0.998, 1.0, 1.012) + vec3(0.0012, 0.0018, 0.0036);
  fragColor = vec4(c, 1.0);
}
`;

const FINAL_FS = HEAD + `
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrainI;

float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 fxaa(vec2 uv, vec2 rcp){
  float lM = luma(texture(uTex, uv).rgb);
  float lN = luma(texture(uTex, uv + vec2(0.0, rcp.y)).rgb);
  float lS = luma(texture(uTex, uv - vec2(0.0, rcp.y)).rgb);
  float lE = luma(texture(uTex, uv + vec2(rcp.x, 0.0)).rgb);
  float lW = luma(texture(uTex, uv - vec2(rcp.x, 0.0)).rgb);
  float lNW = luma(texture(uTex, uv + rcp).rgb);
  float lNE = luma(texture(uTex, uv + vec2(rcp.x, -rcp.y)).rgb);
  float lSW = luma(texture(uTex, uv + vec2(-rcp.x, rcp.y)).rgb);
  float lSE = luma(texture(uTex, uv - rcp).rgb);
  float rmin = min(min(lN, lS), min(lE, lW));
  float rmax = max(max(lN, lS), max(lE, lW));
  if (rmax - rmin < 0.07 || rmax < 0.02) return texture(uTex, uv).rgb;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lN + lS + lE + lW)*0.0625, 0.004);
  float rcpMin = 1.0/(min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir*rcpMin, vec2(-8.0), vec2(8.0))*rcp;
  vec3 a = 0.5*(texture(uTex, uv + dir*(1.0/3.0 - 0.5)).rgb + texture(uTex, uv + dir*(2.0/3.0 - 0.5)).rgb);
  vec3 b = a*0.5 + 0.25*(texture(uTex, uv - dir*0.5).rgb + texture(uTex, uv + dir*0.5).rgb);
  float lB = luma(b);
  return (lB < rmin || lB > rmax) ? a : b;
}

void main(){
  vec2 rcp = 1.0/uRes;
  vec3 c = fxaa(vUV, rcp);
  float d = length((vUV - 0.5)*vec2(1.25, 1.0));
  c *= 1.0 - 0.44*smoothstep(0.42, 0.86, d);
  float g = hash21(vUV*uRes*0.7 + vec2(fract(uTime*61.7)*331.3));
  float l = luma(c);
  c += (g - 0.5)*uGrainI*(1.15 - l*0.7);
  fragColor = vec4(c, 1.0);
}
`;

export function createPost(gl) {
  const bright = new Program(gl, VS, BRIGHT_FS, 'bright');
  const blur = new Program(gl, VS, BLUR_FS, 'blur');
  const composite = new Program(gl, VS, COMPOSITE_FS, 'composite');
  const final = new Program(gl, VS, FINAL_FS, 'final');
  const vao = gl.createVertexArray();
  return {
    bright, blur, composite, final, vao,
    fsBegin() { gl.bindVertexArray(vao); },
    fsEnd() { gl.bindVertexArray(null); },
  };
}
