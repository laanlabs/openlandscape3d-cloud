// Web ⇄ iOS parity. Shared fixtures (EXPORT_FORMAT.md "Parity"):
//   tests/fixtures/web-source/*.project.json   web projects built below (deterministic ids)
//   tests/fixtures/web/*.openplan3d.json       what this app exports for them (iOS imports these)
//   tests/fixtures/web/*.expected.json         plants, group summary, areas and sorted check results
//   tests/fixtures/ios/*.openplan3d.json       written by openlandscape3d-ios (+ *.expected.json); consumed here
//   tests/fixtures/ios/roundtrip-<slug>.openplan3d.json   web fixture after a trip through iOS
// Fixtures use the shipped catalog (src/lib/catalog, same data iOS bundles) and say so in their expected
// file ("catalog": "shipped"; "test-fixture" would mean tests/fixtures/catalog). Regenerate after a
// catalog or model change with:  OL3D_WRITE_FIXTURES=1 npx vitest run tests/interop.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, installDims, type Catalog } from '../src/lib/catalog/catalog';
import { fromOpenPlan, normalizeProject, toOpenPlan } from '../src/lib/io/openplan';
import { decodePayload, encodePayload, transferJson } from '../src/lib/io/transfer';
import { RULE_IDS, checkKeys, runChecks } from '../src/lib/analysis/checks';
import { mixSpacing, resolveGroup } from '../src/lib/analysis/groups';
import { houseBuilding } from '../src/lib/site/templates';
import { defaultSite } from '../src/lib/site/regions';
import { stableId, type Area, type AreaKind, type Line, type PlantGroup, type PlantInstance, type Project, type SiteObject, type Status, type Vec2 } from '../src/lib/model/types';

