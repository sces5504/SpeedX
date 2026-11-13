// Small math helpers shared by the whole game.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Move `current` toward `target` smoothly; `rate` is "how fast per second".
// Frame-rate independent (unlike a plain lerp with a fixed factor).
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

// Move toward target by at most maxStep.
export const approach = (current, target, maxStep) =>
  current < target ? Math.min(target, current + maxStep) : Math.max(target, current - maxStep);

// Shortest signed difference between two angles.
export const angleDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// Repeatable random numbers: the same seed always gives the same world.
export function makeRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D noise in 0..1, used for camera shake and road bumps.
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
