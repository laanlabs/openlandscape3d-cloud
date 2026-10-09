import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '../src/lib/catalog/catalog';
import { fromOpenPlan, normalizeProject, toOpenPlan } from '../src/lib/io/openplan';
import { sanitizeProject, takeSanitizeReport } from '../src/lib/io/validate';
import { runChecks } from '../src/lib/analysis/checks';
import { SAMPLES, buildSample } from '../src/lib/site/samples';
import { WEB_SCHEMA, clone, type Project } from '../src/lib/model/types';
import { area, cat, plant, project, square } from './helpers';

const FIX = join(__dirname, 'fixtures');
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));

/** The planner can work with it: checks run, it exports, and the export imports again. */
function opens(p: Project) {
  expect(p.schema).toBe(WEB_SCHEMA);
  for (const k of ['areas', 'lines', 'plants', 'groups', 'objects', 'observations', 'alternatives', 'overrides'] as const) expect(Array.isArray(p[k])).toBe(true);
  expect(typeof p.id).toBe('string');
  expect(typeof p.name).toBe('string');
  expect(typeof p.createdAt).toBe('string');
  expect(typeof p.updatedAt).toBe('string');
  expect(() => runChecks(p, cat)).not.toThrow();
  expect(() => runChecks(p, catalog)).not.toThrow();
  let j: any;
  expect(() => { j = toOpenPlan(p, cat); }).not.toThrow();
  expect(() => toOpenPlan(p, cat, { forLink: true })).not.toThrow();
  expect(() => fromOpenPlan(JSON.parse(JSON.stringify(j)), cat)).not.toThrow();
}

const NaNish = [Number.NaN, Infinity, '3', null];

