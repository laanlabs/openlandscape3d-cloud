// Type validation for projects that come from outside this app's own editor: imported files,
// transfer links and whatever is already stored in IndexedDB. `normalizeProject` fills missing
// keys; `sanitizeProject` (called at its end, so every load/import path is covered) makes sure
// the values that remain have the shapes the planner relies on. It never invents data a producer
// wrote correctly: on a valid project it is a no-op, and unchanged arrays and entries are returned
// as the same objects (copy on write). Anything it cannot repair is dropped and described in
// `dropped`, e.g. "2 plants with invalid positions".
//
// Surfacing the drop count: `normalizeProject` keeps returning a plain Project (callers and the
// iOS parity tests depend on that), so the report of the most recent sanitizeProject call is kept
// in this module. Read it with `takeSanitizeReport()` synchronously, right after the call that
// imported the project (e.g. `fromOpenPlan`); it returns and clears the report.
import type { Alternative, Area, DesignSnapshot, Line, Observation, Override, PlantGroup, PlantInstance, Project, SiteObject } from '../model/types';
import { WEB_SCHEMA, uid } from '../model/types';
import { defaultSite } from '../site/regions';

type Json = Record<string, any>;

export interface SanitizeReport {
  /** Human-readable notes, one per kind of damage, e.g. "2 plants with invalid positions". */
  dropped: string[];
  /** Number of entries skipped (a collection that was not a list counts once). */
  count: number;
}

export interface SanitizeResult extends SanitizeReport { project: Project }

let last: SanitizeReport = { dropped: [], count: 0 };

/** Returns, and clears, the report of the most recent `sanitizeProject` (and so `normalizeProject`) call. */
export function takeSanitizeReport(): SanitizeReport {
  const r = last;
  last = { dropped: [], count: 0 };
  return r;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown) => Array.isArray(v) && v.length >= 2 && finite(v[0]) && finite(v[1]);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const goodId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

type Reason = 'entry' | 'id' | 'position' | 'shape';
const REASON_TEXT: Record<Reason, string> = {
  entry: 'that could not be read',
  id: 'without a valid id',
  position: 'with invalid positions',
  shape: 'with too few points'
};

/** Checks a point list: null when it is fine, else why not. */
function pointsProblem(v: unknown, min: number): Reason | null {
  if (!Array.isArray(v) || !v.every(isPt)) return 'position';
  return v.length < min ? 'shape' : null;
}

class Report {
  dropped: string[] = [];
  count = 0;
  constructor(private suffix = '') {}
  note(text: string, n = 1) {
    this.dropped.push(text + this.suffix);
    this.count += n;
  }
  merge(r: Report) {
    this.dropped.push(...r.dropped);
    this.count += r.count;
  }
}

/** Copy-on-write field fixes: returns `e` itself when nothing changed. */
function patch<T extends Json>(e: T, fix: (set: (k: string, v: unknown) => void, del: (k: string) => void) => void): T {
  let out: Json | null = null;
  const own = () => (out ??= { ...e });
  fix((k, v) => { own()[k] = v; }, (k) => { delete own()[k]; });
  return (out ?? e) as T;
}

/**
 * Present-but-non-finite numbers become `fallback`, or are removed when there is none (optional
 * fields). Missing keys stay missing, and an optional field written as null (Swift nil) is kept.
 */
function fixNumbers(e: Json, fields: Record<string, number | undefined>, set: (k: string, v: unknown) => void, del: (k: string) => void) {
  for (const [k, fallback] of Object.entries(fields)) {
    const v = e[k];
    if (v === undefined || finite(v) || (v === null && fallback === undefined)) continue;
    if (fallback === undefined) del(k);
    else set(k, fallback);
  }
}

