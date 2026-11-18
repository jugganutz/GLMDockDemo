// gl.js — WebGL2 helpers: programs, uniform setting, VAOs, render targets

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
  });
  return gl;
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const lines = src.split('\n').map((l, i) => `${String(i+1).padStart(4)}| ${l}`).join('\n');
    console.error(`[${label}] shader compile failed:\n${log}\n${lines}`);
    throw new Error(`shader compile failed: ${label}: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vsSrc, fsSrc, label = 'prog') {
    this.gl = gl;
    this.label = label;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vs');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.fs');
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link failed: ${label}: ${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
    this.loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.loc[name] = gl.getUniformLocation(p, info.name);
      this[`u_${name}`] = this.loc[name];
    }
    this._texUnit = 0;
  }
  use() { this.gl.useProgram(this.prog); return this; }
  // auto-typed setter: number -> uniform1f, boolean -> 1f,
  // Float32Array/Array: len 2/3/4 -> f[N]v, len 9 -> mat3, len 16 -> mat4, len 16*12 (lights) -> call .fv
  set(name, v) {
    const loc = this.loc[name];
    if (!loc) return this;
    const gl = this.gl;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (typeof v === 'boolean') gl.uniform1f(loc, v ? 1 : 0);
    else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
    else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else gl.uniform1fv(loc, v);
    return this;
  }
  setInt(name, v) {
    const loc = this.loc[name];
    if (loc) this.gl.uniform1i(loc, v);
    return this;
  }
  setFV(name, v) { const loc = this.loc[name]; if (loc) this.gl.uniform4fv(loc, v); return this; }
  tex(name, texture, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc[name], unit);
    return this;
  }
}

export function makeBuffer(gl, data, target = gl.ARRAY_BUFFER, dynamic = false) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  return b;
}

// VAO for interleaved-free layout: pos(0) nrm(1) uv(2) + optional index buffer
export function makeMeshVAO(gl, mesh, buffers = {}) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const pos = makeBuffer(gl, mesh.pos);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  let nrm = null, uv = null;
  if (mesh.nrm) {
    nrm = makeBuffer(gl, mesh.nrm);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  }
  if (mesh.uv) {
    uv = makeBuffer(gl, mesh.uv);
    gl.enableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  }
  let idx = null, count = 0;
  if (mesh.idx) {
    idx = makeBuffer(gl, mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
    count = mesh.idx.length;
  } else {
    count = mesh.pos.length / 3;
  }
  const out = { vao, pos, nrm, uv, idx, count, indexType: mesh.idx ? (mesh.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT) : 0 };
  gl.bindVertexArray(null);
  return out;
}

// attach an instanced attribute to an existing VAO
export function vaoAttrib(gl, vao, loc, buffer, size, divisor = 1) {
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(loc, divisor);
  gl.bindVertexArray(null);
}

export function createRT(gl, w, h, { float = true, depth = true, filter = null } = {}) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = float ? gl.RGBA16F : gl.RGBA8;
  const type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
  const lin = filter !== null ? filter : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lin);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let zb = null;
  if (depth) {
    zb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, zb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, zb);
  }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) console.warn('RT incomplete', w, h, { float, depth });
  return {
    fb, tex, depth: zb, w, h,
    resize(nw, nh) {
      this.w = nw; this.h = nh;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, nw, nh, 0, gl.RGBA, type, null);
      if (zb) {
        gl.bindRenderbuffer(gl.RENDERBUFFER, zb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, nw, nh);
      }
    },
    dispose() { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); if (zb) gl.deleteRenderbuffer(zb); },
  };
}
