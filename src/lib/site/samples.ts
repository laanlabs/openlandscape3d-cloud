// Sample gardens: complete, believable residential designs, one per pilot region, built in code
// from catalog ids so they stay valid (and tiny in the bundle) as the catalog grows. Every id is
// derived from the sample id, so a sample always builds identically. Opening a sample makes a
// fresh copy with a new project id; the sample itself never changes.
import { catalog as defaultCatalog, installDims, type Catalog } from '../catalog/catalog';
import { mixSpacing, resolveGroup } from '../analysis/groups';
import { normalizeProject } from '../io/openplan';
import { clone, snapshotOf, stableId, uid, type Area, type AreaKind, type Line, type PlantGroup, type PlantInstance, type Project, type SiteObject, type Status, type Vec2 } from '../model/types';
import { defaultSite } from './regions';
import { houseBuilding } from './templates';

export interface SampleInfo {
  id: string;
  name: string;
  regionId: string;
  blurb: string;
  description: string;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Deterministic site builder: every id comes from the sample id and a counter. */
function builder(sampleId: string, info: SampleInfo, zone: string, units: 'metric' | 'imperial', cat: Catalog) {
  let n = 0;
  const id = () => stableId(`openlandscape3d-sample:${sampleId}:${++n}`);
  const site = defaultSite(info.regionId, cat);
  site.hardiness = { system: 'USDA', zone };
  const p = normalizeProject({
    id: id(), name: info.name, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', catalogVersion: cat.version,
    captureSource: 'template', site, scenario: { month: 6, year: 5, hour: 15 },
    web: { units, plantingYear: 2027, layers: {}, ghostRings: false }
  });
  const need = (plantId: string) => {
    const pl = cat.plant(plantId);
    if (!pl) throw new Error(`sample ${sampleId}: plant ${plantId} is not in the catalog`);
    return pl;
  };
  return {
    p,
    id,
    house(x0: number, y0: number, x1: number, y1: number, doorSide: 'top' | 'bottom', name = 'House') {
      const b = houseBuilding(x0, y0, x1, y1, { doorSide, name });
      const map = new Map<string, string>();
      for (const w of b.walls) { const nid = id(); map.set(w.identifier, nid); w.identifier = nid; }
      for (const o of [...b.doors, ...b.windows]) { o.identifier = id(); o.parentIdentifier = map.get(o.parentIdentifier); }
      p.building = b;
    },
    area(kind: AreaKind, name: string, polygon: Vec2[], extra: Partial<Area> = {}) {
      const a: Area = { id: id(), kind, name, materialId: cat.materialsFor(kind)[0]?.id, polygon, elevation: kind === 'deck' ? 0.45 : 0, ...extra };
      p.areas.push(a);
      return a;
    },
    plant(plantId: string, x: number, y: number, extra: Partial<PlantInstance> = {}) {
      const d = installDims(need(plantId));
      const i: PlantInstance = { id: id(), plantId, x, y, status: 'proposed', plantedYear: 0, installSize: d.code, installHeight: d.heightM, installSpread: d.spreadM, seed: n * 7919, ...extra };
      p.plants.push(i);
      return i;
    },
    /** A hedge/row (`geom` = path) or drift/grid (`geom` = polygon). `ratios` default to 1. */
    group(kind: PlantGroup['kind'], plantIds: string[], geom: Vec2[], seed: number, opts: { spacing?: number; ratios?: number[]; status?: Status } = {}) {
      plantIds.forEach(need);
      const mix = plantIds.map((plantId, k) => ({ plantId, ratio: opts.ratios?.[k] ?? 1 }));
      const g: PlantGroup = { id: id(), kind, mix, spacing: opts.spacing ?? mixSpacing(mix, cat), ...(kind === 'row' ? { path: geom } : { polygon: geom }), seed, instanceIds: [] };
      const inst = resolveGroup(g, cat, { status: opts.status });
      g.instanceIds = inst.map((i) => i.id);
      p.groups.push(g);
      p.plants.push(...inst);
      return g;
    },
    line(kind: Line['kind'], style: Line['style'], points: Vec2[], opts: { height?: number; thickness?: number; gates?: { segment: number; offset: number; width: number }[] } = {}) {
      const l: Line = {
        id: id(), kind, style, points, height: opts.height ?? (kind === 'fence' ? 1.8 : kind === 'retaining_wall' ? 0.6 : 0.1),
        thickness: opts.thickness ?? (kind === 'retaining_wall' ? 0.3 : kind === 'fence' ? 0.1 : 0.01),
        gates: (opts.gates ?? []).map((g) => ({ id: id(), ...g })), materialId: cat.materialsFor(kind)[0]?.id
      };
      p.lines.push(l);
      return l;
    },
    object(catalogId: string, x: number, y: number, w: number, d: number, h: number, rotation = 0) {
      const o: SiteObject = { id: id(), catalogId, x, y, rotation, width: w, depth: d, height: h, elevation: 0, status: 'proposed' };
      p.objects.push(o);
      return o;
    }
  };
}

type Builder = ReturnType<typeof builder>;

/** Saves the design as changed by `change` as a named option (snapshot), then restores the main design. */
function option(b: Builder, name: string, change: () => void) {
  const keep = snapshotOf(b.p);
  change();
  b.p.alternatives.push({ id: b.id(), name, createdAt: '2026-10-07T00:00:00.000Z', snapshot: snapshotOf(b.p) });
  Object.assign(b.p, clone(keep));
}

// ---------- Northeast back yard (zone 6b) ----------

const NORTHEAST: SampleInfo = {
  id: 'northeast-back-yard',
  name: 'Northeast back yard',
  regionId: 'us-northeast',
  blurb: 'Patio with pergola, lawn, privacy hedge, native pollinator border, shade bed and a rain garden.',
  description: 'A family back yard in zone 6b: a bluestone patio under a pergola, a modest lawn, an arborvitae privacy hedge along the fence, a native pollinator border along the back, a shade bed of ferns and hostas, a rain garden at the downspout, and three native specimen trees. Option B swaps the pergola for raised vegetable beds.'
};

function northeast(cat: Catalog): Project {
  const b = builder(NORTHEAST.id, NORTHEAST, '6b', 'imperial', cat);
  const p = b.p;
  p.site.boundary = rect(0, 0, 22, 34);
  p.verification.boundary = true;
  b.house(4, 2, 18, 12, 'bottom');
  b.area('patio', 'Bluestone patio', rect(6, 12, 13, 17));
  b.area('lawn', 'Lawn', rect(7, 18, 17.6, 28.6));
  b.area('path', 'Path to the side gate', rect(13, 15.6, 21.9, 16.8));
  b.line('fence', 'board', [[0, 12], [0, 34], [22, 34], [22, 12]], { gates: [{ segment: 2, offset: 17.2, width: 1.1 }] });
  b.line('edging', 'steel', [[7, 28.8], [17.6, 28.8]]);

  // Privacy hedge of 'Emerald' arborvitae along the west fence.
  b.group('row', ['thuja-occidentalis-smaragd'], [[0.9, 13], [0.9, 29]], 11, { spacing: 1.1 });
  // Back border: a shrub layer against the fence, two native pollinator drifts in front.
  b.area('bed', 'Pollinator border', rect(1.8, 29.6, 20.6, 33.7));
  b.group('row', ['viburnum-dentatum', 'ilex-verticillata', 'aronia-melanocarpa'], [[2.8, 32.9], [19.6, 32.9]], 12, { spacing: 2 });
  b.group('mass', ['echinacea-purpurea', 'asclepias-tuberosa', 'rudbeckia-fulgida-sullivantii-goldsturm', 'monarda-fistulosa'], rect(2.2, 29.8, 10.6, 31.2), 13, { spacing: 0.62 });
  b.group('mass', ['liatris-spicata', 'schizachyrium-scoparium', 'symphyotrichum-novae-angliae', 'baptisia-australis'], rect(11.4, 29.8, 20.2, 31.2), 14, { spacing: 0.66 });
  // Shade bed on the north-west side, under the hedge's shadow.
  b.area('bed', 'Shade bed', rect(2.4, 19, 6, 27), { sun: 'shade' });
  b.group('mass', ['hosta-sum-and-substance', 'polystichum-acrostichoides', 'astilbe-arendsii', 'heuchera-americana', 'tiarella-cordifolia'], rect(2.5, 19.2, 5.9, 26.8), 15, { spacing: 0.78 });
  // Rain garden at the south-east downspout.
  const rain: Vec2[] = [[14.2, 12.5], [21.5, 12.5], [21.5, 15.1], [16.5, 15.1], [14.2, 14.2]];
  b.area('bed', 'Rain garden', rain, { moisture: 'wet' });
  b.group('mass', ['iris-sibirica', 'lobelia-cardinalis', 'asclepias-incarnata', 'eutrochium-dubium-little-joe'], [[14.3, 12.6], [21.4, 12.6], [21.4, 15.0], [16.5, 15.0], [14.3, 14.1]], 16, { spacing: 0.62 });
  // Specimen trees.
  b.plant('amelanchier-arborea', 4.4, 15.3);
  b.plant('cornus-florida', 10.6, 24.4);
  b.plant('nyssa-sylvatica', 16, 21.6);
  // Patio furniture and containers.
  b.object('pergola', 9.5, 14.5, 3.2, 3.2, 2.6);
  b.object('outdoor_pot_large', 6.5, 16.5, 0.5, 0.5, 0.45);
  b.object('outdoor_pot_large', 12.5, 12.5, 0.5, 0.5, 0.45);
  b.object('bench_outdoor', 12.3, 27.6, 1.5, 0.5, 0.8, 180);
  option(b, 'Option B — kitchen garden', () => {
    p.objects = p.objects.filter((x) => x.catalogId !== 'pergola');
    b.object('raised_bed', 9.2, 13.6, 1.8, 0.9, 0.4);
    b.object('raised_bed', 9.2, 15.6, 1.8, 0.9, 0.4);
    b.object('raised_bed', 14.5, 26.6, 1.8, 0.9, 0.4, 90);
  });
  return p;
}

// ---------- Southeast front yard (zone 8a) ----------

const SOUTHEAST: SampleInfo = {
  id: 'southeast-front-yard',
  name: 'Southeast front yard',
  regionId: 'us-southeast',
  blurb: 'Driveway, front walk, foundation beds, a crape myrtle and palmetto, and a native meadow strip.',
  description: 'A welcoming zone 8a front yard: a brick front walk to the door, evergreen foundation beds of Indian hawthorn and gardenia with a flowering edge, a crape myrtle and a cabbage palmetto, a native meadow strip along the street, an oakleaf hydrangea side border and containers by the door.'
};

function southeast(cat: Catalog): Project {
  const b = builder(SOUTHEAST.id, SOUTHEAST, '8a', 'imperial', cat);
  const p = b.p;
  p.site.boundary = rect(0, 0, 20, 24);
  p.verification.boundary = true;
  b.house(3, 3, 15, 12, 'bottom');
  b.area('driveway', 'Driveway', rect(16, 3, 19.6, 24));
  b.area('path', 'Front walk', rect(8.4, 12, 9.6, 24));
  b.area('path', 'Drive walk', rect(9.6, 14.7, 16, 15.5));
  b.area('lawn', 'Lawn (west)', rect(0.4, 14.8, 8.2, 21.4));
  b.area('lawn', 'Lawn (east)', rect(9.8, 15.7, 15.8, 21.4));
  // Foundation beds: an evergreen shrub row behind a flowering edge.
  b.area('bed', 'Foundation bed (west)', rect(3, 12, 8.2, 14.5));
  b.area('bed', 'Foundation bed (east)', rect(9.8, 12, 15, 14.5));
  b.group('row', ['rhaphiolepis-indica', 'gardenia-jasminoides'], [[3.7, 12.75], [7.6, 12.75]], 21, { spacing: 1.3 });
  b.group('row', ['gardenia-jasminoides', 'rhaphiolepis-indica'], [[10.4, 12.75], [14.4, 12.75]], 26, { spacing: 1.3 });
  b.group('mass', ['coreopsis-verticillata-moonbeam', 'liriope-muscari', 'hemerocallis-stella-de-oro'], rect(3.2, 13.7, 8.1, 14.4), 22, { spacing: 0.55 });
  b.group('mass', ['coreopsis-verticillata-moonbeam', 'liriope-muscari', 'hemerocallis-stella-de-oro'], rect(9.9, 13.7, 14.9, 14.4), 27, { spacing: 0.55 });
  // Native meadow strip along the street.
  b.area('bed', 'Meadow strip', rect(0.4, 21.8, 8.2, 23.6));
  b.area('bed', 'Meadow strip (east)', rect(9.8, 21.8, 15.8, 23.6));
  b.group('mass', ['coreopsis-lanceolata', 'echinacea-purpurea', 'rudbeckia-hirta', 'schizachyrium-scoparium', 'muhlenbergia-capillaris', 'asclepias-tuberosa'], rect(0.5, 21.9, 8.1, 23.5), 23, { spacing: 0.6 });
  b.group('mass', ['liatris-spicata', 'echinacea-purpurea', 'muhlenbergia-capillaris', 'coreopsis-lanceolata'], rect(9.9, 21.9, 15.7, 23.5), 24, { spacing: 0.6 });
  // Side border along the west property line.
  b.area('bed', 'Side border', rect(0.3, 0.4, 2.5, 14));
  b.group('row', ['hydrangea-quercifolia', 'camellia-sasanqua'], [[1.4, 11.8], [1.4, 1]], 25, { spacing: 2.1 });
  // Street tree and accent palm.
  b.plant('lagerstroemia-indica', 4, 18.2);
  b.plant('sabal-palmetto', 13.6, 17.8);
  b.object('outdoor_pot_large', 8.0, 23.4, 0.5, 0.5, 0.5);
  b.object('outdoor_pot_large', 10.0, 23.4, 0.5, 0.5, 0.5);
  b.object('outdoor_pot_large', 8.0, 12.3, 0.5, 0.5, 0.6);
  b.object('outdoor_pot_large', 10.0, 12.3, 0.5, 0.5, 0.6);
  b.object('bench_outdoor', 12.6, 16.3, 1.5, 0.5, 0.8, 180);
  return p;
}

// ---------- Southwest courtyard (zone 9a) ----------

const SOUTHWEST: SampleInfo = {
  id: 'southwest-courtyard',
  name: 'Southwest dry courtyard',
  regionId: 'us-southwest',
  blurb: 'Water-wise courtyard: gravel and flagstone, desert trees, agaves and yuccas, a wildflower drift and a basin.',
  description: 'A low-water courtyard in zone 9a: flagstone patio and decomposed-granite garden, palo verde and ironwood for filtered shade, a cluster of agaves, red yucca and barrel cactus among boulders, a desert wildflower drift, a sage and deer-grass screen along the back wall, and a small water basin by the patio.'
};

function southwest(cat: Catalog): Project {
  const b = builder(SOUTHWEST.id, SOUTHWEST, '9a', 'metric', cat);
  const p = b.p;
  p.site.boundary = rect(0, 0, 18, 22);
  p.verification.boundary = true;
  p.site.moisture = 'dry';
  p.site.soil = 'sand';
  b.house(2, 2, 14, 10, 'bottom');
  b.area('gravel', 'Decomposed granite', rect(0.4, 10.4, 17.6, 21.6));
  b.area('patio', 'Flagstone patio', rect(5, 10, 10, 14));
  b.area('water', 'Water basin', rect(12, 11, 14.4, 13));
  b.line('retaining_wall', 'block', [[0.1, 10], [0.1, 21.9], [17.9, 21.9], [17.9, 10]], { height: 1.2, thickness: 0.2 });
  // Back-wall screen: Texas sage, deer grass and fairy duster.
  b.group('row', ['leucophyllum-frutescens', 'muhlenbergia-rigens', 'calliandra-eriophylla'], [[6.6, 20.9], [15, 20.9]], 31, { spacing: 1.5 });
  // Desert wildflower drift.
  b.group('mass', ['baileya-multiradiata', 'penstemon-parryi', 'melampodium-leucanthum', 'sphaeralcea-ambigua', 'epilobium-canum'], rect(6.8, 17.5, 12.5, 19.6), 32, { spacing: 0.5 });
  // Agaves, red yucca and cacti among boulders.
  b.group('mass', ['agave-parryi', 'hesperaloe-parviflora', 'yucca-rostrata', 'ferocactus-wislizeni', 'echinocereus-engelmannii'], rect(6.3, 14.5, 11.8, 16.8), 33, { spacing: 0.8, ratios: [3, 2, 1, 1, 2] });
  // Grass and penstemon drift west of the patio.
  b.group('mass', ['nassella-tenuissima', 'bouteloua-gracilis', 'penstemon-eatonii'], rect(0.6, 10.6, 3.9, 14.9), 35, { spacing: 0.55 });
  b.object('boulder', 7.2, 16.9, 1.2, 0.9, 0.7, 25);
  b.object('rock_large', 10.9, 14.4, 0.9, 0.7, 0.5, 70);
  b.object('rock_small', 12.8, 16.4, 0.4, 0.3, 0.25);
  b.group('row', ['salvia-greggii'], [[4.4, 10.7], [4.4, 13.7]], 34, { spacing: 0.75 });
  // Trees and specimens.
  b.plant('parkinsonia-desert-museum', 15.5, 15.2);
  b.plant('olneya-tesota', 2.8, 18.5);
  b.plant('dasylirion-wheeleri', 11.2, 11.6);
  b.plant('fouquieria-splendens', 16.8, 20.1);
  b.object('bench_outdoor', 7.5, 13.4, 1.5, 0.5, 0.8, 180);
  b.object('outdoor_pot_large', 5.5, 10.5, 0.5, 0.5, 0.5);
  return p;
}

const BUILDERS: Record<string, { info: SampleInfo; build: (cat: Catalog) => Project }> = {
  [NORTHEAST.id]: { info: NORTHEAST, build: northeast },
  [SOUTHEAST.id]: { info: SOUTHEAST, build: southeast },
  [SOUTHWEST.id]: { info: SOUTHWEST, build: southwest }
};

export const SAMPLES: SampleInfo[] = Object.values(BUILDERS).map((x) => x.info);

/** The pristine sample design (deterministic: same catalog → identical project). */
export function buildSample(id: string, cat: Catalog = defaultCatalog): Project | undefined {
  const s = BUILDERS[id];
  if (!s) return undefined;
  const p = s.build(cat);
  p.extra = { ...p.extra };
  return p;
}

/** A fresh, independent copy to work on: new project id, current timestamps, "(sample)" name. */
export function sampleCopy(id: string, cat: Catalog = defaultCatalog, now = new Date()): Project | undefined {
  const p = buildSample(id, cat);
  if (!p) return undefined;
  const iso = now.toISOString();
  return { ...p, id: uid(), name: `${p.name} (sample)`, createdAt: iso, updatedAt: iso, captureSource: 'template', web: { ...p.web, plantingYear: now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0), sampleId: id } };
}
