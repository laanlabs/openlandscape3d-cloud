// Hi-res render plant models (src/lib/render/plantModels.ts): deterministic, inside their unit
// envelope, and drawn from the same seeded placement as the editor (scene/build.ts).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ASPECTS, VARIANTS, archetypeFor, aspectClass, plantModel, type Archetype } from '../src/lib/render/plantModels';

const ARCHES: Archetype[] = ['tree-round', 'tree-oval', 'tree-spreading', 'tree-vase', 'tree-weeping', 'tree-columnar', 'tree-pyramidal',
  'conifer', 'conifer-columnar', 'palm', 'shrub', 'shrub-upright', 'perennial', 'grass', 'groundcover', 'succulent'];

function box(g?: THREE.BufferGeometry) {
  if (!g) return null;
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('render plant models', () => {
  it('every catalog form and crown maps to an archetype', () => {
    for (const form of ['tree', 'conifer', 'palm', 'shrub', 'perennial', 'vine', 'grass', 'groundcover', 'succulent'])
      for (const crown of ['round', 'oval', 'columnar', 'vase', 'pyramidal', 'spreading', 'weeping', 'mound', 'upright', 'fountain', 'rosette', 'fan'])
        expect(ARCHES).toContain(archetypeFor(form, crown));
  });

  it('is deterministic for an archetype, variant and aspect', () => {
    for (const a of ARCHES) {
      const m = plantModel(a, 1, 2);
      const again = plantModel(a, 1, 2);
      expect(again).toBe(m); // cached
      const fresh = (plantModel as unknown as (a: Archetype, v: number, s: number) => typeof m)(a, 1, 2);
      expect(fresh.leaves?.getAttribute('position').count ?? 0).toBe(m.leaves?.getAttribute('position').count ?? 0);
    }
  });

  it('variants differ, so neighbouring plants are not clones', () => {
    for (const a of ARCHES) {
      const p0 = plantModel(a, 0, 2), p1 = plantModel(a, 1, 2);
      const g0 = p0.leaves ?? p0.solid!, g1 = p1.leaves ?? p1.solid!;
      expect(Array.from(g0.getAttribute('position').array), a).not.toEqual(Array.from(g1.getAttribute('position').array));
    }
  });

  it('stays inside the unit envelope (height ≈ 1, spread ≈ 1) for every variant and aspect', () => {
    for (const a of ARCHES) for (let v = 0; v < VARIANTS; v++) for (let s = 0; s < ASPECTS.length; s++) {
      const m = plantModel(a, v, s);
      for (const g of [m.wood, m.leaves, m.solid, m.flowers]) {
        const b = box(g);
        if (!b) continue;
        // Cards are pre-stretched by 1 ÷ aspect in unit space (flat plants), so allow their half-height.
        expect(b.max.y, `${a} max y @ ${ASPECTS[s]}`).toBeLessThan(1.05 + 0.17 / ASPECTS[s]);
        expect(b.min.y, `${a} min y @ ${ASPECTS[s]}`).toBeGreaterThan(-0.05 - 0.17 / ASPECTS[s]);
        expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z), `${a} radius`).toBeLessThan(0.75);
      }
    }
  });

  it('palm fronds sit on top of the trunk', () => {
    const m = plantModel('palm', 0, 2);
    const trunk = box(m.wood)!, fronds = box(m.leaves)!;
    expect(fronds.min.y).toBeGreaterThan(trunk.max.y - 0.25);
    expect(fronds.max.y).toBeLessThan(1.1);
  });

  it('aspect classes pick the nearest height ÷ spread ratio', () => {
    expect(ASPECTS[aspectClass(10, 10)]).toBe(1.2);
    expect(ASPECTS[aspectClass(12, 3)]).toBe(4);
    expect(ASPECTS[aspectClass(0.3, 0.6)]).toBe(0.5);
  });
});