describe('sanitizeProject: hostile input', () => {
  it('opens anything at all', () => {
    for (const raw of [undefined, null, 42, 'project', [], [1, 2], {}, { schema: WEB_SCHEMA }]) {
      const { project: p } = sanitizeProject(raw);
      opens(p);
      expect(p.web.units).toBe('metric');
    }
  });

  it('replaces non-list collections and records them', () => {
    const { project: p, dropped, count } = sanitizeProject({ plants: 'acer-rubrum', areas: 5, lines: { a: 1 }, groups: true, objects: 'x', observations: 1, alternatives: 'no', overrides: {} });
    expect(p.plants).toEqual([]);
    expect(p.areas).toEqual([]);
    expect(p.lines).toEqual([]);
    expect(dropped).toContain('plants was not a list');
    expect(count).toBe(8);
    opens(p);
  });

  it('coerces id, name and timestamps to strings', () => {
    const { project: p } = sanitizeProject({ id: 123, name: 456, createdAt: 0, updatedAt: { t: 1 } });
    expect(p.id).toBe('123');
    expect(p.name).toBe('456');
    expect(p.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(typeof p.updatedAt).toBe('string');
    expect(Number.isFinite(Date.parse(p.updatedAt))).toBe(true);
    const fresh = sanitizeProject({ id: null }).project;
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('drops entries with bad ids, NaN coordinates and too few points', () => {
    const good = plant('acer-rubrum', 4, 5);
    // Not through project(): that normalizes (and so sanitizes) already.
    const raw = {
      ...project(),
      plants: [good, ...NaNish.map((v) => plant('acer-rubrum', v as number, 1)), { ...plant('ilex-glabra', 1, 1), id: 7 } as any, 'plant' as any, null as any],
      areas: [area('bed', square(0, 0, 4, 4)), area('patio', [[0, 0]]), area('lawn', [[0, 0], [1, Number.NaN], [2, 2]]), area('bed', 'square' as any)],
      lines: [
        { id: 'l1', kind: 'fence', style: 'board', points: [[0, 0], [5, 0]], height: 1.8, thickness: 0.1, gates: [{ id: 'g1', segment: 0, offset: 1, width: 1 }, { id: 'g2', segment: Number.NaN, offset: 1, width: 1 }] },
        { id: 'l2', kind: 'fence', style: 'board', points: [[0, 0]], height: 1.8, thickness: 0.1, gates: [] },
        { id: 'l3', kind: 'fence', style: 'board', points: [[0, 0], [5, 0]], height: 1.8, thickness: 0.1, gates: 'none' as any }
      ],
      objects: [{ id: 'o1', catalogId: 'bench_outdoor', x: Number.NaN, y: 0, rotation: 0, width: 1, depth: 1, height: 1, elevation: 0, status: 'proposed' }],
      observations: [{ id: 'n1', kind: 'note', createdAt: '2027-01-01', author: 'me', x: Infinity, y: 0 }, { id: 'n2', kind: 'note', createdAt: '2027-01-01', author: 'me' }]
    };
    takeSanitizeReport();
    const { project: p, dropped, count } = sanitizeProject(raw);
    expect(p.plants.map((i) => i.id)).toEqual([good.id]);
    expect(p.areas).toHaveLength(1);
    expect(p.lines.map((l) => l.id)).toEqual(['l1', 'l3']);
    expect(p.lines[0].gates.map((g) => g.id)).toEqual(['g1']);
    expect(p.lines[1].gates).toEqual([]);
    expect(p.objects).toEqual([]);
    expect(p.observations.map((o) => o.id)).toEqual(['n2']);
    expect(dropped).toEqual(expect.arrayContaining([
      '4 plants with invalid positions',
      '1 plant without a valid id',
      '2 plants that could not be read',
      '1 area with too few points',
      '2 areas with invalid positions',
      '1 fence or wall with too few points',
      '1 gate with invalid positions',
      'gates was not a list',
      '1 site object with invalid positions',
      '1 field note with invalid positions'
    ]));
    expect(count).toBe(4 + 1 + 2 + 1 + 2 + 1 + 1 + 1 + 1 + 1);
    expect(takeSanitizeReport()).toEqual({ dropped, count });
    expect(takeSanitizeReport()).toEqual({ dropped: [], count: 0 });
    opens(p);
  });

  it('clamps the scenario and units', () => {
    for (const [month, want] of [[0, 1], [13, 12], [-4, 1], [6.4, 6], [Number.NaN, 6], ['7', 6]] as const) {
      const p = normalizeProject({ scenario: { month, year: 3, hour: 12 } as any });
      expect(p.scenario.month).toBe(want);
    }
    const p = normalizeProject({ scenario: { month: 6, year: -2, hour: 99 }, web: { units: 'furlongs' as any } });
    expect(p.scenario).toEqual({ month: 6, year: 0, hour: 24 });
    expect(p.web.units).toBe('metric');
    expect(normalizeProject({ scenario: { month: 6, year: 2, hour: -1 } }).scenario.hour).toBe(0);
    expect(normalizeProject({ web: { units: 'imperial' } }).web.units).toBe('imperial');
    expect(normalizeProject({ scenario: 'summer' as any }).scenario).toEqual({ month: 6, year: 5, hour: 14 });
  });

  it('repairs site, groups, alternatives, overrides and building shapes', () => {
    const { project: p, dropped } = sanitizeProject({
      site: { regionId: 9, hardiness: 'six', north: 'up', boundary: [[0, 0], [1, 1]], terrain: { kind: 'points', points: [[0, 0, 0], [1, Number.NaN, 2]] }, location: { lat: 'x', lon: 1 } },
      groups: [
        { id: 'g1', kind: 'mass', mix: 'acer', spacing: Number.NaN, polygon: square(0, 0, 3, 3), seed: 1, instanceIds: 'all' },
        { id: 'g2', kind: 'row', mix: [], spacing: 1, path: [[0, 0]], seed: 1, instanceIds: [] }
      ],
      alternatives: [
        { id: 'alt1', name: 'Plan B', createdAt: '2027-01-01', snapshot: { plants: [plant('acer-rubrum', Number.NaN, 0)], groups: [], areas: 'x', lines: [], objects: [] } },
        { id: 'alt2', name: 'Broken', createdAt: '2027-01-01', snapshot: 'gone' }
      ],
      overrides: [{ ruleId: 'OL-SUN', subjectId: 'p1', note: 'ok' }, { ruleId: 5, subjectId: 'p2', note: '' }, { ruleId: 'OL-BLOOMGAP', note: 3 }],
      building: { walls: 'w', doors: [], defaults: 1, objects: 7 },
      verification: 'yes',
      extra: [1]
    });
    expect(p.site.regionId).toBe('us-northeast');
    expect(typeof p.site.hardiness.zone).toBe('string');
    expect(p.site.north).toEqual([0, -1]);
    expect(p.site.boundary).toBeUndefined();
    expect(p.site.location).toBeUndefined();
    expect(p.site.terrain).toEqual({ kind: 'points', points: [[0, 0, 0]] });
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]).toMatchObject({ mix: [], spacing: 0.6, instanceIds: [] });
    expect(p.alternatives.map((a) => a.id)).toEqual(['alt1']);
    expect(p.alternatives[0].snapshot.plants).toEqual([]);
    expect(p.alternatives[0].snapshot.areas).toEqual([]);
    expect(p.overrides).toEqual([{ ruleId: 'OL-SUN', subjectId: 'p1', note: 'ok' }, { ruleId: 'OL-BLOOMGAP', note: '3' }]);
    expect(p.building).toMatchObject({ walls: [], doors: [], defaults: {}, objects: [] });
    expect(p.verification).toEqual({ boundary: false, measurements: {} });
    expect(p.extra).toEqual({});
    expect(dropped).toEqual(expect.arrayContaining(['the property boundary had invalid points', '1 plant group with too few points', '1 plant with invalid positions in alternative “Plan B”', 'areas was not a list in alternative “Plan B”', '1 alternative that could not be read', '1 check override without a valid id']));
    opens(p);
  });

  it('survives a hostile web project through fromOpenPlan (the file/link import path)', () => {
    const raw = { schema: WEB_SCHEMA, id: 1, updatedAt: 5, plants: 'many', areas: [{ id: 'a', kind: 'bed', polygon: [[0, 0]] }], scenario: { month: 0, year: 1, hour: 3 }, web: { units: 'cubits' } };
    const p = fromOpenPlan(raw as any, cat);
    expect(takeSanitizeReport().count).toBe(2);
    expect(p.scenario.month).toBe(1);
    opens(p);
    // And through the iOS-style block.
    const block = fromOpenPlan({ walls: [], objects: [], openlandscape3d: { schema: 'openlandscape3d/project@0.1', producer: 'ios', projectId: 9, plants: [{ id: 'p', plantId: 'acer-rubrum', x: 'a', y: 1 }], lines: 'none', scenario: { month: 13, year: 1, hour: 1 } } }, cat);
    expect(takeSanitizeReport().count).toBe(2);
    expect(block.id).toBe('9');
    expect(block.scenario.month).toBe(12);
    opens(block);
  });
});

describe('sanitizeProject: valid projects are untouched', () => {
  it('round-trips every sample garden unchanged', () => {
    for (const s of SAMPLES) {
      const p = buildSample(s.id, catalog)!;
      const before = clone(p);
      const { project: out, dropped, count } = sanitizeProject(p);
      expect(dropped).toEqual([]);
      expect(count).toBe(0);
      expect(out).toEqual(before);
      // Unchanged collections are the same arrays (copy on write).
      expect(out.plants).toBe(p.plants);
      expect(out.areas).toBe(p.areas);
      expect(normalizeProject(clone(p))).toEqual(before);
      expect(toOpenPlan(out, catalog)).toEqual(toOpenPlan(before, catalog));
    }
  });

  it('is a no-op on the parity fixtures (web sources and iOS files)', () => {
    for (const f of readdirSync(join(FIX, 'web-source'))) {
      const p = json(join(FIX, 'web-source', f));
      const { project: out, dropped } = sanitizeProject(normalizeProject(clone(p)));
      expect(dropped, f).toEqual([]);
      expect(out, f).toEqual(normalizeProject(clone(p)));
    }
    for (const f of readdirSync(join(FIX, 'ios')).filter((f) => f.endsWith('.openplan3d.json'))) {
      const p = fromOpenPlan(json(join(FIX, 'ios', f)), catalog);
      expect(takeSanitizeReport().dropped, f).toEqual([]);
      expect(sanitizeProject(p).project, f).toEqual(p);
    }
  });
});
