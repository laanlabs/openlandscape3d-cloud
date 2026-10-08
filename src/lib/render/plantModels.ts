// Detailed procedural plant models for the hi-res render. Pure geometry, deterministic from a
// variant seed, no third-party assets. Every model is built in unit space — base at y = 0, total
// height 1, widest spread 1 (radius 0.5) — and instanced at the plant's real height and spread, the
// same sizes the editor draws (growth model, scenario year), so the render never invents a size.
//
// A model has up to four parts that share each plant's instance matrix:
//   wood    trunks, branches and stems (bark material)
//   leaves  alpha-cut leaf cards (leaf atlas, tinted with the season's foliage colour)
//   solid   untextured foliage — grass blades, succulent leaves, palm fronds' ribs
//   flowers alpha-cut flower cards (tinted with the bloom colour, only when in bloom)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../analysis/groups';

export type Archetype =
  | 'tree-round' | 'tree-oval' | 'tree-spreading' | 'tree-vase' | 'tree-weeping' | 'tree-columnar' | 'tree-pyramidal'
  | 'conifer' | 'conifer-columnar' | 'palm'
  | 'shrub' | 'shrub-upright' | 'perennial' | 'grass' | 'groundcover' | 'succulent';

export interface PlantModel {
  wood?: THREE.BufferGeometry;
  leaves?: THREE.BufferGeometry;
  solid?: THREE.BufferGeometry;
  flowers?: THREE.BufferGeometry;
}

/** Atlas regions (u0, v0, u1, v1) in the 2×2 leaf atlas drawn by textures.ts. */
export const ATLAS = {
  broadleaf: [0, 0.5, 0.5, 1],
  needles: [0.5, 0.5, 1, 1],
  frond: [0, 0, 0.5, 0.5],
  flower: [0.5, 0, 1, 0.5]
} as const;
type Region = readonly [number, number, number, number];

/** Which archetype draws a catalog plant (form + crown), or an unknown plant (fallback category). */
export function archetypeFor(form: string, crown: string): Archetype {
  switch (form) {
    case 'tree':
      if (crown === 'columnar') return 'tree-columnar';
      if (crown === 'pyramidal') return 'tree-pyramidal';
      if (crown === 'vase') return 'tree-vase';
      if (crown === 'weeping') return 'tree-weeping';
      if (crown === 'spreading') return 'tree-spreading';
      if (crown === 'oval') return 'tree-oval';
      return 'tree-round';
    case 'conifer': return crown === 'columnar' ? 'conifer-columnar' : 'conifer';
    case 'palm': return 'palm';
    case 'shrub': return crown === 'upright' || crown === 'columnar' ? 'shrub-upright' : 'shrub';
    case 'perennial': case 'vine': return crown === 'mound' ? 'shrub' : 'perennial';
    case 'grass': return 'grass';
    case 'groundcover': return 'groundcover';
    case 'succulent': return crown === 'fan' ? 'palm' : 'succulent';
    default: return 'shrub';
  }
}

/** Variants per archetype; instances pick one from their seed so neighbours differ. */
export const VARIANTS = 3;

const cache = new Map<string, PlantModel>();

/** Height ÷ spread classes. Models are instanced with a non-uniform scale (spread, height, spread), so
 * cards are pre-squashed by 1 ÷ aspect to stay leaf-shaped after scaling. */
export const ASPECTS = [0.5, 0.8, 1.2, 1.8, 2.7, 4] as const;
export function aspectClass(height: number, spread: number): number {
  const a = height / Math.max(0.01, spread);
  let best = 0;
  for (let i = 1; i < ASPECTS.length; i++) if (Math.abs(Math.log(a / ASPECTS[i])) < Math.abs(Math.log(a / ASPECTS[best]))) best = i;
  return best;
}

let cardAspect = 1; // set while building a model; read by card()

