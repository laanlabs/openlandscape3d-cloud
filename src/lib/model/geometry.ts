// Plan geometry in metres. Polygons are [x, y] arrays, open (first ≠ last), either winding.
import type { Building, Polygon, Vec2 } from './types';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const polygonArea = (poly: Polygon) => Math.abs(signedArea(poly));

export function perimeter(poly: Polygon, closed = true): number {
  let s = 0;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

/** Strict interior test (ray casting). Points exactly on an edge may go either way. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(poly: Polygon): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), [0, 0] as Vec2);
    return scale(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(points: Vec2[]): { min: Vec2; max: Vec2 } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { min: [x0, y0], max: [x1, y1] };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const L2 = d[0] * d[0] + d[1] * d[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
  return dist(p, add(a, scale(d, t)));
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const d = sub(b, a);
  const L2 = d[0] * d[0] + d[1] * d[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
  return { point: add(a, scale(d, t)), t };
}

export const polylineLength = (pts: Vec2[]) => perimeter(pts, false);

/** Point and unit direction at arc length s along a polyline. */
export function pointAlong(pts: Vec2[], s: number): { point: Vec2; dir: Vec2 } {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = dist(pts[i], pts[i + 1]);
    if (s <= acc + L || i === pts.length - 2) {
      const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      const d = L ? scale(sub(pts[i + 1], pts[i]), 1 / L) : ([1, 0] as Vec2);
      return { point: lerp(pts[i], pts[i + 1], t), dir: d };
    }
    acc += L;
  }
  return { point: pts[0] ?? [0, 0], dir: [1, 0] };
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Minimum-area oriented bounding rectangle (rotating calipers over hull edges).
 * Angle is the direction of the rectangle's width axis in plan coordinates (radians), normalised to (−π/2, π/2].
 */
export function orientedRect(poly: Polygon): { center: Vec2; width: number; depth: number; angle: number } {
  const hull = convexHull(poly);
  let best = { area: Infinity, center: [0, 0] as Vec2, width: 0, depth: 0, angle: 0 };
  const edges = hull.length >= 2 ? hull : poly;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i], b = edges[(i + 1) % edges.length];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang <= -Math.PI / 2) ang += Math.PI;
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of edges) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area - 1e-9) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      best = { area, center: [uc * c - vc * s, uc * s + vc * c], width: u1 - u0, depth: v1 - v0, angle: ang };
    }
  }
  return { center: best.center, width: best.width, depth: best.depth, angle: best.angle };
}

/** Rectangle corners for a centre / size / rotation (degrees), as drawn in plan. */
export function rectCorners(cx: number, cy: number, w: number, d: number, rotationDeg: number): Vec2[] {
  const r = rad(rotationDeg), c = Math.cos(r), s = Math.sin(r);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Vec2[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Vec2);
}

/** Building wall segments (plan metres) from verbatim OpenPlan3D walls. */
export function wallSegments(b: Building | null | undefined): { id: string; a: Vec2; b: Vec2; thickness: number; height: number }[] {
  if (!b) return [];
  return (b.walls ?? []).filter((w) => Array.isArray(w?.transform) && Array.isArray(w?.dimensions)).map((w) => {
    const t = w.transform as number[];
    const n = Math.hypot(t[0], t[2]) || 1;
    const dir: Vec2 = [t[0] / n, t[2] / n];
    const c: Vec2 = [t[12], t[14]];
    const half = w.dimensions[0] / 2;
    return { id: String(w.identifier), a: sub(c, scale(dir, half)), b: add(c, scale(dir, half)), thickness: w.dimensions[2] || 0.15, height: w.dimensions[1] ?? 2.4 };
  });
}

/** Doors/windows/openings positioned in plan from their transforms. */
export function wallOpenings(b: Building | null | undefined): { id: string; kind: 'door' | 'window' | 'opening'; center: Vec2; angle: number; width: number; height: number; sill: number }[] {
  if (!b) return [];
  const out: ReturnType<typeof wallOpenings> = [];
  const read = (list: any[] | undefined, kind: 'door' | 'window' | 'opening') => {
    for (const o of list ?? []) {
      const t = o?.transform as number[] | undefined;
      if (!t || !o.dimensions) continue;
      out.push({ id: String(o.identifier), kind, center: [t[12], t[14]], angle: Math.atan2(t[2], t[0]), width: o.dimensions[0], height: o.dimensions[1], sill: kind === 'window' ? (o.sillHeight ?? Math.max(0, t[13] - o.dimensions[1] / 2)) : 0 });
    }
  };
  read(b.doors, 'door');
  read(b.windows, 'window');
  read(b.openings, 'opening');
  return out;
}

export function snapTo(v: number, step: number) {
  return step > 0 ? Math.round(v / step) * step : v;
}
