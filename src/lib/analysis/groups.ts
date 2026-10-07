// Plant groups → resolved plant instances. Deterministic: the same group (kind, geometry, spacing,
// mix, seed) always yields the same positions, plant ids, instance ids and visual seeds. Resolved
// instances are written to `plants` (with `groupId`) so other apps never need to re-run this.
import type { Catalog } from '../catalog/catalog';
import { installDims } from '../catalog/catalog';
import type { PlantGroup, PlantInstance, Polygon, Vec2 } from '../model/types';
import { stableId } from '../model/types';
import { bbox, dist, pointAlong, pointInPolygon, polygonArea, polylineLength } from '../model/geometry';

/** mulberry32 — tiny, fast, deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000; // mm precision keeps exports stable

/** Row / hedge: n = max(1, round(L / spacing)) plants, evenly at (i + ½)·L/n along the path. */
export function rowPoints(path: Vec2[], spacing: number): Vec2[] {
  const L = polylineLength(path);
  if (path.length < 2 || L <= 0) return path.slice(0, 1);
  const n = Math.max(1, Math.round(L / Math.max(0.05, spacing)));
  return Array.from({ length: n }, (_, i) => pointAlong(path, ((i + 0.5) * L) / n).point);
}

/** Grid: square grid at `spacing`, centred on the polygon's bounding box, points inside the polygon. */
export function gridPoints(poly: Polygon, spacing: number): Vec2[] {
  const s = Math.max(0.05, spacing);
  const b = bbox(poly);
  const nx = Math.floor((b.max[0] - b.min[0]) / s), ny = Math.floor((b.max[1] - b.min[1]) / s);
  const x0 = (b.min[0] + b.max[0]) / 2 - (nx * s) / 2, y0 = (b.min[1] + b.max[1]) / 2 - (ny * s) / 2;
  const out: Vec2[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const p: Vec2 = [x0 + i * s, y0 + j * s];
    if (pointInPolygon(p, poly)) out.push(p);
  }
  return out;
}

/**
 * Mass / scatter: seeded dart-throwing Poisson-disk. Candidates are drawn uniformly in the bounding
 * box; one is kept when it is inside the polygon and at least 0.85·spacing from every kept point.
 * The candidate budget is fixed (30 per expected plant), so the result depends only on the inputs.
 */
export function massPoints(poly: Polygon, spacing: number, seed: number): Vec2[] {
  const s = Math.max(0.05, spacing);
  const minD = 0.85 * s;
  const b = bbox(poly);
  const expected = Math.max(1, polygonArea(poly) / (s * s));
  const budget = Math.min(200000, Math.ceil(expected * 30));
  const r = rng(seed);
  const cell = minD / Math.SQRT2;
  const grid = new Map<string, Vec2>();
  const out: Vec2[] = [];
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  for (let k = 0; k < budget; k++) {
    const p: Vec2 = [b.min[0] + r() * w, b.min[1] + r() * h];
    if (!pointInPolygon(p, poly)) continue;
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++) for (let dy = -2; dy <= 2 && ok; dy++) {
      const q = grid.get(`${gx + dx},${gy + dy}`);
      if (q && dist(p, q) < minD) ok = false;
    }
    if (!ok) continue;
    grid.set(`${gx},${gy}`, p);
    out.push(p);
  }
  if (!out.length) {
    // Polygon smaller than one plant: one plant at the first vertex-centroid point inside it.
    const c: Vec2 = [poly.reduce((a, q) => a + q[0], 0) / poly.length, poly.reduce((a, q) => a + q[1], 0) / poly.length];
    out.push(c);
  }
  return out;
}

/** Exact ratio split by largest remainder, ties by mix order. */
export function mixCounts(mix: PlantGroup['mix'], n: number): number[] {
  const total = mix.reduce((a, m) => a + Math.max(0, m.ratio), 0) || 1;
  const raw = mix.map((m) => (Math.max(0, m.ratio) / total) * n);
  const counts = raw.map(Math.floor);
  let left = n - counts.reduce((a, c) => a + c, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length].i]++;
  return counts;
}

export function groupPoints(g: PlantGroup): Vec2[] {
  if (g.kind === 'row') return rowPoints(g.path ?? [], g.spacing);
  if (!g.polygon || g.polygon.length < 3) return [];
  return g.kind === 'grid' ? gridPoints(g.polygon, g.spacing) : massPoints(g.polygon, g.spacing, g.seed);
}

/**
 * Resolves a group into plant instances. Plant ids are assigned by `mixCounts` then a seeded
 * Fisher–Yates shuffle (rows keep a repeating pattern instead, so hedges alternate evenly).
 * Instance ids are stable UUIDs derived from group id + index.
 */
export function resolveGroup(g: PlantGroup, cat: Catalog, opts: { status?: PlantInstance['status']; plantedYear?: number } = {}): PlantInstance[] {
  const pts = groupPoints(g).map((p) => [round(p[0]), round(p[1])] as Vec2);
  const mix = g.mix.length ? g.mix : [];
  if (!mix.length || !pts.length) return [];
  const counts = mixCounts(mix, pts.length);
  let ids: string[] = [];
  if (g.kind === 'row') {
    // Interleave so a 2:1 hedge reads A A B A A B…: next is the plant whose (placed + 1) / count is lowest.
    const placed = counts.map(() => 0);
    for (let i = 0; i < pts.length; i++) {
      let best = -1, bestScore = Infinity;
      for (let k = 0; k < mix.length; k++) {
        if (placed[k] >= counts[k]) continue;
        const score = (placed[k] + 1) / counts[k];
        if (score < bestScore - 1e-12) { bestScore = score; best = k; }
      }
      placed[best]++;
      ids.push(mix[best].plantId);
    }
  } else {
    counts.forEach((c, k) => { for (let i = 0; i < c; i++) ids.push(mix[k].plantId); });
    const r = rng(g.seed ^ 0x9e3779b9);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  }
  const seeds = rng(g.seed + 1);
  return pts.map((pt, i) => {
    const plant = cat.plant(ids[i]);
    const dims = plant ? installDims(plant) : { code: '#1', heightM: 0.3, spreadM: 0.3 };
    return {
      id: stableId(`${g.id}:${i}`),
      plantId: ids[i],
      x: pt[0],
      y: pt[1],
      status: opts.status ?? 'proposed',
      plantedYear: opts.plantedYear ?? 0,
      installSize: dims.code,
      installHeight: dims.heightM,
      installSpread: dims.spreadM,
      groupId: g.id,
      seed: Math.floor(seeds() * 1e9)
    };
  });
}

/** Default spacing for a mix: the ratio-weighted catalog spacing. */
export function mixSpacing(mix: PlantGroup['mix'], cat: Catalog): number {
  const total = mix.reduce((a, m) => a + m.ratio, 0) || 1;
  const s = mix.reduce((a, m) => a + (cat.plant(m.plantId)?.spacingM ?? 0.6) * m.ratio, 0) / total;
  return Math.round(s * 100) / 100 || 0.6;
}