export function plantModel(arch: Archetype, variant: number, aspect = 2): PlantModel {
  const key = `${arch}#${variant}@${aspect}`;
  let m = cache.get(key);
  if (!m) {
    cardAspect = ASPECTS[aspect] ?? 1;
    m = build(arch, rng((hash(arch) + variant * 7919) >>> 0));
    cardAspect = 1;
    for (const g of Object.values(m)) if (g) { g.userData.shared = true; g.computeBoundingSphere(); }
    cache.set(key, m);
  }
  return m;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- builders

class Parts {
  wood: THREE.BufferGeometry[] = [];
  leaves: THREE.BufferGeometry[] = [];
  solid: THREE.BufferGeometry[] = [];
  flowers: THREE.BufferGeometry[] = [];
  done(): PlantModel {
    const merge = (list: THREE.BufferGeometry[]) => (list.length ? mergeGeometries(list.map(prep))! : undefined);
    return { wood: merge(this.wood), leaves: merge(this.leaves), solid: merge(this.solid), flowers: merge(this.flowers) };
  }
}

/** Every part geometry: non-indexed, with position, normal, uv and color, so they merge. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
  if (!ng.getAttribute('color')) {
    const c = new Float32Array(ng.getAttribute('position').count * 3).fill(1);
    ng.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  for (const name of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) ng.deleteAttribute(name);
  return ng;
}

function shade(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(k), 3));
  return g;
}

/** Tapered tube from a to b. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** A leaf card (quad) at `c`, facing a random-ish direction biased outward, mapped to an atlas region. */
function card(c: THREE.Vector3, size: number, outward: THREE.Vector3, r: () => number, region: Region, brightness: number, droop = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const [u0, v0, u1, v1] = region;
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  // Orient: normal = outward mixed with random, then spin around it.
  const n = outward.clone().multiplyScalar(0.7).add(new THREE.Vector3(r() - 0.5, r() - 0.5 - droop, r() - 0.5)).normalize();
  g.rotateZ(r() * Math.PI * 2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
  // Undo the instance's vertical stretch so the card keeps its shape on tall or flat plants.
  g.scale(1, 1 / cardAspect, 1);
  g.translate(c.x, c.y, c.z);
  return shade(g, brightness);
}

/** Point inside a crown envelope: radius profile `prof(t)` (t = 0 bottom … 1 top of crown), biased to the shell. */
function crownPoint(r: () => number, base: number, top: number, prof: (t: number) => number): { p: THREE.Vector3; t: number; s: number } {
  const t = r();
  const rad = prof(t);
  const s = Math.pow(r(), 0.35); // most cards near the shell, some inside
  const a = r() * Math.PI * 2;
  return { p: new THREE.Vector3(Math.cos(a) * rad * s, base + t * (top - base), Math.sin(a) * rad * s), t, s };
}

const PROFILES: Record<string, (t: number) => number> = {
  round: (t) => 0.5 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
  oval: (t) => 0.46 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
  spreading: (t) => 0.5 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * (0.75 + 0.25 * t),
  vase: (t) => 0.12 + 0.38 * Math.min(1, t * 1.6) * (t > 0.85 ? (1 - t) / 0.15 * 0.7 + 0.3 : 1),
  weeping: (t) => 0.5 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * (0.85 + 0.15 * (1 - t)),
  columnar: (t) => 0.5 * Math.min(1, Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 6))),
  pyramidal: (t) => 0.5 * (1 - t) * 0.98 + 0.01
};

