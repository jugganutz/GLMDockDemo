// lights.js — swaying sodium lamps, flicker, glow billboards, volumetric light cones
import { Program, makeBuffer, vaoAttrib, makeMeshVAO } from '../engine/gl.js';
import { buildCone } from '../engine/geometry.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

// ---- glow billboards
const VS_G = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=3) in vec4 aP;    // pos.xyz, intensity
layout(location=4) in vec4 aC;    // color.rgb, size
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
out vec2 vCor;
out vec4 vColor;
out float vI;
void main(){
  vec3 p = aP.xyz + (uCamRight*aCorner.x + uCamUp*aCorner.y)*aC.w;
  vCor = aCorner;
  vColor = vec4(aC.rgb, 1.0);
  vI = aP.w;
  gl_Position = uViewProj*vec4(p, 1.0);
}
`;

const FS_G = HEAD + `
in vec2 vCor;
in vec4 vColor;
in float vI;
out vec4 fragColor;
void main(){
  float d2 = dot(vCor, vCor);
  float halo = exp(-d2*4.2)*vI*0.5;
  float core = exp(-d2*20.0)*vI*0.55;
  float smear = exp(-abs(vCor.y)*26.0)*exp(-abs(vCor.x)*4.0)*vI*0.10;
  float a = halo + core + smear;
  fragColor = vec4(vColor.rgb, clamp(a, 0.0, 0.8));
}
`;

// ---- volumetric cones
const VS_C = HEAD + `
layout(location=0) in vec3 aPos;   // unit cone: ring y=0, apex (0,1,0)
layout(location=3) in vec4 aP;     // apex.xyz, intensity
layout(location=4) in vec4 aB;     // base.xyz, radiusScale
layout(location=5) in vec4 aC;     // color.rgb, -
uniform mat4 uViewProj;
out float vY;
out float vU;
out vec4 vColor;
out float vI;
out vec3 vWorld;
out vec3 vNrmS;
void main(){
  vec3 axis = aP.xyz - aB.xyz;
  float alen = max(length(axis), 0.01);
  axis /= alen;
  float rad = aB.w;
  vec2 rd2 = normalize(aPos.xz + vec2(1e-4));
  float cy = aPos.y;
  vec3 p = mix(aB.xyz, aP.xyz, cy) + vec3(rd2.x, 0.0, rd2.y)*rad*(1.0 - cy);
  float st = rad/sqrt(alen*alen + rad*rad);
  float ct = alen/sqrt(alen*alen + rad*rad);
  vec3 radial = vec3(rd2.x, 0.0, rd2.y);
  vNrmS = normalize(radial*ct - axis*st);
  vY = cy;
  vU = atan(aPos.z, aPos.x);
  vColor = vec4(aC.rgb, 1.0);
  vI = aP.w;
  vWorld = p;
  gl_Position = uViewProj*vec4(p, 1.0);
}
`;

const FS_C = HEAD + `
in float vY;
in float vU;
in vec4 vColor;
in float vI;
in vec3 vWorld;
in vec3 vNrmS;
out vec4 fragColor;
uniform float uTime;
uniform float uVolI;
uniform vec3 uCamPos;
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
void main(){
  float n = vnoise(vec2(vU*7.0, vY*16.0 - uTime*0.55));
  vec3 V = normalize(uCamPos - vWorld);
  float facing = abs(dot(normalize(vNrmS), V));
  float w = pow(facing, 1.6);
  float a = (0.02 + 0.11*vY)*(0.45 + 0.55*n)*w*vI*uVolI;
  fragColor = vec4(vColor.rgb, clamp(a, 0.0, 0.45));
}
`;

// ---- lamp definitions (match mast positions in props.js) ----
const LAMPS = [
  { x: -70, type: 'cool',    col: [0.95, 0.99, 1.05], I: 20, range: 30, cos: 0.80 },
  { x: -35, type: 'sodium',  col: [1.00, 0.58, 0.24], I: 26, range: 32, cos: 0.78 },
  { x:   0, type: 'sodium',  col: [1.00, 0.58, 0.24], I: 26, range: 32, cos: 0.78 },
  { x:  35, type: 'cool',    col: [0.95, 0.99, 1.05], I: 20, range: 30, cos: 0.80 },
  { x:  70, type: 'faulty',  col: [1.00, 0.58, 0.24], I: 26, range: 32, cos: 0.78 },
];
const AIM = [0.10, -1.0, 0.62];
const HANG = 0.55, PIVOT_Y = 9.1;

const CRANE_FLOOD = { pos: [0, 37.2, 14], dir: [0.14, -1, 0.5], col: [0.9, 0.95, 1.05], I: 38, range: 46, cos: 0.62 };
{ // normalize flood dir for shader cone math
  const l = Math.hypot(CRANE_FLOOD.dir[0], CRANE_FLOOD.dir[1], CRANE_FLOOD.dir[2]);
  CRANE_FLOOD.dir[0] /= l; CRANE_FLOOD.dir[1] /= l; CRANE_FLOOD.dir[2] /= l;
}

const MAX_ITEMS = 24;
const MAX_CONES = 8;

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

export function createLights(gl) {
  const glowProg = new Program(gl, VS_G, FS_G, 'glow');
  const coneProg = new Program(gl, VS_C, FS_C, 'cone');

  const coneMesh = makeMeshVAO(gl, buildCone(22));

  const rnd = mulberry(55511);
  const state = LAMPS.map((L, i) => ({
    ...L, i,
    phase: rnd()*100,
    ax: 0, az: 0, vax: 0.15*rnd(), vaz: -0.15*rnd(),
    k: 6.5 + rnd()*1.5, c: 1.5 + rnd()*0.4,
  }));

  // corner quad buffer
  const cornerBuf = makeBuffer(gl, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]));
  const glowVAO = gl.createVertexArray();
  gl.bindVertexArray(glowVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const glowPBuf = makeBuffer(gl, new Float32Array(MAX_ITEMS*4), gl.ARRAY_BUFFER, true);
  const glowCBuf = makeBuffer(gl, new Float32Array(MAX_ITEMS*4), gl.ARRAY_BUFFER, true);
  vaoAttrib(gl, glowVAO, 3, glowPBuf, 4, 1);
  vaoAttrib(gl, glowVAO, 4, glowCBuf, 4, 1);
  gl.bindVertexArray(null);

  const coneVAO = coneMesh.vao;
  const conePBuf = makeBuffer(gl, new Float32Array(MAX_CONES*4), gl.ARRAY_BUFFER, true);
  const coneBBuf = makeBuffer(gl, new Float32Array(MAX_CONES*4), gl.ARRAY_BUFFER, true);
  const coneCBuf = makeBuffer(gl, new Float32Array(MAX_CONES*4), gl.ARRAY_BUFFER, true);
  vaoAttrib(gl, coneVAO, 3, conePBuf, 4, 1);
  vaoAttrib(gl, coneVAO, 4, coneBBuf, 4, 1);
  vaoAttrib(gl, coneVAO, 5, coneCBuf, 4, 1);

  const lightsFlat = new Float32Array(12*16);
  const glowP = new Float32Array(MAX_ITEMS*4);
  const glowC = new Float32Array(MAX_ITEMS*4);
  const coneP = new Float32Array(MAX_CONES*4);
  const coneB = new Float32Array(MAX_CONES*4);
  const coneC = new Float32Array(MAX_CONES*4);
  let glowCount = 0, coneCount = 0, lightCountVal = 0;

  function flicker(type, t, phase) {
    if (type === 'faulty') {
      const fn = Math.sin(t*23 + phase*17.3)*Math.sin(t*3.1 + phase*1.7) + 0.3*Math.sin(t*61 + phase*3.3);
      const on = fn > 0.0 ? 1 : 0.06;
      return on*(0.86 + 0.14*Math.sin(t*47 + phase));
    }
    if (type === 'sodium') return 0.93 + 0.06*Math.sin(t*37 + phase*9.1) + 0.03*Math.sin(t*111 + phase*3.7);
    return 1;
  }

  function update(dt, t, params) {
    const windAmp = 0.06 + 0.20*params.wind;
    glowCount = 0; coneCount = 0;
    let li = 0;

    state.forEach((L) => {
      const g1 = Math.sin(t*1.9 + L.phase)*0.5 + Math.sin(t*0.53 + L.phase*2.7)*0.35 + Math.sin(t*0.17 + L.phase*5.1)*0.2;
      const g2 = Math.sin(t*1.4 + L.phase*1.3)*0.5 + Math.sin(t*0.41 + L.phase*3.1)*0.35;
      L.vax += (-L.k*L.ax - L.c*L.vax + g1*windAmp)*dt;  L.ax += L.vax*dt;
      L.vaz += (-L.k*L.az - L.c*L.vaz + g2*windAmp)*dt;  L.az += L.vaz*dt;
      const px = L.x;
      const lx = HANG*Math.sin(L.az)*Math.cos(L.ax);
      const ly = PIVOT_Y - HANG*Math.cos(L.ax)*Math.cos(L.az);
      const lz = -1.55 - HANG*Math.sin(L.ax);
      const fl = flicker(L.type, t, L.phase);
      const pos = [px + lx, ly, lz];
      const dir = [AIM[0] + Math.sin(L.az)*0.7, AIM[1], AIM[2] + Math.sin(L.ax)*0.7];
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
      const integ = L.I*fl*params.lightScale;

      const b = li*12;
      lightsFlat[b+0]=pos[0]; lightsFlat[b+1]=pos[1]; lightsFlat[b+2]=pos[2]; lightsFlat[b+3]=integ;
      lightsFlat[b+4]=dir[0]; lightsFlat[b+5]=dir[1]; lightsFlat[b+6]=dir[2]; lightsFlat[b+7]=L.range;
      lightsFlat[b+8]=L.col[0]; lightsFlat[b+9]=L.col[1]; lightsFlat[b+10]=L.col[2]; lightsFlat[b+11]=L.cos;
      lightsFlat[b+12]=1; lightsFlat[b+13]=0; lightsFlat[b+14]=0; lightsFlat[b+15]=0;
      li++;

      // glow billboard
      const gi = glowCount*4;
      glowP[gi]=pos[0]; glowP[gi+1]=pos[1]; glowP[gi+2]=pos[2]; glowP[gi+3]=1.5*fl*params.lightScale;
      glowC[gi]=L.col[0]; glowC[gi+1]=L.col[1]; glowC[gi+2]=L.col[2]; glowC[gi+3]=1.35;
      glowCount++;

      // volumetric cone for the four berth lamps
      if (L.x !== 70 && params.cones && fl > 0.1) {
        const dirFlat = -pos[1]/dir[1];
        const bx = pos[0] + dir[0]*dirFlat, bz = pos[2] + dir[2]*dirFlat;
        const ci = coneCount*4;
        coneP[ci]=pos[0]; coneP[ci+1]=pos[1]; coneP[ci+2]=pos[2]; coneP[ci+3]=fl*params.lightScale;
        coneB[ci]=bx; coneB[ci+1]=0.05; coneB[ci+2]=bz; coneB[ci+3]=2.0 + dirFlat*0.13;
        coneC[ci]=L.col[0]; coneC[ci+1]=L.col[1]; coneC[ci+2]=L.col[2]; coneC[ci+3]=0;
        coneCount++;
      }
    });

    // crane floodlight: steady, aimed at the berth
    {
      const b = li*12;
      const fl = 1;
      lightsFlat[b+0]=CRANE_FLOOD.pos[0]; lightsFlat[b+1]=CRANE_FLOOD.pos[1]; lightsFlat[b+2]=CRANE_FLOOD.pos[2]; lightsFlat[b+3]=CRANE_FLOOD.I*fl;
      lightsFlat[b+4]=CRANE_FLOOD.dir[0]; lightsFlat[b+5]=CRANE_FLOOD.dir[1]; lightsFlat[b+6]=CRANE_FLOOD.dir[2]; lightsFlat[b+7]=CRANE_FLOOD.range;
      lightsFlat[b+8]=CRANE_FLOOD.col[0]; lightsFlat[b+9]=CRANE_FLOOD.col[1]; lightsFlat[b+10]=CRANE_FLOOD.col[2]; lightsFlat[b+11]=CRANE_FLOOD.cos;
      lightsFlat[b+12]=1; lightsFlat[b+13]=0; lightsFlat[b+14]=0; lightsFlat[b+15]=0;
      li++;
      // glow + cone for the flood
      const gi = glowCount*4;
      glowP[gi]=CRANE_FLOOD.pos[0]; glowP[gi+1]=CRANE_FLOOD.pos[1]; glowP[gi+2]=CRANE_FLOOD.pos[2]; glowP[gi+3]=2.0;
      glowC[gi]=0.85; glowC[gi+1]=0.9; glowC[gi+2]=1.0; glowC[gi+3]=2.0;
      glowCount++;
      if (params.cones) {
        const dl = -CRANE_FLOOD.pos[1]/CRANE_FLOOD.dir[1];
        const bx = CRANE_FLOOD.pos[0] + CRANE_FLOOD.dir[0]*dl, bz = CRANE_FLOOD.pos[2] + CRANE_FLOOD.dir[2]*dl;
        const ci = coneCount*4;
        coneP[ci]=CRANE_FLOOD.pos[0]; coneP[ci+1]=CRANE_FLOOD.pos[1]; coneP[ci+2]=CRANE_FLOOD.pos[2]; coneP[ci+3]=1.0;
        coneB[ci]=bx; coneB[ci+1]=0.05; coneB[ci+2]=bz; coneB[ci+3]=2.4 + dl*0.12;
        coneC[ci]=0.8; coneC[ci+1]=0.86; coneC[ci+2]=0.98; coneC[ci+3]=0;
        coneCount++;
      }
    }

    // dim fill lights over the container rows
    {
      const b = li*12;
      lightsFlat[b+0]=-30; lightsFlat[b+1]=6.5; lightsFlat[b+2]=-20; lightsFlat[b+3]=9;
      lightsFlat[b+4]=0; lightsFlat[b+5]=-1; lightsFlat[b+6]=0; lightsFlat[b+7]=40;
      lightsFlat[b+8]=0.8; lightsFlat[b+9]=0.55; lightsFlat[b+10]=0.32; lightsFlat[b+11]=-1;
      lightsFlat[b+12]=0; lightsFlat[b+13]=0; lightsFlat[b+14]=0; lightsFlat[b+15]=0;
      li++;
    }
    {
      const b = li*12;
      lightsFlat[b+0]=34; lightsFlat[b+1]=7.0; lightsFlat[b+2]=-26; lightsFlat[b+3]=8;
      lightsFlat[b+4]=0; lightsFlat[b+5]=-1; lightsFlat[b+6]=0; lightsFlat[b+7]=36;
      lightsFlat[b+8]=0.8; lightsFlat[b+9]=0.55; lightsFlat[b+10]=0.32; lightsFlat[b+11]=-1;
      lightsFlat[b+12]=0; lightsFlat[b+13]=0; lightsFlat[b+14]=0; lightsFlat[b+15]=0;
      li++;
    }

    // aviation beacons on the crane + barge lights
    const blink = (Math.sin(t*2.6) > 0.975) ? 1 : 0.06;
    const addGlow = (x, y, z, integ, r, g, b2, size) => {
      if (glowCount >= MAX_ITEMS) return;
      const gi = glowCount*4;
      glowP[gi]=x; glowP[gi+1]=y; glowP[gi+2]=z; glowP[gi+3]=integ;
      glowC[gi]=r; glowC[gi+1]=g; glowC[gi+2]=b2; glowC[gi+3]=size;
      glowCount++;
    };
    addGlow(-13, 35.2, 18, 1.7*blink, 1.0, 0.16, 0.10, 0.5);
    addGlow(13, 35.2, 18, 1.7*blink, 1.0, 0.16, 0.10, 0.5);
    addGlow(0, 41.3, 31, 1.6*blink, 1.0, 0.16, 0.10, 0.45);
    addGlow(0, 41.3, -27, 1.6*blink, 1.0, 0.16, 0.10, 0.45);
    addGlow(22.8, 5.75, 18.55, 1.8, 0.95, 0.95, 0.9, 0.4);        // barge mast
    addGlow(24.5, 2.8, 17.15, 1.1, 0.95, 0.66, 0.3, 0.42);        // barge wheelhouse

    // upload dynamics
    gl.bindBuffer(gl.ARRAY_BUFFER, glowPBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowP);
    gl.bindBuffer(gl.ARRAY_BUFFER, glowCBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowC);
    gl.bindBuffer(gl.ARRAY_BUFFER, conePBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, coneP);
    gl.bindBuffer(gl.ARRAY_BUFFER, coneBBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, coneB);
    gl.bindBuffer(gl.ARRAY_BUFFER, coneCBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, coneC);

    lightCountVal = li;
    return li;
  }

  function setCommon(p, st) {
    p.set('uViewProj', st.viewProj);
    p.set('uCamRight', st.camRight);
    p.set('uCamUp', st.camUp);
    p.set('uTime', st.time);
    p.set('uVolI', st.params.cones ? 1 : 0);
  }

  return {
    lightsFlat, glowProg, coneProg,
    get lightCount() { return lightCountVal; },
    counts: { get glow() { return glowCount; }, get cone() { return coneCount; } },
    update,
    drawGlows(st) {
      const g = st.gl;
      glowProg.use();
      setCommon(glowProg, st);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE);
      g.depthMask(false);
      g.disable(g.DEPTH_TEST);
      g.disable(g.CULL_FACE);
      g.bindVertexArray(glowVAO);
      g.drawArraysInstanced(g.TRIANGLES, 0, 6, Math.max(glowCount, 0));
      g.enable(g.DEPTH_TEST);
      g.depthMask(true);
      g.enable(g.CULL_FACE);
      g.disable(g.BLEND);
      g.bindVertexArray(null);
    },
    drawCones(st) {
      if (!st.params.cones) return;
      const g = st.gl;
      coneProg.use();
      setCommon(coneProg, st);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE);
      g.depthMask(false);
      g.disable(g.CULL_FACE);
      g.bindVertexArray(coneVAO);
      g.drawElementsInstanced(g.TRIANGLES, coneMesh.count, coneMesh.indexType, 0, Math.max(coneCount, 0));
      g.enable(g.CULL_FACE);
      g.depthMask(true);
      g.disable(g.BLEND);
      g.bindVertexArray(null);
    },
  };
}

