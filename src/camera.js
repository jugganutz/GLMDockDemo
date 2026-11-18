// camera.js — cinematic + manual (mouse / touch) camera
import { lookAt, perspective, v3lerp, clamp, lerp, smoothstep } from './engine/math.js';

const DEG = Math.PI / 180;

const SHOTS = [
  { eye: [-74, 4.6, 38],   look: [10, 8, -14],  fov: 56, dur: 10 },  // sea side, berthing silhouette
  { eye: [14, 2.4, 64],    look: [-6, 12, 0],   fov: 50, dur: 9  },  // from open water, crane towers
  { eye: [40, 2.6, -17],   look: [-40, 3.4, -12], fov: 52, dur: 9 }, // aisle dolly between rows
  { eye: [-4, 34, 55],     look: [0, 30, 6],    fov: 58, dur: 8  },  // up into the crane steel
  { eye: [64, 2.0, -9],    look: [-40, 3.5, -14], fov: 46, dur: 9 },  // low along the wet apron
  { eye: [6, 8, -62],      look: [-2, 3, 10],   fov: 54, dur: 10 },  // dock edge, lamps over water
];

export function createCamera(canvas) {
  const st = {
    // manual orbit state
    target: [2, 2.0, -12], dist: 62, yaw: 2.28, pitch: 0.30, fov: 55,
    tYaw: 2.28, tPitch: 0.30, tDist: 62, tTarget: [2, 2.0, -12],
    // cinematic
    cinematic: true, shot: 0, shotT: 0,
    blend: 1, curEye: SHOTS[0].eye.slice(), curLook: SHOTS[0].look.slice(), curFov: SHOTS[0].fov,
    // touch
    pointers: new Map(), pinchDist: 0,
  };

  const eye = [0, 0, 0], lp = [0, 0, 0];
  const view = new Float32Array(16), proj = new Float32Array(16);

  function orbitEye(out, yaw, pitch, dist, target) {
    const cp = Math.cos(pitch);
    out[0] = target[0] + Math.sin(yaw) * cp * dist;
    out[1] = target[1] + Math.sin(pitch) * dist;
    out[2] = target[2] + Math.cos(yaw) * cp * dist;
    return out;
  }

  function evalShot(i, t, outEye, outLook, outFov) {
    const s = SHOTS[i % SHOTS.length];
    const drift = Math.sin(t * 0.11) * 0.5 + Math.sin(t * 0.043) * 0.4;
    // slow orbital drift around the look point
    const cx = s.look[0], cz = s.look[2];
    const dx = s.eye[0] - cx, dz = s.eye[2] - cz;
    const r = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx) + drift * 0.035;
    const dy = s.eye[1] - s.look[1];
    outEye[0] = cx + Math.cos(a) * r;
    outEye[1] = s.look[1] + dy + Math.sin(t * 0.07 + i) * 0.55;
    outEye[2] = cz + Math.sin(a) * r;
    outLook[0] = s.look[0] + Math.sin(t * 0.05 + i * 2.1) * 1.4;
    outLook[1] = s.look[1] + Math.sin(t * 0.04 + i) * 0.7;
    outLook[2] = s.look[2] + Math.cos(t * 0.045 + i) * 1.4;
    outFov[0] = s.fov;
    return s.dur;
  }

  const sEye = [0,0,0], sLook = [0,0,0], sFov = [0];

  function update(dt, time, params, aspect) {
    if (params.cinematic && st.cinematic) {
      st.shotT += dt;
      const dur = evalShot(st.shot, time, sEye, sLook, sFov);
      if (st.shotT > dur) { st.shotT = 0; st.shot = (st.shot + 1) % SHOTS.length; evalShot(st.shot, time, sEye, sLook, sFov); }
      // hard cut, then micro-dolly of the fresh shot
      st.blend = 1;
      st.curEye = sEye.slice();
      st.curLook = sLook.slice();
      st.curFov = sFov[0];
      // gentle forward creep between cuts
      const creep = Math.min(st.shotT, dur) * 0.16;
      const dir = [sLook[0]-sEye[0], sLook[1]-sEye[1], sLook[2]-sEye[2]];
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      st.curEye[0] += dir[0]/l * creep; st.curEye[1] += dir[1]/l * creep; st.curEye[2] += dir[2]/l * creep;
      eye[0]=st.curEye[0]; eye[1]=st.curEye[1]; eye[2]=st.curEye[2];
      lp[0]=st.curLook[0]; lp[1]=st.curLook[1]; lp[2]=st.curLook[2];
      st.fovNow = st.curFov;
    } else {
      // manual: damped orbit
      const k = 1 - Math.exp(-dt * 7);
      st.yaw = lerp(st.yaw, st.tYaw, k);
      st.pitch = lerp(st.pitch, st.tPitch, k);
      st.dist = lerp(st.dist, st.tDist, k);
      st.target = v3lerp(st.target, st.tTarget, k, st.target);
      orbitEye(eye, st.yaw, st.pitch, st.dist, st.target);
      lp[0]=st.target[0]; lp[1]=st.target[1]; lp[2]=st.target[2];
      st.fovNow = st.fov;
    }
    lookAt(view, eye, lp, [0, 1, 0]);
    perspective(proj, st.fovNow * DEG, aspect, 0.3, 2600);
    return { eye: eye.slice(), look: lp.slice(), view, proj, fov: st.fovNow };
  }

  function goManual() {
    if (!st.cinematic) return;
    st.cinematic = false;
    // seed orbit state from current cinematic camera
    const dx = st.curEye[0]-st.curLook[0], dy = st.curEye[1]-st.curLook[1], dz = st.curEye[2]-st.curLook[2];
    st.dist = st.tDist = Math.hypot(dx, dy, dz);
    st.pitch = st.tPitch = clamp(Math.asin(dy / st.dist), -0.05, 1.35);
    st.yaw = st.tYaw = Math.atan2(dx, dz);
    st.target = st.tTarget = st.curLook.slice();
  }
  function goCinematic() { st.cinematic = true; st.shotT = 0; }

  // manual camera placed from eye/look — used by dev URL params
  function setManual(eye, look, fovDeg = 55) {
    goManual();
    st.fov = fovDeg;
    const dx = eye[0]-look[0], dy = eye[1]-look[1], dz = eye[2]-look[2];
    st.dist = st.tDist = Math.hypot(dx, dy, dz);
    st.pitch = st.tPitch = clamp(Math.asin(dy/Math.max(st.dist, 1e-3)), -0.06, 1.32);
    st.yaw = st.tYaw = Math.atan2(dx, dz);
    st.target = st.tTarget = look.slice();
  }

  // ------- input -------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5];
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    st.pointers.set(e.pointerId, pos(e));
    canvas.classList.add('dragging');
    goManual();
    if (window.__dockOnInteract) window.__dockOnInteract();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!st.pointers.has(e.pointerId)) return;
    const prev = st.pointers.get(e.pointerId);
    const p = pos(e);
    st.pointers.set(e.pointerId, p);
    if (st.pointers.size === 1) {
      // orbit
      st.tYaw += (p[0]-prev[0]) * 0.0055;
      st.tPitch = clamp(st.tPitch + (p[1]-prev[1]) * 0.0045, -0.06, 1.32);
    } else if (st.pointers.size === 2) {
      const ids = [...st.pointers.keys()];
      const a = st.pointers.get(ids[0]), b = st.pointers.get(ids[1]);
      const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
      if (st.pinchDist > 0) {
        st.tDist = clamp(st.tDist * (st.pinchDist / Math.max(d, 8)), 8, 220);
      }
      st.pinchDist = d;
    }
  });
  const end = (e) => {
    st.pointers.delete(e.pointerId);
    if (st.pointers.size < 2) st.pinchDist = 0;
    if (st.pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goManual();
    st.tDist = clamp(st.tDist * Math.exp(e.deltaY * 0.0011), 8, 220);
    if (window.__dockOnInteract) window.__dockOnInteract();
  }, { passive: false });

  return { update, st, goManual, goCinematic, setManual };
}
