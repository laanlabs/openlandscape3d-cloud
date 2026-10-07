// Procedural three.js scene builders. Metres; plan x → world X, plan y → world Z, Y up.
// Rotations: an OpenPlan3D transform with heading a equals makeRotationY(−a), so plan angles and
// object rotations (degrees, front = (−sin r, cos r)) map to `rotation.y = −angle`.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Catalog, Plant } from '../catalog/catalog';
import type { Area, Building, Line, PlantInstance, Polygon, Project, SiteObject, Vec2 } from '../model/types';
import { bbox, rad, wallSegments } from '../model/geometry';
import { matureRadius, seasonLook, sizeAt } from '../analysis/growth';
import { rng } from '../analysis/groups';

export const ACCENT = '#3f9e6e';

// ---------- disposal ----------

/** Removes and disposes everything under a group (shared unit geometries are kept). */
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) (mat as THREE.Material).dispose();
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
  g.clear();
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

function shadows<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
  return o;
}

// ---------- ground & boundary ----------

export function buildGround(radius: number): THREE.Mesh {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), std('#c9d1bf', { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

export function buildBoundary(poly: Polygon | undefined): THREE.Object3D | null {
  if (!poly || poly.length < 3) return null;
  const pts = [...poly, poly[0]].map(([x, y]) => new THREE.Vector3(x, 0.03, y));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#8a5a2b' }));
  line.name = 'boundary';
  return line;
}

// ---------- areas ----------

const AREA_FALLBACK: Record<string, string> = {
  lawn: '#7fae5a', bed: '#6b4a32', mulch: '#6b4a32', gravel: '#b9ad97', patio: '#9aa3a8',
  path: '#c2b59b', deck: '#8a6b52', driveway: '#55585b', water: '#4aa3c9'
};
/** Top surface offset (z-fighting order) and thickness per kind. */
const AREA_LAYER: Record<string, { y: number; t: number }> = {
  lawn: { y: 0.004, t: 0.004 }, bed: { y: 0.012, t: 0.01 }, mulch: { y: 0.014, t: 0.01 }, gravel: { y: 0.02, t: 0.015 },
  path: { y: 0.05, t: 0.05 }, driveway: { y: 0.06, t: 0.06 }, patio: { y: 0.08, t: 0.08 }, deck: { y: 0, t: 0.1 }, water: { y: 0.025, t: 0.02 }
};
export const SOFT_AREAS = new Set(['lawn', 'bed', 'mulch']);

/** Polygon extruded from y0 to y0 + h (top face at y0 + h). */
export function extrudePolygon(poly: Polygon, y0: number, h: number): THREE.BufferGeometry | null {
  if (poly.length < 3) return null;
  try {
    // Shape (x, −planY) extruded along +Z, rotated −π/2 about X → world (x, depth, planY).
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.002, h), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  } catch {
    return null;
  }
}

export function buildArea(a: Area, cat: Catalog): THREE.Object3D | null {
  const color = cat.material(a.materialId)?.color ?? AREA_FALLBACK[a.kind] ?? '#999';
  const layer = AREA_LAYER[a.kind] ?? { y: 0.01, t: 0.01 };
  const elev = a.elevation ?? 0;
  const g = new THREE.Group();
  g.name = `area:${a.id}`;
  if (a.kind === 'deck') {
    const top = Math.max(elev, 0.1);
    const deck = extrudePolygon(a.polygon, top - 0.08, 0.08);
    const skirt = extrudePolygon(a.polygon, 0, Math.max(0.01, top - 0.08));
    if (deck) g.add(shadows(new THREE.Mesh(deck, std(color, { roughness: 0.75 }))));
    if (skirt) g.add(shadows(new THREE.Mesh(skirt, std(new THREE.Color(color).multiplyScalar(0.6)))));
  } else {
    const geo = extrudePolygon(a.polygon, elev + layer.y - layer.t, layer.t);
    if (!geo) return null;
    const mat = a.kind === 'water'
      ? std(color, { transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 })
      : std(color, { roughness: a.kind === 'patio' || a.kind === 'driveway' ? 0.8 : 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = !SOFT_AREAS.has(a.kind) && a.kind !== 'water' && layer.t > 0.03;
    g.add(mesh);
  }
  g.userData.areaId = a.id;
  return g;
}

// ---------- lines ----------

const FENCE_COLOR: Record<string, string> = { board: '#a77b52', picket: '#efebe2', metal: '#3a3d40', rail: '#9a7a55', stone: '#9c948a', block: '#9c948a', steel: '#4b4f52' };

function segmentFrame(a: Vec2, b: Vec2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return { L, ang, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2 };
}

function boxAt(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildLine(l: Line, cat: Catalog): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `line:${l.id}`;
  g.userData.lineId = l.id;
  const color = cat.material(l.materialId)?.color ?? FENCE_COLOR[l.style] ?? '#a77b52';
  const mat = std(color, { metalness: l.style === 'metal' || l.style === 'steel' ? 0.5 : 0, roughness: l.style === 'metal' ? 0.5 : 0.9 });
  const h = Math.max(0.05, l.height);
  for (let i = 0; i < l.points.length - 1; i++) {
    const { L, ang, mid } = segmentFrame(l.points[i], l.points[i + 1]);
    if (L < 0.01) continue;
    const seg = new THREE.Group();
    seg.position.set(mid[0], 0, mid[1]);
    seg.rotation.y = -ang;
    if (l.kind === 'retaining_wall') {
      seg.add(boxAt(L, h, Math.max(0.05, l.thickness), std(color), 0, h / 2, 0));
    } else if (l.kind === 'edging') {
      seg.add(boxAt(L, 0.1, Math.max(0.01, l.thickness || 0.01), mat, 0, 0.02, 0));
    } else {
      // posts every ≤ 2.4 m
      const n = Math.max(1, Math.ceil(L / 2.4));
      const postMat = l.style === 'picket' ? mat : std(new THREE.Color(color).multiplyScalar(0.8));
      for (let k = 0; k <= n; k++) seg.add(boxAt(0.09, h + 0.05, 0.09, postMat, -L / 2 + (L * k) / n, (h + 0.05) / 2, 0));
      if (l.style === 'board' || l.style === 'stone' || l.style === 'block' || l.style === 'steel') {
        seg.add(boxAt(L, h * 0.95, 0.03, mat, 0, h * 0.95 / 2 + 0.03, 0));
      } else if (l.style === 'picket') {
        for (const y of [h * 0.25, h * 0.75]) seg.add(boxAt(L, 0.06, 0.03, mat, 0, y, -0.03));
        const count = Math.max(1, Math.floor(L / 0.13));
        const pickets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, h * 0.9, 0.02), mat, count);
        const m4 = new THREE.Matrix4();
        for (let k = 0; k < count; k++) pickets.setMatrixAt(k, m4.makeTranslation(-L / 2 + (k + 0.5) * (L / count), h * 0.45 + 0.02, 0));
        seg.add(pickets);
      } else if (l.style === 'metal') {
        for (const y of [0.1, h - 0.03]) seg.add(boxAt(L, 0.03, 0.03, mat, 0, y, 0));
        const count = Math.max(1, Math.floor(L / 0.12));
        const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.015, h - 0.1, 0.015), mat, count);
        const m4 = new THREE.Matrix4();
        for (let k = 0; k < count; k++) bars.setMatrixAt(k, m4.makeTranslation(-L / 2 + (k + 0.5) * (L / count), h / 2 + 0.03, 0));
        seg.add(bars);
      } else {
        for (const y of [h * 0.3, h * 0.6, h * 0.9]) seg.add(boxAt(L, 0.08, 0.04, mat, 0, y, 0));
      }
    }
    g.add(seg);
  }
  if (l.kind === 'fence') {
    const gateMat = std(new THREE.Color(color).multiplyScalar(0.55));
    for (const gate of l.gates ?? []) {
      const a = l.points[gate.segment], b = l.points[gate.segment + 1];
      if (!a || !b) continue;
      const { L, ang } = segmentFrame(a, b);
      const t = Math.min(1, Math.max(0, (gate.offset + gate.width / 2) / (L || 1)));
      const m = boxAt(gate.width, h * 0.92, 0.06, gateMat, a[0] + (b[0] - a[0]) * t, h * 0.46 + 0.04, a[1] + (b[1] - a[1]) * t);
      m.rotation.y = -ang;
      g.add(m);
    }
  }
  return shadows(g);
}

