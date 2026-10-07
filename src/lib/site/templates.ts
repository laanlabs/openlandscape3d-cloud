// New-site templates. Plants are chosen from whatever catalog is loaded, filtered to the site's
// region and zone, so templates stay valid as the catalog grows.
import type { Catalog, Form, Plant } from '../catalog/catalog';
import { catalog as defaultCatalog, isNativeTo, policiesFor, zoneNumber } from '../catalog/catalog';
import type { Area, AreaKind, Building, Line, PlantGroup, PlantInstance, Polygon, Project, Site, SiteObject, Vec2 } from '../model/types';
import { clone, uid } from '../model/types';
import { transform } from '../io/openplan';
import { normalizeProject } from '../io/openplan';
import { installDims } from '../catalog/catalog';
import { mixSpacing, resolveGroup } from '../analysis/groups';
import { defaultSite } from './regions';

export type TemplateId = 'blank' | 'rect' | 'backyard' | 'frontyard';
export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: 'blank', name: 'Blank site', blurb: 'Start from nothing; draw the boundary yourself.' },
  { id: 'rect', name: 'Rectangular lot', blurb: 'A property boundary at the size you type.' },
  { id: 'backyard', name: 'Suburban back yard', blurb: 'House, patio, lawn, fence and planting beds.' },
  { id: 'frontyard', name: 'Front yard', blurb: 'Driveway, front walk, foundation beds and a street tree.' }
];