const DIR = join(__dirname, 'fixtures');
const WRITE = !!process.env.OL3D_WRITE_FIXTURES;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Same shape as openlandscape3d-ios InteropTests (tests/fixtures/ios/README.md). */
export interface Expected {
  name: string;
  catalogVersion: string;
  /** Which catalog computed `checks`: the shipped one (both apps bundle it) or tests/fixtures/catalog. */
  catalog?: 'shipped' | 'test-fixture';
  plants: { id: string; plantId: string; status: string; x: number; y: number; groupId?: string }[];
  groups: { id: string; kind: string; instanceIds: string[] }[];
  areas: { id: string; kind: string }[];
  checks: { ruleId: string; subjectIds: string[] }[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function summarize(p: Project, cat: Catalog = catalog): Expected {
  return {
    name: p.name,
    catalogVersion: cat.version,
    catalog: cat === catalog ? 'shipped' : 'test-fixture',
    plants: p.plants.map((i) => ({ id: i.id, plantId: i.plantId, status: i.status, x: r3(i.x), y: r3(i.y), ...(i.groupId ? { groupId: i.groupId } : {}) })).sort(byId),
    groups: p.groups.map((g) => ({ id: g.id, kind: g.kind, instanceIds: [...g.instanceIds].sort() })).sort(byId),
    areas: p.areas.map((a) => ({ id: a.id, kind: a.kind })).sort(byId),
    checks: checkKeys(runChecks(p, cat))
  };
}

// ---------- deterministic fixture builder ----------

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function builder(tag: string, name: string, regionId: string, zone: string, units: 'metric' | 'imperial') {
  let n = 0;
  const id = () => stableId(`openlandscape3d-fixture:${tag}:${++n}`);
  const site = defaultSite(regionId, catalog);
  site.hardiness = { system: 'USDA', zone };
  const p = normalizeProject({
    id: id(), name, createdAt: '2027-01-15T00:00:00.000Z', updatedAt: '2027-01-15T00:00:00.000Z', catalogVersion: catalog.version,
    captureSource: 'manual', site, scenario: { month: 6, year: 5, hour: 14 }, web: { units, plantingYear: 2027, layers: {}, ghostRings: false }
  });
  const api = {
    p,
    id,
    house(x0: number, y0: number, x1: number, y1: number, doorSide: 'top' | 'bottom') {
      const b = houseBuilding(x0, y0, x1, y1, { doorSide });
      const map = new Map<string, string>();
      for (const w of b.walls) { const nid = id(); map.set(w.identifier, nid); w.identifier = nid; }
      for (const o of [...b.doors, ...b.windows]) { o.identifier = id(); o.parentIdentifier = map.get(o.parentIdentifier); }
      p.building = b;
    },
    area(kind: AreaKind, polygon: Vec2[], extra: Partial<Area> = {}) {
      const a: Area = { id: id(), kind, name: `${kind} ${p.areas.length + 1}`, materialId: catalog.materialsFor(kind)[0]?.id, polygon, elevation: 0, ...extra };
      p.areas.push(a);
      return a;
    },
    plant(plantId: string, x: number, y: number, extra: Partial<PlantInstance> = {}) {
      const pl = catalog.plant(plantId);
      if (!pl) throw new Error(`fixture plant ${plantId} is not in the catalog`);
      const d = installDims(pl);
      const i: PlantInstance = { id: id(), plantId, x, y, status: 'proposed', plantedYear: 0, installSize: d.code, installHeight: d.heightM, installSpread: d.spreadM, seed: n * 101, ...extra };
      p.plants.push(i);
      return i;
    },
    group(kind: PlantGroup['kind'], plantIds: string[], geom: Vec2[], seed: number, status: Status = 'proposed') {
      for (const x of plantIds) if (!catalog.plant(x)) throw new Error(`fixture plant ${x} is not in the catalog`);
      const mix = plantIds.map((plantId, k) => ({ plantId, ratio: k === 0 ? 2 : 1 }));
      const g: PlantGroup = { id: id(), kind, mix, spacing: mixSpacing(mix, catalog), ...(kind === 'row' ? { path: geom } : { polygon: geom }), seed, instanceIds: [] };
      const inst = resolveGroup(g, catalog, { status });
      g.instanceIds = inst.map((i) => i.id);
      p.groups.push(g);
      p.plants.push(...inst);
      return g;
    },
    line(kind: Line['kind'], style: Line['style'], points: Vec2[], gates: { segment: number; offset: number; width: number }[] = []) {
      const l: Line = { id: id(), kind, style, points, height: kind === 'fence' ? 1.8 : kind === 'retaining_wall' ? 0.6 : 0.1, thickness: kind === 'retaining_wall' ? 0.3 : 0.1, gates: gates.map((g) => ({ id: id(), ...g })), materialId: catalog.materialsFor(kind)[0]?.id };
      p.lines.push(l);
      return l;
    },
    object(catalogId: string, x: number, y: number, w: number, d: number, h: number, rotation = 0, status: Status = 'proposed') {
      const o: SiteObject = { id: id(), catalogId, x, y, rotation, width: w, depth: d, height: h, elevation: 0, status };
      p.objects.push(o);
      return o;
    }
  };
  return api;
}

function northeast(): Project {
  const b = builder('ne', 'Web northeast back yard', 'us-northeast', '6b', 'imperial');
  const p = b.p;
  p.site.boundary = rect(0, 0, 20, 30);
  p.verification.boundary = true;
  b.house(3, 2, 17, 12, 'bottom');
  b.area('patio', rect(6, 12, 12.5, 16));
  b.area('lawn', rect(1.2, 16, 19, 26.5));
  const border = b.area('bed', rect(1.2, 27, 19, 29.5), { sun: 'part' });
  b.area('bed', rect(0.4, 13, 1.1, 26.5), { name: 'Side hedge' });
  b.line('fence', 'board', [[0, 12], [0, 30], [20, 30], [20, 12]], [{ segment: 0, offset: 0.6, width: 1 }]);
  b.line('edging', 'steel', [[1.2, 26.8], [19, 26.8]]);
  b.plant('acer-rubrum', 15.5, 21.5);
  const old = b.plant('acer-saccharum', 4, 20, { status: 'existing', plantedYear: -25, installSize: 'existing', measuredHeight: 14, measuredSpread: 11, condition: 'good' });
  b.group('row', ['ilex-glabra'], [[0.75, 13.6], [0.75, 26]], 3);
  b.group('mass', ['aquilegia-canadensis', 'schizachyrium-scoparium', 'phlox-subulata'], border.polygon, 5);
  b.object('pergola', 9.25, 14, 3, 3, 2.5);
  b.object('raised_bed', 17, 18, 1.8, 0.9, 0.4, 90);
  // Overlap between the existing maple and the new one is accepted with a note (override → info).
  p.overrides.push({ ruleId: 'OL-OVERLAP', subjectId: old.id, note: 'Old maple comes out in year 3' });
  p.observations.push({ id: b.id(), kind: 'issue', createdAt: '2027-01-10T00:00:00.000Z', author: 'web', x: 2, y: 28, text: 'Standing water after rain' });
  p.alternatives.push({ id: b.id(), name: 'Option A — no pergola', createdAt: '2027-01-15T00:00:00.000Z', snapshot: { plants: p.plants.slice(0, 3), groups: [], areas: p.areas.slice(0, 2), lines: [], objects: [] } });
  p.web = { ...p.web, layers: { labels: false }, ghostRings: true };
  return p;
}

function southeast(): Project {
  const b = builder('se', 'Web southeast front yard', 'us-southeast', '8a', 'metric');
  const p = b.p;
  p.site.boundary = rect(0, 0, 20, 20);
  b.house(4, 10, 16, 18, 'top');
  b.area('driveway', rect(16.6, 0, 19.6, 18));
  b.area('path', rect(9.4, 0, 10.6, 10));
  const bedL = b.area('bed', rect(4, 7.6, 9.2, 10));
  b.area('bed', rect(10.8, 7.6, 16, 10));
  b.area('lawn', rect(0.4, 0.4, 16.2, 7.4));
  b.plant('cercis-canadensis', 3.5, 3.5);
  b.plant('sabal-palmetto', 14, 3);
  b.group('row', ['callicarpa-americana'], [[11.2, 9.2], [15.6, 9.2]], 6);
  b.group('mass', ['coreopsis-lanceolata', 'muhlenbergia-capillaris'], bedL.polygon, 8);
  b.group('grid', ['phlox-subulata'], rect(0.6, 7.5, 3.8, 9.8), 9);
  b.line('fence', 'picket', [[0, 0], [9.2, 0]]);
  b.object('outdoor_pot_large', 8.8, 10.4, 0.4, 0.4, 0.35);
  return p;
}

function southwest(): Project {
  const b = builder('sw', 'Web southwest dry garden', 'us-southwest', '9a', 'metric');
  const p = b.p;
  p.site.boundary = rect(0, 0, 15, 20);
  p.site.moisture = 'dry';
  p.site.soil = 'sand';
  p.site.location = { lat: 33.45, lon: -112.07, precision: 'precise' };
  const gravel = b.area('gravel', rect(0.5, 0.5, 14.5, 9));
  b.area('patio', rect(2, 10, 8, 14));
  b.area('water', rect(9, 11, 13.5, 15));
  b.plant('chilopsis-linearis', 12, 18);
  b.group('mass', ['agave-parryi', 'nassella-tenuissima', 'baileya-multiradiata'], gravel.polygon, 11);
  b.group('row', ['dasylirion-wheeleri'], [[0.8, 10], [0.8, 19]], 12);
  b.group('grid', ['bouteloua-gracilis'], rect(2, 15, 8, 19), 13);
  b.line('retaining_wall', 'stone', [[0, 9.5], [8.5, 9.5]]);
  b.object('boulder', 6, 5, 1.5, 1.2, 1, 20);
  b.object('bench_outdoor', 5, 13, 1.5, 0.5, 0.8, 180);
  return p;
}

/** Deliberately triggers every OL-* rule. */
function allRules(): Project {
  const b = builder('rules', 'Web all rules', 'us-northeast', '5a', 'metric');
  const p = b.p;
  p.site.boundary = rect(0, 0, 20, 20); // unverified → OL-UNVERIFIED
  b.house(2, 2, 10, 8, 'bottom');
  b.area('patio', rect(12, 2, 18, 6));
  const shade = b.area('bed', rect(1, 12, 6, 18), { sun: 'shade' });
  const wet = b.area('bed', rect(12, 12, 18, 18), { moisture: 'wet' });
  b.plant('berberis-thunbergii', 15, 9);         // OL-INVASIVE (US-CT invasive)
  b.plant('abelia-grandiflora', 8, 16);          // OL-HARDY (zone 6–9 at zone 5a)
  b.plant('ilex-glabra', 15, 4);                 // OL-ONHARD (in the patio)
  b.plant('schizachyrium-scoparium', 3, 15);     // OL-SUN (full sun only, in the shade bed)
  b.plant('agastache-rupestris', 15, 15);        // OL-WATER (dry only, in the wet bed)
  b.plant('acer-rubrum', 6, 9.5);                // OL-CLEARANCE (1.5 m from the house)
  b.plant('acer-rubrum', 7.5, 10.5);             // OL-OVERLAP with the one above
  b.plant('ilex-glabra', 23, 10);                // OL-OUTSIDE
  b.object('shed', 10, -3, 2, 2.5, 2.3);         // OL-OUTSIDE (object)
  void shade; void wet;
  // Nine proposed plants and no bloom in some of Apr–Oct → OL-BLOOMGAP
  return p;
}

const builders = [northeast, southeast, southwest, allRules];
const slug = (p: Project) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const json = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

describe('web fixtures for iOS', () => {
  for (const make of builders) {
    const p = make();
    const s = slug(p);
    it(`${s}: exported file re-imports to the same plants, groups, areas and checks`, () => {
      const file = toOpenPlan(p, catalog, { embedWebProject: false });
      const back = fromOpenPlan(JSON.parse(JSON.stringify(file)), catalog);
      expect(summarize(back)).toEqual(summarize(p));
      expect(back.web).toEqual(p.web);
    });
    it(`${s}: committed fixtures are current`, () => {
      const files = {
        [join(DIR, 'web-source', `${s}.project.json`)]: json(p),
        [join(DIR, 'web', `${s}.openplan3d.json`)]: json(toOpenPlan(p, catalog, { embedWebProject: false })),
        [join(DIR, 'web', `${s}.expected.json`)]: json(summarize(p))
      };
      for (const [path, text] of Object.entries(files)) {
        if (WRITE || !existsSync(path)) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); }
        else expect(readFileSync(path, 'utf8'), `${path} is stale — rerun with OL3D_WRITE_FIXTURES=1`).toBe(text);
      }
    });
  }

  it('the all-rules fixture triggers every OL-* rule', () => {
    const ids = new Set(runChecks(allRules(), catalog).map((r) => r.ruleId));
    expect([...ids].sort()).toEqual([...RULE_IDS].sort());
  });

  it('one fixture per pilot region', () => {
    expect(new Set(builders.map((b) => b().site.regionId))).toEqual(new Set(['us-northeast', 'us-southeast', 'us-southwest']));
  });

  it('the override in the northeast fixture downgrades its finding to info', () => {
    const r = runChecks(northeast(), catalog).filter((x) => x.ruleId === 'OL-OVERLAP' && x.overridden);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.severity === 'info')).toBe(true);
  });

  it('web fixtures survive the transfer link codec', async () => {
    for (const make of builders) {
      const p = make();
      const back = fromOpenPlan((await decodePayload(await encodePayload(transferJson(p, catalog)))) as Record<string, unknown>, catalog);
      expect(summarize(back)).toEqual(summarize(p));
    }
  });
});