// ---------- building ----------

export function buildBuilding(b: Building | null): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'building';
  if (!b) return g;
  const wallMat = std('#efe8dc', { roughness: 0.95 });
  for (const w of wallSegments(b)) {
    const { L, ang, mid } = segmentFrame(w.a, w.b);
    const m = boxAt(L + w.thickness, w.height, w.thickness, wallMat, mid[0], w.height / 2, mid[1]);
    m.rotation.y = -ang;
    g.add(m);
  }
  const objMat = std('#d4d6d2');
  for (const o of b.objects ?? []) {
    const t = o?.transform as number[] | undefined;
    const d = o?.dimensions as number[] | undefined;
    if (!t || !d || t.length < 16) continue;
    const m = boxAt(Math.max(0.02, d[0]), Math.max(0.02, d[1]), Math.max(0.02, d[2] ?? 0.1), objMat, t[12], t[13], t[14]);
    m.rotation.y = -Math.atan2(t[2], t[0]);
    g.add(m);
  }
  return shadows(g);
}

// ---------- site objects ----------

const WOOD = '#8a6b4a';

export function buildSiteObject(o: SiteObject, selected = false): THREE.Object3D {
  const g = new THREE.Group();
  const w = Math.max(0.05, o.width), d = Math.max(0.05, o.depth), h = Math.max(0.05, o.height);
  const wood = std(WOOD);
  const add = (m: THREE.Object3D) => { g.add(m); return m; };
  switch (o.catalogId) {
    case 'pergola': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(boxAt(0.12, h, 0.12, wood, sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06)));
      for (const sz of [-1, 1]) add(boxAt(w + 0.3, 0.18, 0.08, wood, 0, h - 0.09, sz * (d / 2 - 0.06)));
      const n = Math.max(2, Math.round(w / 0.4));
      for (let k = 0; k <= n; k++) add(boxAt(0.05, 0.14, d + 0.3, wood, -w / 2 + (w * k) / n, h + 0.04, 0));
      break;
    }
    case 'gazebo': {
      const posts = 6;
      for (let k = 0; k < posts; k++) {
        const a = (k / posts) * Math.PI * 2;
        add(boxAt(0.1, h * 0.7, 0.1, std('#f2efe8'), Math.cos(a) * (w / 2 - 0.1), h * 0.35, Math.sin(a) * (d / 2 - 0.1)));
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.58, h * 0.3, 6), std('#6d5a4c'));
      roof.position.y = h * 0.85;
      roof.scale.set(1, 1, d / Math.max(w, d) || 1);
      add(roof);
      add(boxAt(w * 0.95, 0.08, d * 0.95, std('#cbbfa8'), 0, 0.04, 0));
      break;
    }
    case 'shed': {
      const wallH = h * 0.75;
      add(boxAt(w, wallH, d, std('#a7a49b'), 0, wallH / 2, 0));
      const rise = h - wallH;
      const slope = Math.hypot(d / 2, rise);
      const theta = Math.atan2(rise, d / 2);
      for (const s of [-1, 1]) {
        const p = boxAt(w * 1.06, 0.05, slope * 1.08, std('#5b4a3f'), 0, wallH + rise / 2, (s * d) / 4);
        p.rotation.x = s * theta;
        add(p);
      }
      add(boxAt(0.9, 1.9, 0.03, std('#6f5a45'), 0, 0.95, d / 2 + 0.015));
      break;
    }
    case 'raised_bed':
    case 'raised_garden_bed':
    case 'planter_box': {
      const t = 0.05;
      for (const s of [-1, 1]) {
        add(boxAt(w, h, t, wood, 0, h / 2, s * (d / 2 - t / 2)));
        add(boxAt(t, h, d, wood, s * (w / 2 - t / 2), h / 2, 0));
      }
      add(boxAt(w - 2 * t, 0.02, d - 2 * t, std('#4a3626'), 0, h - 0.05, 0));
      break;
    }
    case 'outdoor_pot_large':
    case 'outdoor_pot_small': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, (w / 2) * 0.72, h, 20), std('#b5653b'));
      pot.position.y = h / 2;
      add(pot);
      const soil = new THREE.Mesh(new THREE.CircleGeometry(w / 2 * 0.92, 20), std('#4a3626'));
      soil.rotation.x = -Math.PI / 2;
      soil.position.y = h - 0.02;
      add(soil);
      break;
    }
    case 'boulder':
    case 'rock_large':
    case 'rock_small': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), std('#8d8a83', { flatShading: true }));
      rock.scale.set(w, h, d);
      rock.position.y = h * 0.42;
      add(rock);
      break;
    }
    case 'bench_outdoor': {
      const seatY = Math.min(0.45, h * 0.56);
      add(boxAt(w, 0.05, d * 0.8, wood, 0, seatY, 0.04 * d));
      add(boxAt(w, h - seatY - 0.05, 0.04, wood, 0, seatY + (h - seatY) / 2, -d / 2 + 0.03));
      for (const sx of [-1, 1]) add(boxAt(0.06, seatY, d * 0.7, std('#3a3d40', { metalness: 0.4 }), sx * (w / 2 - 0.1), seatY / 2, 0));
      break;
    }
    case 'pool_round': {
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 40), std('#4aa3c9', { roughness: 0.2, transparent: true, opacity: 0.85 }));
      pool.position.y = h / 2;
      add(pool);
      break;
    }
    case 'spot_light_outdoor': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 12), std('#1e293b', { metalness: 0.5, roughness: 0.4 }));
      c.position.y = h / 2;
      add(c);
      break;
    }
    default:
      add(boxAt(w, h, d, std('#b8b2a6'), 0, h / 2, 0));
  }
  if (selected) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.1, h + 0.1, d + 0.1)), new THREE.LineBasicMaterial({ color: ACCENT }));
    edges.position.y = h / 2;
    g.add(edges);
  }
  g.position.set(o.x, o.elevation ?? 0, o.y);
  g.rotation.y = -rad(o.rotation);
  g.userData.objectId = o.id;
  g.traverse((c) => { c.userData.objectId = o.id; });
  return shadows(g);
}

