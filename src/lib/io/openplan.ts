// OpenPlan3D "prepared RoomPlan JSON" with the `openlandscape3d` block — the interchange contract in
// openlandscape3d-ios/docs/EXPORT_FORMAT.md. Export maps every plant, fence segment, gate, hard
// area and site object to an OpenPlan3D web catalog id at its exported size; import reads iOS
// exports, our own files and plain OpenPlan3D building files back into a web Project.
import type { Catalog, Plant } from '../catalog/catalog';
import type { Area, Building, Line, PlantInstance, Project, SiteObject, Vec2 } from '../model/types';
import { BLOCK_SCHEMA, WEB_SCHEMA, clone, stableId, uid } from '../model/types';
import { dist, orientedRect, rad, deg } from '../model/geometry';
import { sizeAt } from '../analysis/growth';
import { defaultSite } from '../site/regions';

type Json = Record<string, any>;

export function transform(x: number, z: number, angle: number, y: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  // `+ 0` turns −0 into 0 so JSON round trips compare equal.
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, y, z, 1].map((v) => v + 0);
}
export const heading = (t: number[]) => Math.atan2(t[2], t[0]);

/** OpenPlan3D outdoor catalog ids a site object may use (EXPORT_FORMAT.md mapping table). */
export const SITE_OBJECT_IDS = ['pergola', 'gazebo', 'shed', 'boulder', 'rock_large', 'rock_small', 'bench_outdoor', 'outdoor_pot_large', 'outdoor_pot_small', 'planter_box', 'raised_garden_bed', 'raised_bed', 'pool_round', 'spot_light_outdoor'] as const;

const FENCE_CATEGORY: Record<string, string> = { board: 'fence_planks', picket: 'picket_fence', metal: 'metal_fence', rail: 'fence_simple' };

/**
 * OpenPlan3D category for a catalog plant: the catalog's `representation.openplanProxy`, verbatim
 * (EXPORT_FORMAT.md — clients never derive it; the catalog build applies the mapping table).
 * The form default only covers a malformed record without a proxy.
 */
const FORM_DEFAULT: Record<string, string> = { tree: 'tree_default', conifer: 'tree_pine', palm: 'tree_palm', shrub: 'bush', perennial: 'flower_yellow', grass: 'grass_large', groundcover: 'grass_tuft', succulent: 'cactus_short', vine: 'bush_small' };
export function plantCategory(p: Plant): string {
  return p.representation?.openplanProxy || FORM_DEFAULT[p.form] || 'bush';
}

const pos = (v: number) => Math.max(0.01, v);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export interface ExportOptions {
  /** Embed the full web project (web → web file round trips). Never in links. */
  embedWebProject?: boolean;
  /** Link privacy: coarse location (2 decimals), no observation coordinates, no webProject. */
  forLink?: boolean;
}

function attrs(role: string, kind: string, extra: Json = {}): Json {
  return { openlandscape3dRole: role, openlandscape3dKind: kind, ...extra };
}

