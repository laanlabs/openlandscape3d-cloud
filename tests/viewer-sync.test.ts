// The 3D viewer's plant fast path (src/lib/scene/plantSlots.ts) checked against real buildPlants output:
// when only positions change, instances move in place instead of every instanced mesh being rebuilt.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPlants } from '../src/lib/scene/build';
import { indexSlots, movePlants, samePlantExceptPosition, sameSet } from '../src/lib/scene/plantSlots';
import type { PlantInstance } from '../src/lib/model/types';
import { cat, plant, project } from './helpers';

const translation = (mesh: THREE.InstancedMesh, i: number) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return [m.elements[12], m.elements[13], m.elements[14]];
};

const maple = plant('acer-rubrum', 2, 3);
const inkberry = plant('ilex-glabra', 5, 1);
const coneflower = plant('echinacea-purpurea', 7, 6);
const unknown = plant('mystery', 9, 9, { fallback: { category: 'tree_oak', width: 3, height: 5, depth: 3 } });
const p = project({ scenario: { month: 7, year: 5, hour: 12 }, plants: [maple, inkberry, coneflower, unknown] });
const selected = new Set([inkberry.id]);
const build = () => {
  const built = buildPlants(p, cat, { selected, ghost: true });
  return { built, slots: indexSlots(built.group, p, cat, selected)! };
};

describe('plant slot index', () => {
  it('finds every instance of every plant, rings included, and each sits at its plant', () => {
    const { slots } = build();
    expect(slots).not.toBeNull();
    const names = (i: PlantInstance) => slots.get(i.id)!.map((s) => s.mesh.name).sort();
    expect(names(maple)).toEqual(expect.arrayContaining(['trunks', 'ghost-rings']));
    expect(names(maple).some((n) => n.startsWith('foliage:tree:'))).toBe(true);
    expect(names(inkberry)).toEqual(expect.arrayContaining(['ghost-rings', 'selection-rings']));
    expect(names(coneflower)).toContain('blooms'); // July: in flower
    expect(names(unknown)).toContain('trunks'); // fallback tree
    expect(names(unknown)).not.toContain('ghost-rings'); // no catalog entry → no mature radius
    expect(names(maple)).not.toContain('selection-rings');
    for (const inst of p.plants)
      for (const s of slots.get(inst.id)!) {
        const [x, , z] = translation(s.mesh, s.index);
        expect(x, `${inst.plantId} ${s.mesh.name}`).toBeCloseTo(inst.x, 9);
        expect(z, `${inst.plantId} ${s.mesh.name}`).toBeCloseTo(inst.y, 9);
      }
  });
  it('covers every instanced mesh the build produced', () => {
    const { built, slots } = build();
    const seen = new Set([...slots.values()].flat().map((s) => s.mesh));
    const meshes = built.group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh);
    expect(meshes.length).toBeGreaterThanOrEqual(5);
    expect(seen.size).toBe(meshes.length);
  });
  it('switches off (null) when the ring order cannot be trusted', () => {
    const { built } = build();
    const other = project({ scenario: p.scenario, plants: [...p.plants, plant('ilex-glabra', 1, 1)] });
    expect(indexSlots(built.group, other, cat, selected)).toBeNull();
    expect(indexSlots(built.group, p, cat, new Set())).toBeNull(); // one selection ring exists, none expected
  });
});

describe('movePlants', () => {
  it('moves only the changed instances in place, keeping height, and flags the buffers', () => {
    const { slots } = build();
    const next = p.plants.map((x) => (x.id === maple.id ? { ...x, x: x.x + 10, y: x.y - 4 } : x));
    const before = new Map(p.plants.flatMap((i) => slots.get(i.id)!.map((s) => [s, translation(s.mesh, s.index)] as const)));
    const versions = new Map([...slots.values()].flat().map((s) => [s.mesh, s.mesh.instanceMatrix.version]));
    expect(movePlants(slots, p.plants, next)).toBe(true);
    for (const s of slots.get(maple.id)!) {
      const [x, y, z] = translation(s.mesh, s.index);
      expect(x).toBeCloseTo(12, 9);
      expect(z).toBeCloseTo(-1, 9);
      expect(y).toBe(before.get(s)![1]);
      expect(s.mesh.instanceMatrix.version).toBeGreaterThan(versions.get(s.mesh)!);
      expect(s.mesh.boundingSphere!.containsPoint(new THREE.Vector3(12, y, -1))).toBe(true);
    }
    for (const inst of [inkberry, coneflower, unknown])
      for (const s of slots.get(inst.id)!) expect(translation(s.mesh, s.index)).toEqual(before.get(s));
  });
  it('is a no-op for identical arrays and refuses anything but a position change', () => {
    const { slots } = build();
    expect(movePlants(slots, p.plants, [...p.plants])).toBe(true);
    expect(movePlants(slots, p.plants, p.plants.map((x) => (x.id === maple.id ? { ...x, status: 'remove' as const } : x)))).toBe(false);
    expect(movePlants(slots, p.plants, p.plants.map((x) => (x.id === maple.id ? { ...x, note: 'moved' } : x)))).toBe(false);
    expect(movePlants(slots, p.plants, p.plants.slice(1))).toBe(false);
    expect(movePlants(slots, p.plants, [...p.plants, plant('ilex-glabra', 0, 0)])).toBe(false);
    expect(movePlants(null, p.plants, p.plants.map((x) => ({ ...x, x: x.x + 1 })))).toBe(false);
  });
  it('helpers', () => {
    expect(samePlantExceptPosition(maple, { ...maple, x: 99, y: -3 })).toBe(true);
    expect(samePlantExceptPosition(maple, { ...maple, plantedYear: 1 })).toBe(false);
    expect(samePlantExceptPosition(maple, { ...maple, groupId: 'g' })).toBe(false);
    expect(sameSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameSet(new Set(), new Set())).toBe(true);
  });
});