// ---------- plants ----------

type Crown = 'round' | 'oval' | 'columnar' | 'vase' | 'pyramidal' | 'spreading' | 'weeping' | 'mound' | 'upright' | 'fountain' | 'rosette' | 'fan';

const DEFAULT_CROWN: Record<string, Crown> = {
  tree: 'round', conifer: 'pyramidal', palm: 'fan', shrub: 'round', perennial: 'upright', grass: 'fountain', groundcover: 'mound', vine: 'upright', succulent: 'rosette'
};

const unitCache = new Map<string, THREE.BufferGeometry>();
function shared(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = unitCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; unitCache.set(key, g); }
  return g;
}

/** Unit crown geometry: base at y = 0, top at y = 1, diameter 1. */
export function crownGeometry(crown: string): THREE.BufferGeometry {
  return shared(`crown:${crown}`, () => {
    switch (crown as Crown) {
      case 'pyramidal': return new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0);
      case 'columnar': return new THREE.CapsuleGeometry(0.5, 1, 4, 12).scale(1, 0.5, 1).translate(0, 0.5, 0);
      case 'vase': return new THREE.LatheGeometry([[0.06, 0], [0.22, 0.25], [0.45, 0.65], [0.5, 0.82], [0.32, 0.97], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
      case 'weeping': return new THREE.LatheGeometry([[0.4, 0], [0.48, 0.3], [0.5, 0.65], [0.38, 0.92], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
      case 'mound': return new THREE.SphereGeometry(0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
      case 'upright': return new THREE.CylinderGeometry(0.42, 0.3, 1, 9).translate(0, 0.5, 0);
      case 'fountain': return new THREE.ConeGeometry(0.5, 1, 12, 1, true).rotateX(Math.PI).translate(0, 0.5, 0);
      case 'rosette': {
        const parts: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 9; k++) {
          const c = new THREE.ConeGeometry(0.07, 0.6, 5).translate(0, 0.3, 0).rotateZ(k === 8 ? 0 : 0.95).rotateY((k / 8) * Math.PI * 2);
          parts.push(c.toNonIndexed());
        }
        const m = mergeGeometries(parts)!;
        m.computeBoundingBox();
        const bb = m.boundingBox!;
        const s = 1 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        return m.scale(s, 1 / (bb.max.y - bb.min.y), s).translate(0, -bb.min.y / (bb.max.y - bb.min.y), 0);
      }
      case 'fan': {
        const parts: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 8; k++) parts.push(new THREE.BoxGeometry(0.5, 0.03, 0.12).translate(0.25, 0, 0).rotateZ(-0.35).rotateY((k / 8) * Math.PI * 2).translate(0, 0.6, 0).toNonIndexed());
        parts.push(new THREE.SphereGeometry(0.08, 8, 6).translate(0, 0.62, 0).toNonIndexed());
        return mergeGeometries(parts)!;
      }
      case 'spreading':
      case 'oval':
      case 'round':
      default: return new THREE.IcosahedronGeometry(0.5, 2).translate(0, 0.5, 0);
    }
  });
}

const trunkGeo = () => shared('trunk', () => new THREE.CylinderGeometry(0.35, 0.5, 1, 8).translate(0, 0.5, 0));
const bloomGeo = () => shared('bloom', () => new THREE.IcosahedronGeometry(0.5, 1));
const ringGeo = () => shared('ring', () => new THREE.RingGeometry(0.96, 1, 48).rotateX(-Math.PI / 2));

/** Where the crown starts (fraction of height) and how tall it is, by form/crown. */
function crownSpan(form: string, crown: string): { base: number; frac: number; widthK: number } {
  const widthK = crown === 'columnar' ? 0.75 : crown === 'spreading' ? 1.1 : 1;
  switch (form) {
    case 'tree': return { base: crown === 'weeping' ? 0.15 : 0.32, frac: crown === 'weeping' ? 0.85 : 0.68, widthK };
    case 'conifer': return { base: 0.06, frac: 0.94, widthK };
    case 'palm': return { base: 0.7, frac: 0.35, widthK };
    default: return { base: 0, frac: 1, widthK };
  }
}

interface PlantVisual { key: string; form: string; crown: string; variant: '' | 'bare' | 'remove' }

function visualFor(inst: PlantInstance, plant: Plant | undefined, leafOff: boolean): PlantVisual {
  let form: string, crown: string;
  if (plant) {
    form = plant.form;
    crown = plant.representation?.crown ?? DEFAULT_CROWN[plant.form] ?? 'round';
  } else {
    const c = inst.fallback?.category ?? '';
    form = c.startsWith('tree') ? 'tree' : 'shrub';
    crown = c.includes('pine') || c.includes('cone') ? 'pyramidal' : form === 'tree' ? 'round' : 'mound';
  }
  const variant = inst.status === 'remove' ? 'remove' : leafOff ? 'bare' : '';
  return { key: `${form}:${crown}:${variant}`, form, crown, variant };
}

export interface PlantBuild {
  group: THREE.Group;
  /** Meshes whose instances are plants: instance index → plant id. */
  pickables: THREE.InstancedMesh[];
}

/**
 * All plants as instanced meshes: one foliage mesh per form/crown/variant, one trunk mesh and one
 * bloom mesh, plus ghost rings (mature canopy) and selection rings.
 */
export function buildPlants(p: Project, cat: Catalog, opts: { selected: Set<string>; ghost: boolean }): PlantBuild {
  const group = new THREE.Group();
  group.name = 'plants';
  const month = p.scenario.month, year = p.scenario.year;
  const accent = new THREE.Color(ACCENT);
  const removeTint = new THREE.Color('#c0574a');

  type Item = { inst: PlantInstance; m: THREE.Matrix4; color: THREE.Color };
  const foliage = new Map<string, { vis: PlantVisual; items: Item[] }>();
  const trunks: Item[] = [];
  const blooms: Item[] = [];
  const ghosts: THREE.Matrix4[] = [];
  const rings: THREE.Matrix4[] = [];

  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const inst of p.plants) {
    const plant = cat.plant(inst.plantId);
    const size = sizeAt(inst, plant, year);
    const r = rng((inst.seed ?? 1) >>> 0);
    const rot = r() * Math.PI * 2;
    const jit = 0.92 + r() * 0.16;
    const look = plant ? seasonLook(plant, month, p.site.frost) : null;
    const vis = visualFor(inst, plant, !!look?.leafOff);
    const span = crownSpan(vis.form, vis.crown);
    let h = Math.max(0.05, size.height * jit);
    let w = Math.max(0.05, size.spread * jit * span.widthK);
    if (look?.dormant) { h *= 0.35; w *= 0.8; }
    const sel = opts.selected.has(inst.id);
    q.setFromAxisAngle(up, rot);

    // foliage
    let color = new THREE.Color(look ? look.foliage : '#9aa39a');
    if (look?.bloom && (vis.form === 'tree' || vis.form === 'conifer')) color.lerp(new THREE.Color(look.bloom), 0.45);
    if (vis.variant === 'remove') color = color.lerp(removeTint, 0.6);
    if (sel) color.lerp(accent, 0.55);
    const crownH = h * span.frac;
    const crownW = vis.variant === 'bare' ? w * 0.85 : w;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(inst.x, h * span.base, inst.y), q, new THREE.Vector3(crownW, crownH, crownW));
    const bucket = foliage.get(vis.key) ?? foliage.set(vis.key, { vis, items: [] }).get(vis.key)!;
    bucket.items.push({ inst, m, color });

    // trunk
    if (vis.form === 'tree' || vis.form === 'conifer' || vis.form === 'palm') {
      const th = vis.form === 'palm' ? h * 0.78 : h * Math.max(0.3, span.base + 0.15);
      const td = Math.max(0.06, Math.min(0.6, size.spread * (vis.form === 'palm' ? 0.04 : 0.055)));
      const tc = new THREE.Color(vis.form === 'palm' ? '#8b7656' : '#5e4a3a');
      if (sel) tc.lerp(accent, 0.4);
      trunks.push({ inst, m: new THREE.Matrix4().compose(new THREE.Vector3(inst.x, 0, inst.y), q, new THREE.Vector3(td, th, td)), color: tc });
    }

    // bloom cap for non-trees
    if (look?.bloom && vis.form !== 'tree' && vis.form !== 'conifer' && vis.form !== 'palm') {
      const bw = w * 0.85, bh = Math.max(0.04, h * 0.28);
      blooms.push({ inst, m: new THREE.Matrix4().compose(new THREE.Vector3(inst.x, h * 0.86, inst.y), q, new THREE.Vector3(bw, bh, bw)), color: new THREE.Color(look.bloom) });
    }

    if (opts.ghost && plant) {
      const mr = matureRadius(plant);
      ghosts.push(new THREE.Matrix4().compose(new THREE.Vector3(inst.x, 0.035, inst.y), new THREE.Quaternion(), new THREE.Vector3(mr, 1, mr)));
    }
    if (sel) rings.push(new THREE.Matrix4().compose(new THREE.Vector3(inst.x, 0.04, inst.y), new THREE.Quaternion(), new THREE.Vector3(Math.max(0.15, size.spread / 2 + 0.08), 1, Math.max(0.15, size.spread / 2 + 0.08))));
  }

  const pickables: THREE.InstancedMesh[] = [];
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], name: string, pick = true) => {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.name = name;
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.color); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (pick) { mesh.userData.plantIds = items.map((it) => it.inst.id); pickables.push(mesh); }
    group.add(mesh);
    return mesh;
  };

  for (const { vis, items } of foliage.values()) {
    const mat = vis.variant === 'bare'
      ? new THREE.MeshStandardMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.45, roughness: 1 })
      : vis.variant === 'remove'
        ? new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 0.9, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, side: THREE.DoubleSide, flatShading: vis.crown === 'rosette' || vis.crown === 'fan' || vis.crown === 'pyramidal' });
    const mesh = instanced(crownGeometry(vis.crown), mat, items, `foliage:${vis.key}`);
    if (vis.variant === 'bare') mesh.castShadow = false;
  }
  if (trunks.length) instanced(trunkGeo(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), trunks, 'trunks');
  if (blooms.length) instanced(bloomGeo(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), blooms, 'blooms');

  const ringMesh = (mats: THREE.Matrix4[], color: string, opacity: number, name: string) => {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(ringGeo(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }), mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  ringMesh(ghosts, '#2f6b4f', 0.45, 'ghost-rings');
  ringMesh(rings, ACCENT, 0.95, 'selection-rings');
  return { group, pickables };
}

// ---------- bounds ----------

/** Plan bounding box of everything on the site (metres), with a sensible default. */
export function siteBounds(p: Project): { min: Vec2; max: Vec2 } {
  const pts: Vec2[] = [];
  if (p.site.boundary) pts.push(...p.site.boundary);
  for (const a of p.areas) pts.push(...a.polygon);
  for (const l of p.lines) pts.push(...l.points);
  for (const i of p.plants) pts.push([i.x, i.y]);
  for (const o of p.objects) pts.push([o.x, o.y]);
  for (const w of wallSegments(p.building)) pts.push(w.a, w.b);
  if (!pts.length) return { min: [-10, -10], max: [10, 10] };
  const b = bbox(pts);
  if (b.max[0] - b.min[0] < 4) { b.min[0] -= 2; b.max[0] += 2; }
  if (b.max[1] - b.min[1] < 4) { b.min[1] -= 2; b.max[1] += 2; }
  return b;
}
