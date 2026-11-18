// noise.glsl.js — shared GLSL chunks: hashing, noise, fbm, ACES, fog, dynamic lights, sky

export const GLSL_COMMON = /* glsl */`
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float hash31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1,0,0)), n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1)), n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y), mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}
float fbm2(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + vec2(11.7,5.3); a *= 0.5; }
  return s;
}
float fbm2x(vec2 p, int oct){
  float a = 0.5, s = 0.0;
  for(int i=0;i<6;i++){ if(i>=oct) break; s += a*vnoise(p); p = p*2.03 + vec2(11.7,5.3); a *= 0.5; }
  return s;
}
// gradient (finite difference) of 2d value noise — for procedural bump mapping
vec3 noiseGrad3(vec2 p, float eps){
  float h = vnoise(p);
  float hx = vnoise(p+vec2(eps,0.0));
  float hy = vnoise(p+vec2(0.0,eps));
  return vec3((hx-h)/eps, 1.0, (hy-h)/eps);
}
vec3 acesFilm(vec3 x){
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
float ggxSpec(vec3 N, vec3 V, vec3 L, float rough){
  vec3 H = normalize(V+L);
  float ndh = max(dot(N,H), 0.0);
  float ndv = max(dot(N,V), 1e-3);
  float a = rough*rough; float a2 = a*a;
  float d = ndh*ndh*(a2-1.0)+1.0;
  float D = a2/(3.14159265*d*d + 1e-6);
  float k = a*0.5;
  float G = (max(dot(N,L),0.0)/(max(dot(N,L),0.0)+k)) * (ndv/(ndv+k));
  float F = 0.05 + 0.95*pow(1.0-max(dot(H,V),0.0), 5.0);
  return D*G*F;
}
float heightFog(float dist, float y, float density){
  // exponential-ish height fog, denser near sea level
  float h = max(y-(-3.0), 0.0);
  float hf = exp(-h*0.055);
  return 1.0 - exp(-dist*density*hf);
}
`;

// --------------------------------------------------------------- dynamic lights
export const GLSL_LIGHTS = /* glsl */`
#define MAX_LIGHTS 12
uniform vec4 uLightData[MAX_LIGHTS*4];   // [pos, intensity][dir, range][color, cosOuter][type, _]
uniform int uLightCount;

vec4 lightItem(int i, int k){ return uLightData[i*4+k]; }

float lightAtten(vec3 P, vec3 lp, float range){
  float d = distance(P, lp);
  float a = clamp(1.0 - d/range, 0.0, 1.0);
  return a*a / (0.3 + 0.7*a);
}
float lightCone(vec3 P, vec3 lp, vec3 dir, float cosOuter){
  if (cosOuter <= -0.5) return 1.0; // omni
  vec3 toF = normalize(P - lp);
  float c = dot(toF, dir);
  float inner = mix(cosOuter, 1.0, 0.45);
  return smoothstep(cosOuter - 0.08, inner, c);
}
vec3 lightsDiffuse(vec3 P, vec3 N){
  vec3 s = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++){
    if (i >= uLightCount) break;
    vec4 L0 = lightItem(i,0); vec4 L1 = lightItem(i,1); vec4 L2 = lightItem(i,2);
    vec3 lp = L0.xyz; float integ = L0.w;
    vec3 Ld = lp - P;
    float d = length(Ld);
    if (d > L1.w || d < 0.01) continue;
    Ld /= d;
    float nl = max(dot(N, Ld), 0.0);
    if (nl < 0.003) continue;
    float att = lightAtten(P, lp, L1.w) * lightCone(P, lp, L1.xyz, L2.w);
    s += L2.rgb * (integ * nl * att);
  }
  return s;
}
vec3 lightsSpecular(vec3 P, vec3 N, vec3 V, float rough){
  vec3 s = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++){
    if (i >= uLightCount) break;
    vec4 L0 = lightItem(i,0); vec4 L1 = lightItem(i,1); vec4 L2 = lightItem(i,2);
    vec3 lp = L0.xyz; float integ = L0.w;
    vec3 Ld = lp - P;
    float d = length(Ld);
    if (d > L1.w || d < 0.01) continue;
    Ld /= d;
    float att = lightAtten(P, lp, L1.w) * lightCone(P, lp, L1.xyz, L2.w);
    s += L2.rgb * (integ * att * ggxSpec(N, V, Ld, rough));
  }
  return s;
}
// per-vertex approximate brightness (rain streaks catching light)
float lightsGlow(vec3 P){
  float s = 0.0;
  for (int i = 0; i < MAX_LIGHTS; i++){
    if (i >= uLightCount) break;
    vec4 L0 = lightItem(i,0); vec4 L1 = lightItem(i,1);
    s += lightAtten(P, L0.xyz, L1.w*1.4);
  }
  return s;
}
`;