function broadleafTree(r: () => number, crown: keyof typeof PROFILES): PlantModel {
  const P = new Parts();
  const base = crown === 'weeping' ? 0.18 : crown === 'vase' ? 0.26 : crown === 'columnar' || crown === 'pyramidal' ? 0.12 : 0.32;
  const top = 1;
  const prof = PROFILES[crown];
  const trunkTop = new THREE.Vector3((r() - 0.5) * 0.03, base + (top - base) * 0.35, (r() - 0.5) * 0.03);
  P.wood.push(tube(new THREE.Vector3(0, 0, 0), trunkTop, 0.045, 0.03, 8));
  // Primary and secondary branches reaching into the envelope (visible when leaf-off).
  const primaries = 5 + Math.floor(r() * 3);
  for (let i = 0; i < primaries; i++) {
    const a = (i / primaries) * Math.PI * 2 + r() * 0.6;
    const t = 0.35 + r() * 0.45;
    const rad = prof(t) * (0.75 + r() * 0.2);
    const end = new THREE.Vector3(Math.cos(a) * rad, base + t * (top - base), Math.sin(a) * rad);
    const startY = base * (0.85 + r() * 0.15) + (trunkTop.y - base) * r();
    const start = new THREE.Vector3(trunkTop.x * 0.5, startY, trunkTop.z * 0.5);
    P.wood.push(tube(start, end, 0.022, 0.008, 5));
    for (let k = 0; k < 3; k++) {
      const m = start.clone().lerp(end, 0.4 + r() * 0.5);
      const ta = Math.min(0.98, t + (r() - 0.3) * 0.4);
      const a2 = a + (r() - 0.5) * 1.6;
      const r2 = prof(ta) * (0.7 + r() * 0.25);
      const e2 = new THREE.Vector3(Math.cos(a2) * r2, base + ta * (top - base), Math.sin(a2) * r2);
      P.wood.push(tube(m, e2, 0.008, 0.003, 4));
    }
  }
  const n = Math.round((crown === 'columnar' ? 420 : 560) * Math.max(1, cardAspect / 1.2));
  const droop = crown === 'weeping' ? 0.9 : 0;
  for (let i = 0; i < n; i++) {
    const { p, s } = crownPoint(r, base + 0.02, top, prof);
    if (crown === 'weeping' && r() < 0.5) p.y -= (1 - s) * 0.08;
    const out = new THREE.Vector3(p.x, (p.y - (base + top) / 2) * 0.6, p.z).normalize();
    const size = 0.16 + r() * 0.08;
    P.leaves.push(card(p, size, out, r, ATLAS.broadleaf, 0.55 + 0.45 * s * (0.85 + 0.15 * r()), droop));
  }
  // Flowering trees: blossom cards on the shell.
  for (let i = 0; i < 120; i++) {
    const { p } = crownPoint(r, base + 0.05, top, (t) => prof(t) * 1.02);
    const out = new THREE.Vector3(p.x, p.y - (base + top) / 2, p.z).normalize();
    P.flowers.push(card(p, 0.06 + r() * 0.03, out, r, ATLAS.flower, 0.9 + r() * 0.1));
  }
  return P.done();
}

function conifer(r: () => number, columnar: boolean): PlantModel {
  const P = new Parts();
  P.wood.push(tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.96, 0), 0.04, 0.006, 7));
  // Tall, narrow plants need more tiers so the stretched tiers still overlap.
  const tiers = Math.round(14 * Math.max(1, cardAspect / 1.2));
  for (let k = 0; k < tiers; k++) {
    const t = 0.07 + (k / tiers) * 0.9;
    const rad = columnar ? 0.5 * Math.min(1, Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 6))) * 0.95 : 0.5 * Math.pow(1 - t, 0.95);
    const count = Math.max(6, Math.round(rad * 44));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.5 + k;
      const len = rad * (0.75 + r() * 0.3);
      const y = t + (r() - 0.5) * 0.03;
      // Drooping branch: a few needle cards along it.
      for (let j = 1; j <= 3; j++) {
        const f = j / 3;
        const p = new THREE.Vector3(Math.cos(a) * len * f, y - f * f * 0.04, Math.sin(a) * len * f);
        const out = new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize();
        P.leaves.push(card(p, 0.12 + rad * 0.16, out, r, ATLAS.needles, 0.5 + 0.5 * f * (0.8 + 0.2 * r()), 0.4));
      }
    }
  }
  return P.done();
}