export interface NewSiteOptions {
  name: string;
  units: 'metric' | 'imperial';
  regionId: string;
  zone?: string;
  state?: string;
  template: TemplateId;
  width?: number;
  depth?: number;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Simple rectangular house as verbatim OpenPlan3D walls, one door and windows. */
export function houseBuilding(x0: number, y0: number, x1: number, y1: number, opts: { doorSide: 'top' | 'bottom'; name?: string } = { doorSide: 'bottom' }): Building {
  const h = 2.7, t = 0.2;
  const corners: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const walls = corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { identifier: uid(), dimensions: [L, h, t], transform: transform((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), h / 2), category: { wall: {} }, story: 0 };
  });
  const along = (wi: number, s: number) => {
    const a = corners[wi], b = corners[(wi + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { x: a[0] + ((b[0] - a[0]) * s) / L, y: a[1] + ((b[1] - a[1]) * s) / L, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  const doorWall = opts.doorSide === 'top' ? 0 : 2;
  const winWall = opts.doorSide === 'top' ? 2 : 0;
  const W = x1 - x0;
  const d = along(doorWall, W / 2);
  const doors = [{ identifier: uid(), parentIdentifier: walls[doorWall].identifier, dimensions: [0.95, 2.1, t], transform: transform(d.x, d.y, d.ang, 1.05), category: { door: {} }, story: 0, style: 'single', hingeLeft: true, opensInward: true }];
  const windows = [W * 0.25, W * 0.75].flatMap((s) => [doorWall, winWall].map((wi) => {
    const q = along(wi, wi === doorWall ? s : s);
    return { identifier: uid(), parentIdentifier: walls[wi].identifier, dimensions: [1.4, 1.3, t], transform: transform(q.x, q.y, q.ang, 0.9 + 0.65), category: { window: {} }, story: 0, style: 'fixed', sillHeight: 0.9 };
  }));
  return {
    walls, doors, windows, openings: [],
    sections: [{ center: [(x0 + x1) / 2, 0, (y0 + y1) / 2], label: 'livingRoom', story: 0, displayName: opts.name ?? 'House' }],
    stories: [{ index: 0, name: 'Ground Floor' }], floors: [],
    defaults: { ceilingHeight: 2.4, interiorWallThickness: 0.12, exteriorWallThickness: 0.2 }
  };
}

/** Best catalog plant of a form for this site: hardy, not restricted, tolerates the exposure; natives first. */
export function pickPlant(cat: Catalog, site: Site, form: Form | Form[], sun = site.sun, skip: string[] = []): Plant | undefined {
  const forms = Array.isArray(form) ? form : [form];
  const z = zoneNumber(site.hardiness.zone);
  const region = cat.region(site.regionId);
  const ok = cat.plants.filter((p) =>
    forms.includes(p.form) && !skip.includes(p.id) && z >= p.hardiness.min && z <= p.hardiness.max && p.sun.includes(sun) && p.moisture.includes(site.moisture) &&
    !policiesFor(p, region, site.regionId).some((x) => ['invasive', 'noxious', 'prohibited'].includes(x.status)));
  return ok.sort((a, b) => Number(isNativeTo(b, site.regionId)) - Number(isNativeTo(a, site.regionId)) || a.id.localeCompare(b.id))[0];
}

export function makePlant(plant: Plant, x: number, y: number, seed = Math.floor(Math.random() * 1e9)): PlantInstance {
  const d = installDims(plant);
  return { id: uid(), plantId: plant.id, x, y, status: 'proposed', plantedYear: 0, installSize: d.code, installHeight: d.heightM, installSpread: d.spreadM, seed };
}

export function makeArea(kind: AreaKind, polygon: Polygon, cat: Catalog, name?: string): Area {
  return { id: uid(), kind, name: name ?? kind[0].toUpperCase() + kind.slice(1), materialId: cat.materialsFor(kind)[0]?.id, polygon, elevation: kind === 'deck' ? 0.45 : 0 };
}

export function makeGroup(kind: PlantGroup['kind'], plants: Plant[], geom: Vec2[], cat: Catalog, seed = 7): PlantGroup {
  const mix = plants.map((p) => ({ plantId: p.id, ratio: 1 }));
  return { id: uid(), kind, mix, spacing: mixSpacing(mix, cat), ...(kind === 'row' ? { path: geom } : { polygon: geom }), seed, instanceIds: [] };
}

function addGroup(p: { plants: PlantInstance[]; groups: PlantGroup[] }, g: PlantGroup, cat: Catalog) {
  const inst = resolveGroup(g, cat);
  g.instanceIds = inst.map((i) => i.id);
  p.groups.push(g);
  p.plants.push(...inst);
}

export function fence(points: Vec2[], gates: { segment: number; offset: number; width: number }[] = []): Line {
  return { id: uid(), kind: 'fence', style: 'board', points, height: 1.8, thickness: 0.1, gates: gates.map((g) => ({ id: uid(), ...g })) };
}

export function siteObject(catalogId: string, x: number, y: number, w: number, d: number, h: number, rotation = 0): SiteObject {
  return { id: uid(), catalogId, x, y, rotation, width: w, depth: d, height: h, elevation: 0, status: 'proposed' };
}

export function newProject(o: NewSiteOptions, cat: Catalog = defaultCatalog): Project {
  const site = defaultSite(o.regionId, cat, o.state);
  if (o.zone) site.hardiness = { system: 'USDA', zone: o.zone };
  const now = new Date().toISOString();
  const base = normalizeProject({
    id: uid(), name: o.name || 'My garden', createdAt: now, updatedAt: now, catalogVersion: cat.version,
    captureSource: o.template === 'blank' || o.template === 'rect' ? 'manual' : 'template',
    site, web: { units: o.units, plantingYear: new Date().getFullYear(), layers: {}, ghostRings: false }
  });
  if (o.template === 'blank') return base;
  if (o.template === 'rect') {
    const W = o.width ?? 20, D = o.depth ?? 30;
    return { ...base, site: { ...site, boundary: rect(0, 0, W, D) } };
  }
  const p = clone(base);
  const pickAll = (forms: Form[], n: number, sun?: Site['sun']) => {
    const out: Plant[] = [];
    for (let i = 0; i < n; i++) { const pl = pickPlant(cat, site, forms, sun, out.map((x) => x.id)); if (pl) out.push(pl); }
    return out;
  };
  if (o.template === 'backyard') {
    p.site.boundary = rect(0, 0, 20, 30);
    p.building = houseBuilding(3, 2, 17, 12, { doorSide: 'bottom' });
    p.areas.push(makeArea('patio', rect(6, 12, 12.5, 16), cat, 'Patio'));
    p.areas.push(makeArea('lawn', [[1.2, 16], [19, 16], [19, 26.5], [1.2, 26.5]], cat, 'Lawn'));
    const rear = makeArea('bed', rect(1.2, 27, 19, 29.5), cat, 'Back border');
    p.areas.push(rear);
    const side = makeArea('bed', rect(0.4, 13, 1.1, 26.5), cat, 'Side hedge');
    p.areas.push(side);
    p.lines.push(fence([[0, 12], [0, 30], [20, 30], [20, 12]], [{ segment: 0, offset: 0.6, width: 1.0 }]));
    const tree = pickPlant(cat, site, ['tree', 'conifer', 'palm']);
    if (tree) p.plants.push(makePlant(tree, 15.5, 21.5, 11));
    const shrubs = pickAll(['shrub', 'conifer'], 1);
    if (shrubs.length) addGroup(p, makeGroup('row', shrubs, [[0.75, 13.6], [0.75, 26]], cat, 3), cat);
    const border = pickAll(['perennial', 'grass', 'groundcover', 'succulent'], 3);
    if (border.length) addGroup(p, makeGroup('mass', border, rear.polygon, cat, 5), cat);
    p.objects.push(siteObject('bench_outdoor', 10, 26.2, 1.5, 0.5, 0.8, 180));
    p.objects.push(siteObject('outdoor_pot_large', 12.9, 12.6, 0.4, 0.4, 0.35));
  } else {
    p.site.boundary = rect(0, 0, 20, 20);
    p.building = houseBuilding(4, 10, 16, 18, { doorSide: 'top' });
    p.areas.push(makeArea('driveway', rect(16.6, 0, 19.6, 18), cat, 'Driveway'));
    p.areas.push(makeArea('path', rect(9.4, 0, 10.6, 10), cat, 'Front walk'));
    const bedL = makeArea('bed', rect(4, 8, 9.2, 10), cat, 'Foundation bed');
    const bedR = makeArea('bed', rect(10.8, 8, 16, 10), cat, 'Foundation bed');
    p.areas.push(bedL, bedR);
    p.areas.push(makeArea('lawn', rect(0.4, 0.4, 16.2, 7.8), cat, 'Front lawn'));
    const tree = pickPlant(cat, site, ['tree']) ?? pickPlant(cat, site, ['conifer', 'palm']);
    if (tree) p.plants.push(makePlant(tree, 4, 3.5, 21));
    const shrubs = pickAll(['shrub'], 1);
    if (shrubs.length) {
      addGroup(p, makeGroup('row', shrubs, [[4.5, 9.45], [8.8, 9.45]], cat, 4), cat);
      addGroup(p, makeGroup('row', shrubs, [[11.2, 9.45], [15.6, 9.45]], cat, 6), cat);
    }
    const peren = pickAll(['perennial', 'grass', 'groundcover'], 2);
    if (peren.length) addGroup(p, makeGroup('mass', peren, [[4.2, 8.05], [9.1, 8.05], [9.1, 8.45], [4.2, 8.45]], cat, 8), cat);
  }
  return p;
}