/** Object entries for every exportable item, in a stable order. */
export function landscapeObjects(p: Project, cat: Catalog): Json[] {
  const objects: Json[] = [];
  const year = p.scenario.year;
  for (const inst of p.plants) {
    const plant = cat.plant(inst.plantId);
    const size = sizeAt(inst, plant, year);
    const category = plant ? plantCategory(plant) : inst.fallback?.category ?? 'bush';
    const w = plant ? size.spread : inst.fallback?.width ?? size.spread;
    const d = plant ? size.spread : inst.fallback?.depth ?? size.spread;
    const h = plant ? size.height : inst.fallback?.height ?? size.height;
    objects.push({
      identifier: inst.id,
      dimensions: [r6(pos(w)), r6(pos(h)), r6(pos(d))],
      transform: transform(inst.x, inst.y, 0, r6(pos(h) / 2)),
      category: { [category]: {} },
      attributes: attrs(inst.status, 'plant', { plantId: inst.plantId, ...(inst.groupId ? { groupId: inst.groupId } : {}) }),
      story: 0
    });
  }
  for (const l of p.lines) {
    if (l.kind === 'edging') continue; // block only
    const role = String(l.status ?? 'proposed');
    for (let i = 0; i < l.points.length - 1; i++) {
      const a = l.points[i], b = l.points[i + 1];
      const L = dist(a, b);
      if (L < 0.01) continue;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const isFence = l.kind === 'fence';
      objects.push({
        identifier: stableId(`${l.id}:segment:${i}`),
        dimensions: [r6(L), r6(pos(l.height)), isFence ? 0.1 : r6(pos(l.thickness))],
        transform: transform(mid[0], mid[1], ang, r6(pos(l.height) / 2)),
        category: { [isFence ? FENCE_CATEGORY[l.style] ?? 'fence_planks' : 'retaining_wall']: {} },
        attributes: attrs(role, isFence ? 'fence' : 'retaining_wall', { lineId: l.id, segment: i }),
        story: 0
      });
    }
    if (l.kind === 'fence')
      for (const g of l.gates ?? []) {
        const a = l.points[g.segment], b = l.points[g.segment + 1];
        if (!a || !b) continue;
        const L = dist(a, b) || 1;
        const t = Math.min(1, Math.max(0, (g.offset + g.width / 2) / L));
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        objects.push({
          identifier: g.id,
          dimensions: [r6(pos(g.width)), r6(pos(l.height)), 0.1],
          transform: transform(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang, r6(pos(l.height) / 2)),
          category: { fence_gate: {} },
          attributes: attrs(role, 'gate', { lineId: l.id }),
          story: 0
        });
      }
  }
  for (const a of p.areas) {
    if (!['patio', 'deck', 'water'].includes(a.kind) || a.polygon.length < 3) continue;
    const r = orientedRect(a.polygon);
    objects.push({
      identifier: a.id,
      dimensions: [r6(pos(r.width)), 0.15, r6(pos(r.depth))],
      transform: transform(r6(r.center[0]), r6(r.center[1]), r.angle, r6((a.elevation ?? 0) + 0.075)),
      category: { [a.kind === 'water' ? 'pool_rectangular' : 'deck_patio']: {} },
      attributes: attrs(String(a.status ?? 'proposed'), 'area', { areaKind: a.kind }),
      story: 0
    });
  }
  for (const o of p.objects) {
    objects.push({
      identifier: o.id,
      dimensions: [r6(pos(o.width)), r6(pos(o.height)), r6(pos(o.depth))],
      transform: transform(o.x, o.y, rad(o.rotation), r6((o.elevation ?? 0) + pos(o.height) / 2)),
      category: { [o.catalogId]: {} },
      attributes: attrs(o.status, 'object'),
      story: 0
    });
  }
  return objects;
}

const DEFAULT_STORIES = [{ index: 0, name: 'Ground Floor' }];
const DEFAULT_DEFAULTS = { ceilingHeight: 2.4, interiorWallThickness: 0.12, exteriorWallThickness: 0.2 };

function stripPlant(i: PlantInstance): Json {
  const { fallback: _f, ...rest } = i;
  return rest;
}

export function toOpenPlan(p: Project, cat: Catalog, opts: ExportOptions = {}): Json {
  const forLink = !!opts.forLink;
  const embed = !forLink && (opts.embedWebProject ?? true);
  const b = p.building;
  const site: Json = clone(p.site);
  let observations: Json[] = clone(p.observations ?? []);
  if (forLink) {
    if (site.location) site.location = { ...site.location, lat: Math.round(site.location.lat * 100) / 100, lon: Math.round(site.location.lon * 100) / 100, precision: 'coarse' };
    observations = observations.map(({ lat: _a, lon: _b, headingDeg: _c, ...o }) => o);
  }
  const block: Json = {
    ...clone(p.extra ?? {}),
    schema: BLOCK_SCHEMA,
    producer: 'web',
    units: 'm',
    projectId: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    catalogVersion: p.catalogVersion,
    captureSource: p.captureSource,
    site,
    scenario: { ...p.scenario },
    areas: clone(p.areas),
    lines: clone(p.lines),
    plants: p.plants.map(stripPlant),
    groups: clone(p.groups),
    objects: clone(p.objects),
    observations,
    alternatives: clone(p.alternatives ?? []),
    verification: clone(p.verification),
    overrides: clone(p.overrides ?? []),
    building: null,
    web: clone(p.web)
  };
  if (embed) block.webProject = clone(p);
  return {
    openplanPrepared: true,
    openplanHandoffVersion: 1,
    version: 2,
    walls: clone(b?.walls ?? []),
    doors: clone(b?.doors ?? []),
    windows: clone(b?.windows ?? []),
    openings: clone(b?.openings ?? []),
    objects: [...landscapeObjects(p, cat), ...clone(b?.objects ?? [])],
    sections: clone(b?.sections ?? []),
    stories: clone(b?.stories?.length ? b.stories : DEFAULT_STORIES),
    floors: clone(b?.floors ?? []),
    defaults: clone(b?.defaults && Object.keys(b.defaults).length ? b.defaults : DEFAULT_DEFAULTS),
    planNotes: 'Created with OpenLandscape3D for web. Plant sizes are scenario estimates; field-verify boundaries and utilities before building.',
    openlandscape3d: block
  };
}