// ---------- iOS fixtures consumed here ----------

const IOS = join(DIR, 'ios');
const iosFiles = existsSync(IOS) ? readdirSync(IOS).filter((f) => f.endsWith('.openplan3d.json') && !f.startsWith('roundtrip-')) : [];

describe('iOS exports open in the web planner', () => {
  if (!iosFiles.length) it.skip('no iOS fixtures yet (openlandscape3d-ios writes tests/fixtures/ios/*.openplan3d.json)', () => {});
  for (const f of iosFiles) {
    it(`${f}: same plants, groups, areas and checks as iOS`, () => {
      const j = JSON.parse(readFileSync(join(IOS, f), 'utf8'));
      const expectedPath = join(IOS, f.replace('.openplan3d.json', '.expected.json'));
      const p = fromOpenPlan(j, catalog);
      expect(p.plants.length).toBe(j.openlandscape3d?.plants?.length ?? 0);
      if (!existsSync(expectedPath)) return;
      const expected: Expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
      const got = summarize(p);
      expect(got.plants).toEqual(expected.plants);
      expect(got.groups).toEqual(expected.groups);
      expect(got.areas).toEqual(expected.areas);
      // Same catalog as iOS used (recorded in the expected file), same results in the same contract order
      // (ruleId, first subject, then the whole subject list).
      expect(expected.catalog ?? 'shipped', 'iOS fixtures are computed with the shipped catalog').toBe('shipped');
      expect(expected.catalogVersion).toBe(catalog.version);
      expect(checkKeys(runChecks(p, catalog))).toEqual(expected.checks);
      // Re-export keeps everything iOS wrote, including keys this app doesn't model.
      const again = toOpenPlan(p, catalog, { embedWebProject: false }).openlandscape3d;
      for (const k of Object.keys(j.openlandscape3d ?? {})) if (!['producer', 'updatedAt', 'webProject', 'building'].includes(k)) expect(again[k], k).toMatchObject(j.openlandscape3d[k]);
    });
  }
});

