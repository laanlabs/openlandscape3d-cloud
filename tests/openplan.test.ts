// Feeds this app's exporter output through OpenPlan3D's real importer (validateRoomPlan +
// createProjectFromRoomPlan from the sibling ../../openPlan3D checkout). vite.config.ts runs this
// file as the `openplan` vitest project with OpenPlan3D's $lib aliases; it is skipped when the
// checkout (with node_modules) is missing. Override the location with OPENPLAN3D_DIR.
import { describe, expect, it } from 'vitest';
// @ts-ignore — resolved through the openplan project's $lib alias, not this repo's tsconfig
import { isRoomPlanJson, validateRoomPlan } from '$lib/utils/roomplanValidation';
// @ts-ignore
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { fromOpenPlan, toOpenPlan } from '../src/lib/io/openplan';
import { houseBuilding, newProject } from '../src/lib/site/templates';
import { cat, plant, project, area, square } from './helpers';

function importIntoOpenPlan(data: any) {
  expect(isRoomPlanJson(data)).toBe(true);
  expect(() => validateRoomPlan(data)).not.toThrow();
  const op = createProjectFromRoomPlan(data, data.openlandscape3d?.name ?? 'Imported') as any;
  return op.floors.find((f: any) => f.level === 0) ?? op.floors[0];
}

describe('OpenLandscape3D exports import into OpenPlan3D', () => {
  it('plants, fences, gates, patios, pools and site objects arrive with the right catalog ids and sizes', () => {
    const p = newProject({ name: 'Back garden', units: 'metric', regionId: 'us-northeast', template: 'backyard' }, cat);
    p.plants.push(plant('pinus-strobus', 17, 24), plant('echinacea-purpurea', 18, 28), plant('agave-parryi', 2, 28));
    p.lines.push({ id: '00000000-0000-4000-8000-0000000000c1', kind: 'retaining_wall', style: 'block', points: [[2, 20], [8, 20], [8, 23]], height: 0.6, thickness: 0.3, gates: [] });
    p.lines.push({ id: '00000000-0000-4000-8000-0000000000c3', kind: 'fence', style: 'picket', points: [[3, 1], [6, 1]], height: 1, thickness: 0.1, gates: [] });
    p.areas.push(area('water', square(14, 17, 18, 19)), area('deck', [[13, 13], [16, 13.5], [15.5, 15.8], [12.6, 15.2]]));
    p.objects.push({ id: '00000000-0000-4000-8000-0000000000e1', catalogId: 'raised_bed', x: 4, y: 18, rotation: 30, width: 1.8, depth: 0.9, height: 0.4, elevation: 0, status: 'proposed' });
    const data = JSON.parse(JSON.stringify(toOpenPlan(p, cat, { embedWebProject: false })));
    const floor = importIntoOpenPlan(data);

    expect(floor.walls).toHaveLength(data.walls.length);
    expect(floor.doors).toHaveLength(data.doors.length);
    expect(floor.windows).toHaveLength(data.windows.length);
    expect(floor.furniture).toHaveLength(data.objects.length);
    const byId = new Map(floor.furniture.map((f: any) => [f.id, f]));
    for (const o of data.objects) {
      const f: any = byId.get(o.identifier);
      expect(f, o.identifier).toBeTruthy();
      const cat = Object.keys(o.category)[0];
      if (cat === 'retaining_wall') expect([f.catalogId, f.sourceCategory]).toEqual(['imported_object', 'retaining_wall']);
      else expect(f.catalogId, `${cat} keeps its catalog id`).toBe(cat);
      expect(f.width).toBeCloseTo(o.dimensions[0] * 100, 1);
      expect(f.height).toBeCloseTo(o.dimensions[1] * 100, 1);
      expect(f.depth).toBeCloseTo(o.dimensions[2] * 100, 1);
      expect(f.position.x).toBeCloseTo(o.transform[12] * 100, 1);
      expect(f.position.y).toBeCloseTo(o.transform[14] * 100, 1);
    }
    const ids = (kind: string) => data.objects.filter((o: any) => o.attributes.openlandscape3dKind === kind).map((o: any) => (byId.get(o.identifier) as any).catalogId);
    expect(ids('plant')).toEqual(expect.arrayContaining(['tree_default', 'bush_large', 'tree_pine', 'flower_red', 'cactus_short']));
    expect(new Set(ids('fence'))).toEqual(new Set(['fence_planks', 'picket_fence']));
    expect(ids('gate')).toEqual(['fence_gate']);
    expect(new Set(ids('area'))).toEqual(new Set(['deck_patio', 'pool_rectangular']));
    expect(ids('object')).toEqual(expect.arrayContaining(['bench_outdoor', 'outdoor_pot_large', 'raised_bed']));
    // Rotated items keep their heading (OpenPlan3D rotation = atan2(t[2], t[0]) in degrees).
    const bed: any = byId.get('00000000-0000-4000-8000-0000000000e1');
    expect(bed.rotation).toBeCloseTo(30, 6);
    // Group instances each arrive as their own item.
    for (const g of p.groups) for (const id of g.instanceIds) expect(byId.has(id)).toBe(true);
    expect(floor.rooms.map((r: any) => r.name)).toContain('House');
  });

  it('a wall-less landscape still imports', () => {
    const p = project({ plants: [plant('acer-rubrum', 3, 3), plant('ilex-glabra', 6, 3)], areas: [area('patio', square(0, 0, 4, 3))] });
    const data = JSON.parse(JSON.stringify(toOpenPlan(p, cat)));
    expect(data.walls).toEqual([]);
    const floor = importIntoOpenPlan(data);
    expect(floor.furniture.map((f: any) => f.catalogId).sort()).toEqual(['bush_large', 'deck_patio', 'tree_default']);
  });

  it('OpenPlan3D building → OpenLandscape3D → OpenPlan3D keeps walls, doors and windows identical', () => {
    const building = houseBuilding(2, 3, 14, 11, { doorSide: 'bottom', name: 'Main house' });
    const original = { openplanPrepared: true, openplanHandoffVersion: 1, version: 2, ...building, objects: [] };
    const before = importIntoOpenPlan(JSON.parse(JSON.stringify(original)));
    const site = fromOpenPlan(JSON.parse(JSON.stringify(original)), cat);
    site.plants.push(plant('acer-rubrum', 8, 20));
    const exported = JSON.parse(JSON.stringify(toOpenPlan(site, cat)));
    for (const k of ['walls', 'doors', 'windows', 'openings', 'sections'] as const) expect(exported[k]).toEqual((original as any)[k]);
    const after = importIntoOpenPlan(exported);
    const strip = (xs: any[]) => xs.map(({ id, ...r }: any) => ({ id, ...r })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    expect(strip(after.walls)).toEqual(strip(before.walls));
    expect(strip(after.doors)).toEqual(strip(before.doors));
    expect(strip(after.windows)).toEqual(strip(before.windows));
    expect(after.rooms.map((r: any) => r.name)).toEqual(before.rooms.map((r: any) => r.name));
    expect(after.furniture.map((f: any) => f.catalogId)).toEqual(['tree_default']);
  });
});