// ---------- import ----------

const catKey = (c: unknown) => (c && typeof c === 'object' ? Object.keys(c as object)[0] : String(c ?? 'object'));

export function isOpenPlanJson(j: unknown): j is Json {
  return !!j && typeof j === 'object' && Array.isArray((j as Json).walls) && ((j as Json).openplanHandoffVersion === 1 || (j as Json).openplanPrepared === true || 'objects' in (j as Json));
}
export const isWebProject = (j: unknown): j is Project => !!j && typeof j === 'object' && (j as Json).schema === WEB_SCHEMA;

/** Keys of the `openlandscape3d` block this app models; anything else is kept in `extra`. */
const BLOCK_KEYS = new Set(['schema', 'producer', 'units', 'projectId', 'name', 'createdAt', 'updatedAt', 'catalogVersion', 'captureSource', 'site', 'scenario', 'areas', 'lines', 'plants', 'groups', 'objects', 'observations', 'alternatives', 'verification', 'overrides', 'building', 'web', 'webProject']);

function buildingFrom(j: Json, passthrough: Json[]): Building | null {
  const b: Building = {
    walls: clone(j.walls ?? []),
    doors: clone(j.doors ?? []),
    windows: clone(j.windows ?? []),
    openings: clone(j.openings ?? []),
    sections: clone(j.sections ?? []),
    stories: clone(j.stories ?? DEFAULT_STORIES),
    floors: clone(j.floors ?? []),
    defaults: clone(j.defaults ?? DEFAULT_DEFAULTS),
    ...(passthrough.length ? { objects: clone(passthrough) } : {})
  };
  const empty = !b.walls.length && !b.doors.length && !b.windows.length && !b.openings.length && !b.sections.length && !passthrough.length;
  return empty ? null : b;
}

const withoutLocation = ({ location: _l, ...rest }: Project['site']) => rest as Project['site'];

/** Fills defaults so older or partial projects open safely. */
export function normalizeProject(p: Partial<Project> & { id?: string }): Project {
  const now = new Date().toISOString();
  return {
    schema: WEB_SCHEMA,
    id: p.id ?? uid(),
    name: p.name ?? 'Untitled site',
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    catalogVersion: p.catalogVersion ?? 'ol-plants@0.1',
    captureSource: p.captureSource ?? 'manual',
    // Fill only missing required keys; never invent a location the producer didn't write.
    site: p.site ? { ...withoutLocation(defaultSite(p.site.regionId ?? 'us-northeast')), ...p.site } : defaultSite('us-northeast'),
    scenario: { month: 6, year: 5, hour: 14, ...(p.scenario ?? {}) },
    areas: p.areas ?? [],
    lines: (p.lines ?? []).map((l) => ({ ...l, gates: l.gates ?? [] })),
    plants: p.plants ?? [],
    groups: p.groups ?? [],
    objects: p.objects ?? [],
    observations: p.observations ?? [],
    alternatives: p.alternatives ?? [],
    verification: { boundary: false, measurements: {}, ...(p.verification ?? {}) },
    overrides: p.overrides ?? [],
    building: p.building ?? null,
    web: { units: 'metric', ...(p.web ?? {}) },
    extra: p.extra ?? {}
  };
}

