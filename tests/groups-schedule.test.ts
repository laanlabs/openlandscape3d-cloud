import { describe, expect, it } from 'vitest';
import { gridPoints, massPoints, mixCounts, resolveGroup, rowPoints } from '../src/lib/analysis/groups';
import { plantSchedule, plantingYear, taskSchedule } from '../src/lib/analysis/schedule';
import { PLANT_COLUMNS, TASK_COLUMNS, plantScheduleCsv, taskScheduleCsv, cell } from '../src/lib/io/csv';
import { pointInPolygon } from '../src/lib/model/geometry';
import type { PlantGroup } from '../src/lib/model/types';
import { cat, plant, project, square } from './helpers';

const poly = square(0, 0, 6, 4);
const mass = (seed: number): PlantGroup => ({ id: '00000000-0000-4000-8000-00000000g001', kind: 'mass', mix: [{ plantId: 'echinacea-purpurea', ratio: 2 }, { plantId: 'schizachyrium-scoparium', ratio: 1 }], spacing: 0.5, polygon: poly, seed, instanceIds: [] });

describe('group resolution', () => {
  it('is deterministic: same seed → same instances', () => {
    const a = resolveGroup(mass(7), cat), b = resolveGroup(mass(7), cat);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    const c = resolveGroup(mass(8), cat);
    expect(c.map((i) => [i.x, i.y])).not.toEqual(a.map((i) => [i.x, i.y]));
  });
  it('keeps mass points inside the polygon and apart', () => {
    const pts = massPoints(poly, 0.5, 3);
    for (const p of pts) expect(pointInPolygon(p, poly)).toBe(true);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThanOrEqual(0.425 - 1e-9);
  });
  it('splits the mix exactly by ratio', () => {
    expect(mixCounts([{ plantId: 'a', ratio: 2 }, { plantId: 'b', ratio: 1 }], 10)).toEqual([7, 3]);
    expect(mixCounts([{ plantId: 'a', ratio: 1 }, { plantId: 'b', ratio: 1 }, { plantId: 'c', ratio: 1 }], 4)).toEqual([2, 1, 1]);
    const r = resolveGroup(mass(7), cat);
    const n = r.filter((i) => i.plantId === 'echinacea-purpurea').length;
    expect(n).toBe(mixCounts(mass(7).mix, r.length)[0]);
  });
  it('rows space plants evenly along the path', () => {
    const pts = rowPoints([[0, 0], [10, 0]], 1.2);
    expect(pts).toHaveLength(8);
    expect(pts[0][0]).toBeCloseTo(0.625);
    expect(pts[1][0] - pts[0][0]).toBeCloseTo(1.25);
    const hedge = resolveGroup({ id: '00000000-0000-4000-8000-00000000g002', kind: 'row', mix: [{ plantId: 'ilex-glabra', ratio: 2 }, { plantId: 'pinus-strobus', ratio: 1 }], spacing: 1, path: [[0, 0], [6, 0]], seed: 1, instanceIds: [] }, cat);
    expect(hedge.map((i) => i.plantId[0])).toEqual(['i', 'i', 'p', 'i', 'i', 'p']);
    expect(hedge.every((i) => i.groupId === '00000000-0000-4000-8000-00000000g002')).toBe(true);
  });
  it('grids on a square lattice centred in the bounding box', () => {
    const pts = gridPoints(square(0, 0, 2.1, 1.1), 0.5);
    expect(pts.length).toBe(5 * 3 - 0); // 0.05…2.05 by 0.05…1.05, all strictly inside
    expect(new Set(resolveGroup({ id: 'g3', kind: 'grid', mix: [{ plantId: 'phlox-subulata', ratio: 1 }], spacing: 0.5, polygon: square(0, 0, 2.1, 1.1), seed: 1, instanceIds: [] }, cat).map((i) => i.id)).size).toBe(15);
  });
  it('gives instances stable UUID ids and install sizes from the catalog', () => {
    const [first] = resolveGroup(mass(7), cat);
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(['#1', 'plug']).toContain(first.installSize);
  });
});