/** Filters a collection, counting what was dropped per reason. Returns the same array when nothing changed. */
function list<T>(raw: unknown, singular: string, plural: string, report: Report, check: (e: Json) => Reason | T): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    report.note(`${plural} was not a list`);
    return [];
  }
  const counts = new Map<Reason, number>();
  const out: T[] = [];
  let changed = false;
  for (const e of raw) {
    const r = isObj(e) ? check(e) : 'entry';
    if (typeof r === 'string' && r in REASON_TEXT) {
      counts.set(r as Reason, (counts.get(r as Reason) ?? 0) + 1);
      changed = true;
    } else {
      if (r !== e) changed = true;
      out.push(r as T);
    }
  }
  for (const [r, n] of counts) report.note(`${n} ${n === 1 ? singular : plural} ${REASON_TEXT[r]}`, n);
  return changed ? out : (raw as T[]);
}

// ---------- entries ----------

function area(a: Json): Reason | Area {
  if (!goodId(a.id)) return 'id';
  const bad = pointsProblem(a.polygon, 3);
  if (bad) return bad;
  return patch(a as Area, (set, del) => {
    fixNumbers(a, { elevation: 0 }, set, del);
    if (typeof a.kind !== 'string') set('kind', 'bed');
  });
}

function line(l: Json, report: Report): Reason | Line {
  if (!goodId(l.id)) return 'id';
  const bad = pointsProblem(l.points, 2);
  if (bad) return bad;
  const gates = list(l.gates, 'gate', 'gates', report, (g) => (!goodId(g.id) ? 'id' : finite(g.segment) && finite(g.offset) && finite(g.width) ? g : 'position'));
  return patch(l as Line, (set, del) => {
    if (gates !== l.gates) set('gates', gates);
    fixNumbers(l, { height: 1, thickness: 0.1 }, set, del);
    if (typeof l.kind !== 'string') set('kind', 'fence');
  });
}

function plant(i: Json): Reason | PlantInstance {
  if (!goodId(i.id)) return 'id';
  if (!finite(i.x) || !finite(i.y)) return 'position';
  return patch(i as PlantInstance, (set, del) => {
    if (typeof i.plantId !== 'string') set('plantId', i.plantId == null ? '' : String(i.plantId));
    fixNumbers(i, { plantedYear: 0, installHeight: 0.3, installSpread: 0.3, seed: 1, measuredHeight: undefined, measuredSpread: undefined }, set, del);
    if (i.groupId != null && typeof i.groupId !== 'string') del('groupId');
    if (i.fallback != null) {
      const f = i.fallback;
      if (!isObj(f) || typeof f.category !== 'string' || !finite(f.width) || !finite(f.height) || !finite(f.depth)) del('fallback');
    }
  });
}

function group(g: Json): Reason | PlantGroup {
  if (!goodId(g.id)) return 'id';
  if (g.path != null) { const bad = pointsProblem(g.path, 2); if (bad) return bad; }
  if (g.polygon != null) { const bad = pointsProblem(g.polygon, 3); if (bad) return bad; }
  return patch(g as PlantGroup, (set, del) => {
    const mix = Array.isArray(g.mix) ? g.mix.filter((m: unknown) => isObj(m) && typeof m.plantId === 'string' && finite(m.ratio)) : [];
    if (!Array.isArray(g.mix) || mix.length !== g.mix.length) set('mix', mix);
    const ids = Array.isArray(g.instanceIds) ? g.instanceIds.filter((s: unknown) => typeof s === 'string') : [];
    if (!Array.isArray(g.instanceIds) || ids.length !== g.instanceIds.length) set('instanceIds', ids);
    if (!finite(g.spacing)) set('spacing', 0.6);
    fixNumbers(g, { seed: 1 }, set, del);
  });
}

function object(o: Json): Reason | SiteObject {
  if (!goodId(o.id)) return 'id';
  if (!finite(o.x) || !finite(o.y)) return 'position';
  return patch(o as SiteObject, (set, del) => {
    if (typeof o.catalogId !== 'string') set('catalogId', o.catalogId == null ? 'boulder' : String(o.catalogId));
    fixNumbers(o, { rotation: 0, width: 1, depth: 1, height: 1, elevation: 0 }, set, del);
  });
}