describe('iOS transfer link payload', () => {
  const file = join(IOS, 'payload.txt');
  if (!existsSync(file)) it.skip('no payload.txt from iOS yet', () => {});
  else it('decodes a payload produced by iOS (Apple COMPRESSION_ZLIB = raw deflate)', async () => {
    const [payload] = readFileSync(file, 'utf8').trim().split('\n');
    const j = (await decodePayload(payload.replace(/^.*\/v1\//, ''))) as Record<string, any>;
    expect(j.openplanHandoffVersion).toBe(1);
    expect(j.openlandscape3d.producer).toBe('ios');
    expect(j.openlandscape3d.webProject).toBeUndefined();
    const p = fromOpenPlan(j, catalog);
    expect(p.plants.length).toBe(j.openlandscape3d.plants.length);
  });
});

describe('web → iOS → web keeps web-only data', () => {
  const trips = existsSync(IOS) ? readdirSync(IOS).filter((f) => f.startsWith('roundtrip-') && f.endsWith('.openplan3d.json')) : [];
  if (!trips.length) it.skip('no round-trip fixtures from iOS yet', () => {});
  for (const f of trips) {
    it(f, () => {
      const src = join(DIR, 'web-source', f.replace('roundtrip-', '').replace('.openplan3d.json', '.project.json'));
      if (!existsSync(src)) return;
      const original: Project = JSON.parse(readFileSync(src, 'utf8'));
      const back = fromOpenPlan(JSON.parse(readFileSync(join(IOS, f), 'utf8')), catalog);
      expect(back.id).toBe(original.id);
      expect(back.web).toEqual(original.web);
      expect(summarize(back).plants).toEqual(summarize(original).plants);
      expect(summarize(back).groups).toEqual(summarize(original).groups);
      expect(summarize(back).areas).toEqual(summarize(original).areas);
      expect(back.alternatives.map((a) => a.id)).toEqual(original.alternatives.map((a) => a.id));
      expect(back.overrides).toEqual(original.overrides);
    });
  }
});
