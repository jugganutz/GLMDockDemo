// sky.js — procedural stormy night sky (fullscreen pass, ray-reconstructed)
import { Program } from '../engine/gl.js';
import { GLSL_COMMON, GLSL_SKY } from '../engine/noise.glsl.js';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const VS = HEAD + `
layout(location=0) in float dummy;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
out vec3 vDir;
void main(){
  vec2 xy = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 ndc = xy * 2.0 - 1.0;
  vec4 farP = uInvVP * vec4(ndc, 1.0, 1.0);
  vDir = farP.xyz / max(farP.w, 1e-4) - uCamPos;
  gl_Position = vec4(ndc, 0.99999, 1.0);
}
`;

const FS = HEAD + GLSL_COMMON + GLSL_SKY + `
in vec3 vDir;
out vec4 fragColor;
uniform vec3 uMoonDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec2 uCloudOff;
uniform vec4 uSkyP;
void main(){
  vec3 rd = normalize(vDir);
  vec3 col = skyColor(rd, uMoonDir, uSkyZenith, uSkyHorizon, uCloudOff, uSkyP);
  fragColor = vec4(col, 1.0);
}
`;

export function createSky(gl) {
  const prog = new Program(gl, VS, FS, 'sky');
  const vao = gl.createVertexArray(); // empty — geometry from gl_VertexID
  return {
    prog, vao,
    draw(st) {
      const gl = st.gl, p = prog;
      p.use();
      gl.bindVertexArray(this.vao);
      p.set('uInvVP', st.invVP);
      p.set('uCamPos', st.cam.eye);
      p.set('uMoonDir', st.moonDir);
      p.set('uSkyZenith', st.skyZenith);
      p.set('uSkyHorizon', st.skyHorizon);
      p.set('uCloudOff', st.cloudOff);
      p.set('uSkyP', st.skyP);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(null);
    },
  };
}