// --------------------------------------------------------------- sky (shared with water reflections)
export const GLSL_SKY = /* glsl */`
// rd: unit ray dir. moonDir unit. skyP: x cloudCover, y moonGlowI, z starI, w flash
vec3 skyColor(vec3 rd, vec3 moonDir, vec3 zenith, vec3 horizon, vec2 cloudOff, vec4 skyP){
  float up = clamp(rd.y, -1.0, 1.0);
  float horiz = pow(1.0 - clamp(up, 0.0, 1.0), 3.2);
  vec3 col = mix(zenith, horizon, horiz);
  // below horizon: fade to dark sea haze so mirrored sampling stays plausible
  col = mix(col, horizon*0.35, smoothstep(0.0, -0.25, up));

  // moon glow + disc
  float md = max(dot(rd, moonDir), 0.0);
  float moonI = skyP.y;
  col += vec3(0.62, 0.68, 0.78) * (pow(md, 42.0)*0.16 + pow(md, 350.0)*0.5) * moonI;
  float disc = smoothstep(0.99982, 0.99993, md);
  vec3 mcol = vec3(0.92, 0.95, 1.0) * 2.1 * moonI;

  // storm clouds: fbm on a virtual dome projection
  float dens = 0.0;
  if (up > -0.05){
    vec2 cp = rd.xz/(up + 0.09)*0.55 + cloudOff;
    float f = fbm2x(cp, 5);
    float cover = skyP.x;
    dens = smoothstep(1.0 - cover - 0.18, 1.0 - cover + 0.25, f*1.15);
    dens *= smoothstep(-0.05, 0.16, up);           // fade at horizon
    // moonlit edge: sample shifted toward moon azimuth for a lit gradient
    vec2 mo = normalize(moonDir.xz + vec2(1e-4));
    float f2 = fbm2x(cp - mo*0.22, 4);
    float lit = clamp((f - f2)*2.4, 0.0, 1.0);
    vec3 dark = zenith*0.55 + vec3(0.02, 0.024, 0.03);
    vec3 edge = vec3(0.16, 0.185, 0.22) * (0.35 + moonI*1.15);
    vec3 cloud = mix(dark, edge, lit) * (0.55 + 0.45*moonI);
    col = mix(col, cloud, dens*0.92);
    // lightning flash behind clouds
    col += vec3(0.62, 0.66, 0.8) * (skyP.w * (0.28 + dens*0.95));
  }
  // sparse stars in gaps (dampened by clouds & flash)
  if (skyP.z > 0.001){
    vec2 sv = rd.xz/(abs(up) + 0.35)*3.0;
    float st = hash21(floor(sv*36.0) + 3.1);
    float star = smoothstep(0.995, 1.0, st) * vnoise(sv*220.0);
    col += vec3(0.7, 0.78, 0.95) * star * skyP.z * (1.0 - dens) * smoothstep(0.02, 0.3, up) * 1.4;
  }
  col += mcol * disc;   // moon punches through in gaps
  return col;
}
`;