function palm(r: () => number): PlantModel {
  const P = new Parts();
  // Gently curved trunk in 5 segments with ring bands (shaded).
  const lean = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize().multiplyScalar(0.06);
  let prev = new THREE.Vector3(0, 0, 0);
  const crownY = 0.7;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const p = new THREE.Vector3(lean.x * t * t, crownY * t, lean.z * t * t);
    P.wood.push(shade(tube(prev, p, 0.05 - t * 0.012, 0.05 - t * 0.012 - 0.002, 9), i % 2 ? 0.9 : 0.75));
    prev = p;
  }
  // Fronds: arching strips with a leaflet texture.
  const fronds = 13;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.3;
    const up = 0.25 + r() * 0.5;
    const segs = 6;
    for (let j = 0; j < segs; j++) {
      const f0 = j / segs, f1 = (j + 1) / segs;
      // Frond arcs out from the top of the (leaning) trunk.
      const pt = (f: number) => new THREE.Vector3(prev.x + Math.cos(a) * 0.5 * f, crownY + (up * f - f * f * 0.45) * 0.4, prev.z + Math.sin(a) * 0.5 * f);
      const a0 = pt(f0), a1 = pt(f1);
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.07 * (1 - f0 * 0.6));
      const g = new THREE.BufferGeometry();
      const pos = [a0.clone().sub(side), a0.clone().add(side), a1.clone().add(side), a0.clone().sub(side), a1.clone().add(side), a1.clone().sub(side)];
      g.setFromPoints(pos);
      const [u0, v0, u1, v1] = ATLAS.frond;
      const uvs = [[u0, v0 + f0 * (v1 - v0)], [u1, v0 + f0 * (v1 - v0)], [u1, v0 + f1 * (v1 - v0)], [u0, v0 + f0 * (v1 - v0)], [u1, v0 + f1 * (v1 - v0)], [u0, v0 + f1 * (v1 - v0)]];
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
      g.computeVertexNormals();
      P.leaves.push(shade(g, 0.75 + 0.25 * r()));
    }
  }
  return P.done();
}

function shrub(r: () => number, upright: boolean): PlantModel {
  const P = new Parts();
  const prof = upright ? (t: number) => 0.42 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 4)) : (t: number) => 0.5 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.05) / 0.95 * 2 - 1, 2))) * (t < 0.08 ? 0.6 : 1);
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    P.wood.push(tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.15, 0.3, Math.sin(a) * 0.15), 0.02, 0.01, 4));
  }
  for (let i = 0, n = Math.round(460 * Math.max(1, cardAspect / 1.2)); i < n; i++) {
    const { p, s } = crownPoint(r, 0.04, 1, prof);
    const out = new THREE.Vector3(p.x, (p.y - 0.5) * 0.8, p.z).normalize();
    P.leaves.push(card(p, 0.22 + r() * 0.1, out, r, ATLAS.broadleaf, 0.5 + 0.5 * s * (0.85 + 0.15 * r())));
  }
  for (let i = 0; i < 70; i++) {
    const { p } = crownPoint(r, 0.25, 1, (t) => prof(t) * 1.03);
    if (p.y < 0.3) continue;
    const out = new THREE.Vector3(p.x, (p.y - 0.4), p.z).normalize();
    P.flowers.push(card(p, 0.1 + r() * 0.05, out, r, ATLAS.flower, 0.9 + r() * 0.1));
  }
  return P.done();
}

function perennial(r: () => number): PlantModel {
  const P = new Parts();
  const stems = 16;
  for (let i = 0; i < stems; i++) {
    const a = r() * Math.PI * 2, lean = r() * 0.32;
    const h = 0.65 + r() * 0.35;
    const tip = new THREE.Vector3(Math.cos(a) * lean, h, Math.sin(a) * lean);
    P.wood.push(shade(tube(new THREE.Vector3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), tip, 0.012, 0.006, 4), 0.9));
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Vector3(0, 0, 0).lerp(tip, 0.1 + r() * 0.55);
      P.leaves.push(card(p, 0.26 + r() * 0.1, new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)), r, ATLAS.broadleaf, 0.6 + 0.4 * r()));
    }
    for (let k = 0; k < 2; k++) {
      const p = tip.clone().add(new THREE.Vector3((r() - 0.5) * 0.08, -r() * 0.06, (r() - 0.5) * 0.08));
      P.flowers.push(card(p, 0.14 + r() * 0.06, new THREE.Vector3(0, 1, 0), r, ATLAS.flower, 0.95));
    }
  }
  return P.done();
}