/** Reads an OpenLandscape3D export (web or iOS), a plain OpenPlan3D file, or a web project. */
export function fromOpenPlan(j: Json, cat: Catalog, fallbackName = 'Imported site'): Project {
  if (isWebProject(j)) return normalizeProject(clone(j));
  const block: Json | undefined = j.openlandscape3d;
  // The embedded web project is trusted only when the web wrote the file; iOS edits come from the block.
  if (block?.producer === 'web' && isWebProject(block.webProject)) return normalizeProject(clone(block.webProject));
  const objects: Json[] = Array.isArray(j.objects) ? j.objects : [];
  const ours = (o: Json) => typeof o?.attributes?.openlandscape3dKind === 'string';
  const passthrough = block ? objects.filter((o) => !ours(o)) : [];
  const now = new Date().toISOString();

  if (!block) {
    // A plain OpenPlan3D plan: keep the building verbatim, lift known outdoor objects into site objects.
    const siteObjects: SiteObject[] = [];
    const rest: Json[] = [];
    for (const o of objects) {
      const c = catKey(o.category);
      if ((SITE_OBJECT_IDS as readonly string[]).includes(c) && Array.isArray(o.transform)) {
        const t = o.transform as number[];
        const [w, h, d] = o.dimensions as number[];
        siteObjects.push({ id: String(o.identifier ?? uid()), catalogId: c, x: t[12], y: t[14], rotation: deg(heading(t)), width: w, height: h, depth: d, elevation: Math.max(0, t[13] - h / 2), status: 'existing' });
      } else rest.push(o);
    }
    const name = j.sections?.find((s: Json) => s.displayName)?.displayName ?? fallbackName;
    return normalizeProject({
      id: uid(), name, createdAt: now, updatedAt: now, captureSource: 'openplan',
      objects: siteObjects, building: buildingFrom(j, rest),
      site: defaultSite('us-northeast'), web: { units: 'metric' }
    });
  }

  const byId = new Map<string, Json>(objects.map((o) => [String(o.identifier), o]));
  const plants: PlantInstance[] = (block.plants ?? []).map((raw: Json) => {
    const inst = clone(raw) as PlantInstance;
    if (!cat.plant(inst.plantId)) {
      const o = byId.get(String(inst.id));
      if (o?.dimensions) inst.fallback = { category: catKey(o.category), width: o.dimensions[0], height: o.dimensions[1], depth: o.dimensions[2] };
    }
    return inst;
  });
  const extra: Json = {};
  for (const [k, v] of Object.entries(block)) if (!BLOCK_KEYS.has(k)) extra[k] = clone(v);
  const building = block.building && typeof block.building === 'object' ? (clone(block.building) as Building) : buildingFrom(j, passthrough);
  if (building && block.building && passthrough.length && !building.objects) building.objects = clone(passthrough);
  return normalizeProject({
    id: String(block.projectId ?? uid()),
    name: String(block.name ?? fallbackName),
    createdAt: block.createdAt ?? now,
    updatedAt: block.updatedAt ?? now,
    catalogVersion: block.catalogVersion ?? cat.version,
    captureSource: block.captureSource ?? 'manual',
    site: clone(block.site ?? defaultSite('us-northeast')),
    scenario: clone(block.scenario ?? { month: 6, year: 5, hour: 14 }),
    areas: clone(block.areas ?? []) as Area[],
    lines: clone(block.lines ?? []) as Line[],
    plants,
    groups: clone(block.groups ?? []),
    objects: clone(block.objects ?? []),
    observations: clone(block.observations ?? []),
    alternatives: clone(block.alternatives ?? []),
    verification: clone(block.verification ?? { boundary: false, measurements: {} }),
    overrides: clone(block.overrides ?? []),
    building,
    web: { units: 'metric', ...clone(block.web ?? {}) },
    extra
  });
}

export function fileName(p: Project, suffix: string, ext: string) {
  const safe = p.name.split(/[^A-Za-z0-9]+/).filter(Boolean).join('-');
  return `${safe || 'site'}-${suffix}.${ext}`;
}

/** Compact, key-sorted JSON (the OpenPlan3D handoff payload form). */
export function sortedJson(v: unknown): string {
  const sort = (x: any): any => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v));
}