function observation(o: Json): Reason | Observation {
  if (!goodId(o.id)) return 'id';
  if ((o.x != null && !finite(o.x)) || (o.y != null && !finite(o.y))) return 'position';
  return patch(o as Observation, (set, del) => fixNumbers(o, { lat: undefined, lon: undefined, headingDeg: undefined, value: undefined }, set, del));
}

function override(o: Json): Reason | Override {
  if (typeof o.ruleId !== 'string') return 'id';
  // iOS writes site-level overrides with no subjectId (nil) or null; only a wrong type is repaired.
  return patch(o as Override, (set) => {
    if (o.subjectId != null && typeof o.subjectId !== 'string') set('subjectId', String(o.subjectId));
    if (o.note != null && typeof o.note !== 'string') set('note', String(o.note));
  });
}

interface Design { plants: PlantInstance[]; groups: PlantGroup[]; areas: Area[]; lines: Line[]; objects: SiteObject[] }

function design(src: Json, report: Report): Design {
  return {
    areas: list(src.areas, 'area', 'areas', report, area),
    lines: list(src.lines, 'fence or wall', 'fences and walls', report, (l) => line(l, report)),
    plants: list(src.plants, 'plant', 'plants', report, plant),
    groups: list(src.groups, 'plant group', 'plant groups', report, group),
    objects: list(src.objects, 'site object', 'site objects', report, object)
  };
}

function alternative(a: Json, report: Report): Reason | Alternative {
  if (!goodId(a.id)) return 'id';
  if (!isObj(a.snapshot)) return 'entry';
  const sub = new Report(` in alternative “${typeof a.name === 'string' ? a.name : a.id}”`);
  const d = design(a.snapshot, sub);
  report.merge(sub);
  const s = a.snapshot;
  const same = d.plants === s.plants && d.groups === s.groups && d.areas === s.areas && d.lines === s.lines && d.objects === s.objects;
  return patch(a as Alternative, (set) => {
    if (!same) set('snapshot', { ...s, ...d } as DesignSnapshot);
    if (typeof a.name !== 'string') set('name', a.name == null ? 'Alternative' : String(a.name));
    if (typeof a.createdAt !== 'string') set('createdAt', new Date().toISOString());
  });
}

// ---------- top level ----------

function text(v: unknown, fallback: () => string): string {
  if (typeof v === 'string' && v.length) return v;
  if (finite(v)) return String(v);
  return fallback();
}

function timestamp(v: unknown, now: string): string {
  if (typeof v === 'string' && v.length) return v;
  if (finite(v)) { const d = new Date(v); if (Number.isFinite(d.getTime())) return d.toISOString(); }
  return now;
}

function site(raw: unknown, report: Report): Project['site'] {
  const s: Json = isObj(raw) ? raw : {};
  const regionId = typeof s.regionId === 'string' && s.regionId ? s.regionId : 'us-northeast';
  let def: Project['site'] | undefined;
  const d = () => (def ??= defaultSite(regionId));
  return patch(s as Project['site'], (set, del) => {
    if (!isObj(raw)) for (const [k, v] of Object.entries(d())) if (k !== 'location') set(k, v);
    if (s.regionId !== regionId) set('regionId', regionId);
    if (!isObj(s.hardiness) || typeof s.hardiness.zone !== 'string') set('hardiness', d().hardiness);
    if (!isObj(s.frost) || typeof s.frost.lastSpring !== 'string' || typeof s.frost.firstFall !== 'string') set('frost', d().frost);
    if (!isPt(s.north)) set('north', [0, -1]);
    for (const [k, v] of [['sun', 'full'], ['moisture', 'medium'], ['soil', 'loam']] as const) if (typeof s[k] !== 'string') set(k, v);
    if (s.boundary != null && pointsProblem(s.boundary, 3)) { del('boundary'); report.note('the property boundary had invalid points'); }
    if (s.location != null && (!isObj(s.location) || !finite(s.location.lat) || !finite(s.location.lon))) del('location');
    const t = s.terrain;
    if (!isObj(t) || typeof t.kind !== 'string') set('terrain', { kind: 'flat' });
    else if (t.kind === 'points') {
      const pts = Array.isArray(t.points) ? t.points.filter((p: unknown) => Array.isArray(p) && p.length >= 3 && finite(p[0]) && finite(p[1]) && finite(p[2])) : [];
      if (!Array.isArray(t.points) || pts.length !== t.points.length) set('terrain', { ...t, points: pts });
    }
  });
}