function grass(r: () => number): PlantModel {
  const P = new Parts();
  const blades = 70;
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI * 2;
    const h = 0.65 + r() * 0.35, reach = 0.25 + r() * 0.3;
    const segs = 5, w0 = 0.025;
    const pts: THREE.Vector3[] = [];
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let j = 0; j <= segs; j++) {
      const f = j / segs;
      const c = dir.clone().multiplyScalar(reach * f * f).add(new THREE.Vector3(0, h * Math.sin(f * Math.PI * 0.5) * (1 - 0.25 * f * f), 0));
      const w = w0 * (1 - f * 0.9);
      pts.push(c.clone().add(side.clone().multiplyScalar(w)), c.clone().sub(side.clone().multiplyScalar(w)));
    }
    const pos: number[] = [], col: number[] = [];
    for (let j = 0; j < segs; j++) {
      const q = [pts[2 * j], pts[2 * j + 1], pts[2 * j + 2], pts[2 * j + 1], pts[2 * j + 3], pts[2 * j + 2]];
      for (const p of q) pos.push(p.x, p.y, p.z);
      const k = 0.55 + 0.45 * (j / segs);
      for (let v = 0; v < 6; v++) col.push(k, k, k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    P.solid.push(g);
    // Plume at the tip (shown only when in bloom).
    if (i % 3 === 0) {
      const tip = pts[pts.length - 2].clone().lerp(pts[pts.length - 1], 0.5);
      P.flowers.push(card(tip, 0.12, dir.clone().setY(0.5).normalize(), r, ATLAS.needles, 1));
    }
  }
  return P.done();
}

function groundcover(r: () => number): PlantModel {
  const P = new Parts();
  for (let i = 0; i < 220; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.48;
    const p = new THREE.Vector3(Math.cos(a) * d, 0.15 + r() * 0.7 * (1 - d), Math.sin(a) * d);
    P.leaves.push(card(p, 0.16 + r() * 0.06, new THREE.Vector3(0, 1, 0), r, ATLAS.broadleaf, 0.55 + 0.45 * r()));
  }
  for (let i = 0; i < 45; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.46;
    P.flowers.push(card(new THREE.Vector3(Math.cos(a) * d, 0.7 + r() * 0.3, Math.sin(a) * d), 0.09, new THREE.Vector3(0, 1, 0), r, ATLAS.flower, 0.95));
  }
  return P.done();
}

function succulent(r: () => number): PlantModel {
  const P = new Parts();
  const leaves = 26;
  for (let i = 0; i < leaves; i++) {
    const golden = i * 2.39996;
    const f = i / leaves;
    const tilt = 0.25 + 1.05 * (1 - f) + (r() - 0.5) * 0.2; // outer leaves lie flatter
    const len = 0.42 * (0.55 + 0.45 * (1 - f)) * (0.88 + r() * 0.24);
    const g = new THREE.ConeGeometry(0.05 * (1.2 - f * 0.5), len, 6);
    g.translate(0, len / 2, 0);
    g.scale(1, 1, 0.45);
    g.rotateZ(-tilt);
    g.rotateY(golden + (r() - 0.5) * 0.3);
    g.translate(0, 0.02, 0);
    P.solid.push(shade(g, 0.65 + 0.35 * f + (r() - 0.5) * 0.08));
  }
  // Normalise to unit height and spread.
  const m = P.done();
  if (m.solid) {
    m.solid.computeBoundingBox();
    const bb = m.solid.boundingBox!;
    const s = 1 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    m.solid.scale(s, 1 / (bb.max.y - bb.min.y), s).translate(0, -bb.min.y / (bb.max.y - bb.min.y), 0);
  }
  return m;
}

function build(arch: Archetype, r: () => number): PlantModel {
  switch (arch) {
    case 'tree-round': return broadleafTree(r, 'round');
    case 'tree-oval': return broadleafTree(r, 'oval');
    case 'tree-spreading': return broadleafTree(r, 'spreading');
    case 'tree-vase': return broadleafTree(r, 'vase');
    case 'tree-weeping': return broadleafTree(r, 'weeping');
    case 'tree-columnar': return broadleafTree(r, 'columnar');
    case 'tree-pyramidal': return broadleafTree(r, 'pyramidal');
    case 'conifer': return conifer(r, false);
    case 'conifer-columnar': return conifer(r, true);
    case 'palm': return palm(r);
    case 'shrub': return shrub(r, false);
    case 'shrub-upright': return shrub(r, true);
    case 'perennial': return perennial(r);
    case 'grass': return grass(r);
    case 'groundcover': return groundcover(r);
    case 'succulent': return succulent(r);
  }
}
