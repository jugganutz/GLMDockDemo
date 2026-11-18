// math.js — minimal vector / matrix math (column-major, GL convention)

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];

export function v3add(a, b, o = []) { o[0]=a[0]+b[0]; o[1]=a[1]+b[1]; o[2]=a[2]+b[2]; return o; }
export function v3sub(a, b, o = []) { o[0]=a[0]-b[0]; o[1]=a[1]-b[1]; o[2]=a[2]-b[2]; return o; }
export function v3scale(a, s, o = []) { o[0]=a[0]*s; o[1]=a[1]*s; o[2]=a[2]*s; return o; }
export function v3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
export function v3cross(a, b, o = []) {
  const x = a[1]*b[2] - a[2]*b[1], y = a[2]*b[0] - a[0]*b[2], z = a[0]*b[1] - a[1]*b[0];
  o[0]=x; o[1]=y; o[2]=z; return o;
}
export function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a, o = []) {
  const l = v3len(a) || 1;
  o[0]=a[0]/l; o[1]=a[1]/l; o[2]=a[2]/l; return o;
}
export function v3lerp(a, b, t, o = []) {
  o[0]=a[0]+(b[0]-a[0])*t; o[1]=a[1]+(b[1]-a[1])*t; o[2]=a[2]+(b[2]-a[2])*t; return o;
}

export const mat4 = () => new Float32Array(16);

export function identity(m) {
  m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

// out = a * b
export function multiply(out, a, b) {
  const a00=a[0],a01=a[1],a02=a[2],a03=a[3];
  const a10=a[4],a11=a[5],a12=a[6],a13=a[7];
  const a20=a[8],a21=a[9],a22=a[10],a23=a[11];
  const a30=a[12],a31=a[13],a32=a[14],a33=a[15];
  for (let c = 0; c < 4; c++) {
    const b0=b[c*4], b1=b[c*4+1], b2=b[c*4+2], b3=b[c*4+3];
    out[c*4  ] = a00*b0 + a10*b1 + a20*b2 + a30*b3;
    out[c*4+1] = a01*b0 + a11*b1 + a21*b2 + a31*b3;
    out[c*4+2] = a02*b0 + a12*b1 + a22*b2 + a32*b3;
    out[c*4+3] = a03*b0 + a13*b1 + a23*b2 + a33*b3;
  }
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(out, eye, center, up) {
  let zx = eye[0]-center[0], zy = eye[1]-center[1], zz = eye[2]-center[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
  out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
  out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
  out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
  out[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
  out[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
  out[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
  out[15]=1;
  return out;
}

export function invert(out, m) {
  const a00=m[0],a01=m[1],a02=m[2],a03=m[3];
  const a10=m[4],a11=m[5],a12=m[6],a13=m[7];
  const a20=m[8],a21=m[9],a22=m[10],a23=m[11];
  const a30=m[12],a31=m[13],a32=m[14],a33=m[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
  const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
  const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
  const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
  if (!det) return identity(out);
  det = 1 / det;
  out[0]=(a11*b11-a12*b10+a13*b09)*det;
  out[1]=(a02*b10-a01*b11-a03*b09)*det;
  out[2]=(a31*b05-a32*b04+a33*b03)*det;
  out[3]=(a22*b04-a21*b05-a23*b03)*det;
  out[4]=(a12*b08-a10*b11-a13*b07)*det;
  out[5]=(a00*b11-a02*b08+a03*b07)*det;
  out[6]=(a32*b02-a30*b05-a33*b01)*det;
  out[7]=(a20*b05-a22*b02+a23*b01)*det;
  out[8]=(a10*b10-a11*b08+a13*b06)*det;
  out[9]=(a01*b08-a00*b10-a03*b06)*det;
  out[10]=(a30*b04-a31*b02+a33*b00)*det;
  out[11]=(a21*b02-a20*b04-a23*b00)*det;
  out[12]=(a11*b07-a10*b09-a12*b06)*det;
  out[13]=(a00*b09-a01*b07+a02*b06)*det;
  out[14]=(a31*b01-a30*b03-a32*b00)*det;
  out[15]=(a20*b03-a21*b01+a22*b00)*det;
  return out;
}

// out = m * (x,y,z,1), returns [x,y,z]
export function transformPoint(out, m, x, y, z) {
  const w = m[3]*x + m[7]*y + m[11]*z + m[15] || 1;
  out[0] = (m[0]*x + m[4]*y + m[8]*z + m[12]) / w;
  out[1] = (m[1]*x + m[5]*y + m[9]*z + m[13]) / w;
  out[2] = (m[2]*x + m[6]*y + m[10]*z + m[14]) / w;
  return out;
}

// rotate a vec3 by rotation about Y (angle rad) — for CPU-side placement
export function rotY(out, x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = c*x + s*z; out[1] = y; out[2] = -s*x + c*z;
  return out;
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