function scenario(raw: unknown): Project['scenario'] {
  const s: Json = isObj(raw) ? raw : {};
  const month = finite(s.month) ? clamp(Math.round(s.month), 1, 12) : 6;
  const year = finite(s.year) ? Math.max(0, s.year) : 5;
  // The time slider allows up to 24 (step 0.5), so 24 is a value this app itself writes.
  const hour = finite(s.hour) ? clamp(s.hour, 0, 24) : 14;
  return month === s.month && year === s.year && hour === s.hour ? (s as Project['scenario']) : { ...s, month, year, hour };
}

const BUILDING_LISTS = ['walls', 'doors', 'windows', 'openings', 'sections', 'stories', 'floors', 'objects'];

function building(raw: unknown, report: Report): Project['building'] {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) { report.note('the building could not be read'); return null; }
  return patch(raw as NonNullable<Project['building']>, (set) => {
    for (const k of BUILDING_LISTS) if (raw[k] != null && !Array.isArray(raw[k])) { set(k, []); report.note(`building ${k} was not a list`); }
    if (raw.defaults != null && !isObj(raw.defaults)) set('defaults', {});
  });
}

function web(raw: unknown): Project['web'] {
  const w: Json = isObj(raw) ? raw : {};
  return patch(w as Project['web'], (set, del) => {
    if (w.units !== 'metric' && w.units !== 'imperial') set('units', 'metric');
    fixNumbers(w, { plantingYear: undefined }, set, del);
    if (w.sampleId != null && typeof w.sampleId !== 'string') del('sampleId');
    if (w.layers != null && !isObj(w.layers)) del('layers');
  });
}

/**
 * Coerces an untrusted project into one the planner can open. Valid projects come back unchanged.
 * Also records the report for `takeSanitizeReport()`.
 */
export function sanitizeProject(raw: unknown): SanitizeResult {
  const p: Json = isObj(raw) ? raw : {};
  const report = new Report();
  const now = new Date().toISOString();
  const d = design(p, report);
  const v = p.verification;
  const project: Project = {
    schema: WEB_SCHEMA,
    id: text(p.id, uid),
    name: text(p.name, () => 'Untitled site'),
    createdAt: timestamp(p.createdAt, now),
    updatedAt: timestamp(p.updatedAt, now),
    catalogVersion: typeof p.catalogVersion === 'string' ? p.catalogVersion : 'ol-plants@0.1',
    captureSource: typeof p.captureSource === 'string' ? p.captureSource : 'manual',
    site: site(p.site, report),
    scenario: scenario(p.scenario),
    areas: d.areas,
    lines: d.lines,
    plants: d.plants,
    groups: d.groups,
    objects: d.objects,
    observations: list(p.observations, 'field note', 'field notes', report, observation),
    alternatives: list(p.alternatives, 'alternative', 'alternatives', report, (a) => alternative(a, report)),
    verification: isObj(v) && typeof v.boundary === 'boolean' && isObj(v.measurements)
      ? (v as Project['verification'])
      : { ...(isObj(v) ? v : {}), boundary: isObj(v) ? !!v.boundary : false, measurements: isObj(v) && isObj(v.measurements) ? v.measurements : {} },
    overrides: list(p.overrides, 'check override', 'check overrides', report, override),
    building: building(p.building, report),
    web: web(p.web),
    extra: isObj(p.extra) ? p.extra : {}
  };
  last = { dropped: report.dropped, count: report.count };
  return { project, dropped: report.dropped, count: report.count };
}
