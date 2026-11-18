// geometry.js — procedural mesh builders (unit primitives + instancing-friendly layouts)
// Attribute convention: loc0=aPos(vec3), loc1=aNrm(vec3), loc2=aUV(vec2)

export function buildBox() {
  const faces = [
    // normal, tangent (u dir), bitangent (v dir)
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const pos = [], nrm = [], uv = [], idx = [];
  faces.forEach((f, fi) => {
    const base = fi * 4;
    for (const [su, sv] of [[0,0],[1,0],[1,1],[0,1]]) {
      // corner position = n*0.5 + u*(su-0.5) + v*(sv-0.5)
      for (let k = 0; k < 3; k++) {
        pos.push(
          f.n[k]*0.5 + f.u[k]*(su-0.5) + f.v[k]*(sv-0.5)
        );
      }
      nrm.push(...f.n);
      uv.push(su, sv);
    }
    idx.push(base, base+1, base+2, base, base+2, base+3);
  });
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

export function buildCylinder(radialSeg = 14, capped = true) {
  // unit: radius .5, height 1, centered at origin (y in -0.5..0.5)
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= radialSeg; i++) {
    const a = (i / radialSeg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (const [y, ny] of [[-0.5, -1], [0.5, 1]]) {
      // side normal: slope for unit cylinder side is horizontal
      pos.push(c * 0.5, y, s * 0.5);
      nrm.push(c, ny * 0, s);
      uv.push(i / radialSeg, y + 0.5);
    }
  }
  for (let i = 0; i < radialSeg; i++) {
    const a = i * 2, b = a + 1;
    idx.push(a, b, a + 2, b, b + 2, a + 2);
  }
  if (capped) {
    for (const [y, ny] of [[0.5, 1], [-0.5, -1]]) {
      const center = pos.length / 3;
      pos.push(0, y, 0); nrm.push(0, ny, 0); uv.push(0.5, 0.5);
      const first = center + 1;
      for (let i = 0; i <= radialSeg; i++) {
        const a = (i / radialSeg) * Math.PI * 2;
        pos.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5);
        nrm.push(0, ny, 0);
        uv.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5);
      }
      const n = radialSeg + 1;
      for (let i = 0; i < radialSeg; i++) {
        if (ny > 0) idx.push(center, first + i, first + i + 1);
        else idx.push(center, first + i + 1, first + i);
      }
    }
  }
  // fix side normals (slope=0 for cylinder)
  for (let i = 0; i < pos.length / 3; i++) {
    if (Math.abs(pos[i*3+1] - 0) < 0.26 && Math.abs(Math.abs(pos[i*3]) + Math.abs(pos[i*3+2])) > 0.01) {
      // leave as-is
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

export function buildCone(radialSeg = 20) {
  // volumetric cone: apex at (0,1,0), base ring y=0 radius .5, uv: x=angle, y=0(apex)..1(base)
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= radialSeg; i++) {
    const a = (i / radialSeg) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    nrm.push(0, 1, 0);
    uv.push(i / radialSeg, 1);
  }
  const apex = pos.length / 3;
  pos.push(0, 1, 0); nrm.push(0, 1, 0); uv.push(0.5, 0);
  for (let i = 0; i < radialSeg; i++) idx.push(i, i + 1, apex);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

// Ground grid with custom xz range. warp(u,v) optional remap of unit coords.
export function buildGrid(nx, nz, x0, x1, z0, z1, warp) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / nz;
      let x = x0 + (x1 - x0) * u;
      let z = z0 + (z1 - z0) * v;
      if (warp) { const w = warp(u, v); x = w[0]; z = w[1]; }
      pos.push(x, 0, z);
      nrm.push(0, 1, 0);
      uv.push(u, v);
    }
  }
  const stride = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

export function buildQuad() {
  // unit quad in xy: corners (±0.5), with uv — billboard / decal base
  return {
    pos: new Float32Array([-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0]),
    nrm: new Float32Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
    uv: new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]),
    idx: null,
  };
}