describe('plant schedule', () => {
  const p = project({
    plants: [
      plant('echinacea-purpurea', 0, 0), plant('echinacea-purpurea', 1, 0), plant('echinacea-purpurea', 2, 0, { installSize: 'plug' }),
      plant('acer-rubrum', 5, 5), plant('ilex-glabra', 3, 3), plant('acer-rubrum', 9, 9, { status: 'existing' }), plant('mystery', 1, 1)
    ]
  });
  it('one row per plantId + installSize for proposed plants, sorted by form then name', () => {
    const rows = plantSchedule(p, cat);
    expect(rows.map((r) => [r.code, r.install_size, r.quantity])).toEqual([
      ['ACRU', 'BB-2in', 1], ['ILGL', '#3', 1], ['ECPU', '#1', 2], ['ECPU', 'plug', 1], ['MY', '#1', 1]
    ]);
    expect(rows[0].native).toBe(true);
    expect(rows[0].mature_height_m).toBe(15);
    expect(rows[4].common_name).toBe('Unknown plant');
  });
  it('de-duplicates codes with a numeric suffix', () => {
    const q = project({ plants: [plant('echinacea-purpurea', 0, 0)] });
    const c2 = { ...cat.plant('echinacea-purpurea')!, id: 'echinacea-pallida-x', scientificName: 'Echinacea pumila' };
    const cat2 = new (cat.constructor as any)({ catalogVersion: 'x', plants: [...cat.plants, c2], regions: cat.regions, materials: cat.materials, rules: cat.rules });
    q.plants.push(plant('echinacea-pallida-x', 1, 1));
    expect(plantSchedule(q, cat2).map((r) => r.code)).toEqual(['ECPU', 'ECPU2']);
  });
  it('writes the exact CSV columns', () => {
    const csv = plantScheduleCsv(p, cat);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('code,scientific_name,common_name,quantity,install_size,spacing_m,mature_height_m,mature_spread_m,native,notes');
    expect(PLANT_COLUMNS.join(',')).toBe(lines[0]);
    expect(lines[1]).toBe('ACRU,Acer rubrum,Red maple,1,BB-2in,9,15,10.5,yes,"draft data, unreviewed"');
    expect(cell('a,"b"')).toBe('"a,""b"""');
  });
  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(cell('=1+1')).toBe("'=1+1");
    expect(cell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(cell('-1')).toBe("'-1");
    expect(cell('@cmd')).toBe("'@cmd");
    expect(cell('\t=x')).toBe("'\t=x");
    expect(cell('=a,b')).toBe('"\'=a,b"'); // prefix first, then RFC 4180 quoting
    expect(cell('Red maple')).toBe('Red maple');
    expect(cell('#1')).toBe('#1');
    expect(cell(-3)).toBe('-3'); // numbers are formatted first and never prefixed
    expect(cell(true)).toBe('yes');
  });
});

describe('task schedule', () => {
  const p = project({ plants: [plant('ilex-glabra', 0, 0), plant('ilex-glabra', 2, 0), plant('echinacea-purpurea', 0, 3), plant('acer-rubrum', 9, 9, { status: 'existing' })] });
  it('dates each matching rule window from the site frost dates in the planting year', () => {
    expect(plantingYear(p)).toBe(2027);
    const rows = taskSchedule(p, cat);
    const shrub = rows.filter((r) => r.ruleId === 'plant-container-shrub');
    expect(shrub.map((r) => [r.start, r.end, r.alternate, r.quantity])).toEqual([
      ['2027-04-25', '2027-06-09', false, 2],
      ['2027-08-31', '2027-10-01', true, 2]
    ]);
    // existing maple gets nothing; herbaceous coneflower gets the cut-back rule; shrubs don't
    expect(rows.some((r) => r.plantId === 'acer-rubrum')).toBe(false);
    expect(rows.filter((r) => r.ruleId === 'cut-back-herbaceous').map((r) => r.plantId)).toEqual(['echinacea-purpurea']);
    expect(rows.filter((r) => r.ruleId === 'soil-test').map((r) => r.start)).toEqual(['2027-02-24', '2027-02-24']);
    const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start));
    expect(rows.map((r) => r.start)).toEqual(sorted.map((r) => r.start));
  });
  it('honours web.plantingYear and writes the exact CSV columns', () => {
    const q = { ...p, web: { ...p.web, plantingYear: 2030 } };
    expect(taskSchedule(q, cat)[0].start.startsWith('2030')).toBe(true);
    const lines = taskScheduleCsv(p, cat).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(TASK_COLUMNS.join(','));
    expect(lines[0]).toBe('task,plant,scientific_name,quantity,start,end,recurrence,source,confidence');
    expect(lines.some((l) => l.startsWith('Plant container shrubs (alternate window),Inkberry,Ilex glabra,2,2027-08-31,2027-10-01,once,ol-editorial,medium'))).toBe(true);
  });
});
