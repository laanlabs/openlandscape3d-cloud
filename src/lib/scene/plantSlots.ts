// Fast path for the 3D viewer: when an edit changed only plant positions (a live drag, a nudge,
// undoing a move) the instanced meshes from buildPlants are updated in place instead of disposed and
// rebuilt. Plain functions (no DOM, no renderer) so they can be tested against real buildPlants output.
import * as THREE from 'three';
import type { Catalog } from '../catalog/catalog';
import type { PlantInstance, Project } from '../model/types';

export type Slot = { mesh: THREE.InstancedMesh; index: number };
/** Plant id → every instance slot that carries it (foliage, trunk, bloom, ghost ring, selection ring). */
export type PlantSlots = Map<string, Slot[]>;

export const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Shallow equality of every field but x and y — what a move produces (`{ ...plant, x, y }`). */
export function samePlantExceptPosition(a: PlantInstance, b: PlantInstance): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  return ka.every((k) => k === 'x' || k === 'y' || ra[k] === rb[k]);
}

/**
 * Maps plant ids to the instanced-mesh slots buildPlants made for them. Pickable meshes carry
 * `userData.plantIds`; the ring meshes do not, but buildPlants adds one ghost ring per plant with a
 * catalog entry and one selection ring per selected plant, in plant order. A count mismatch means
 * that assumption no longer holds, and the result is null (fast path off) rather than a wrong ring.
 */
export function indexSlots(group: THREE.Object3D, p: Project, cat: Catalog, selected: Set<string>): PlantSlots | null {
  const map: PlantSlots = new Map();
  const ghostIds = p.plants.filter((i) => cat.plant(i.plantId)).map((i) => i.id);
  const ringIds = p.plants.filter((i) => selected.has(i.id)).map((i) => i.id);
  for (const o of group.children) {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) continue;
    const ids = (mesh.userData.plantIds as string[] | undefined) ?? (mesh.name === 'ghost-rings' ? ghostIds : mesh.name === 'selection-rings' ? ringIds : null);
    if (!ids || ids.length !== mesh.count) return null;
    ids.forEach((id, index) => (map.get(id) ?? map.set(id, []).get(id)!).push({ mesh, index }));
  }
  return map;
}

const m4 = new THREE.Matrix4();

/**
 * True when `next` differs from `prev` only in plant positions — and then moves those instances in
 * place (translation column of each matrix; the height stays), flags the buffers and recomputes the
 * bounding spheres so frustum culling and picking stay right. False means: rebuild.
 */
export function movePlants(slots: PlantSlots | null, prev: PlantInstance[], next: PlantInstance[]): boolean {
  if (!slots || prev.length !== next.length) return false;
  const moved: PlantInstance[] = [];
  for (let i = 0; i < next.length; i++) {
    if (prev[i] === next[i]) continue;
    if (!samePlantExceptPosition(prev[i], next[i])) return false;
    moved.push(next[i]);
  }
  const touched = new Set<THREE.InstancedMesh>();
  for (const inst of moved) {
    for (const { mesh, index } of slots.get(inst.id) ?? []) {
      mesh.getMatrixAt(index, m4);
      m4.elements[12] = inst.x; // plan x → world X
      m4.elements[14] = inst.y; // plan y → world Z
      mesh.setMatrixAt(index, m4);
      touched.add(mesh);
    }
  }
  for (const mesh of touched) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  return true;
}
