// Design checks — every OL-* rule exactly as defined in EXPORT_FORMAT.md "Design checks".
// Pure functions of (project, catalog); iOS implements the same table, and parity fixtures compare
// `ruleId` + sorted `subjectIds`.
import type { Catalog, Plant } from '../catalog/catalog';
import { commonName, matureSpread, policiesFor, zoneNumber } from '../catalog/catalog';
import type { Area, Moisture, PlantInstance, Project, Sun, Vec2 } from '../model/types';
import { HARD_KINDS } from '../model/types';
import { distToSegment, pointInPolygon, polygonArea, wallSegments } from '../model/geometry';
import { matureRadius } from './growth';

export type Severity = 'error' | 'warning' | 'info';
export const RULE_IDS = ['OL-BLOOMGAP', 'OL-CLEARANCE', 'OL-HARDY', 'OL-INVASIVE', 'OL-ONHARD', 'OL-OUTSIDE', 'OL-OVERLAP', 'OL-SUN', 'OL-UNVERIFIED', 'OL-WATER'] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface CheckResult {
  ruleId: RuleId;
  severity: Severity;
  subjectIds: string[];
  message: string;
  /** Set when a designer override downgraded this result. */
  overridden?: { note: string; originalSeverity: Severity };
}

export const RULE_INFO: Record<RuleId, { severity: Severity; title: string; explain: string }> = {
  'OL-HARDY': { severity: 'error', title: 'Not hardy here', explain: 'The site’s USDA zone is outside the plant’s hardiness range, so it is likely to die in a normal winter (or fail in summer heat).' },
  'OL-INVASIVE': { severity: 'error', title: 'Invasive or restricted', explain: 'The plant is listed as invasive, noxious or prohibited for this region or one of its states. Proposed plants only.' },
  'OL-ONHARD': { severity: 'error', title: 'Planted in hardscape', explain: 'A proposed plant’s centre is inside a patio, path, deck, driveway or water area.' },
  'OL-SUN': { severity: 'warning', title: 'Sun mismatch', explain: 'The exposure at the plant (the innermost area with a sun override, else the site default) is not one the plant tolerates.' },
  'OL-WATER': { severity: 'warning', title: 'Moisture mismatch', explain: 'The soil moisture at the plant (area override, else site default) is not one the plant tolerates.' },
  'OL-OVERLAP': { severity: 'warning', title: 'Crowded at maturity', explain: 'Two plants’ mature canopies overlap by more than half the smaller radius (r1 + r2 − d > 0.5 · min(r1, r2)). Plants in the same group are spaced on purpose and not compared.' },
  'OL-CLEARANCE': { severity: 'warning', title: 'Too close to the building', explain: 'A tree’s mature canopy reaches a building wall (distance to the wall < half its mature spread).' },
  'OL-OUTSIDE': { severity: 'warning', title: 'Outside the property', explain: 'A plant or object centre lies outside the property boundary.' },
  'OL-BLOOMGAP': { severity: 'info', title: 'Bloom gaps', explain: 'Months from April to October with nothing proposed or retained in flower (checked when the plan has at least 5 proposed plants).' },
  'OL-UNVERIFIED': { severity: 'info', title: 'Boundary not verified', explain: 'The property boundary has not been checked against a survey or field measurement.' }
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number) => MONTHS[(m - 1 + 12) % 12];

/** Innermost (smallest-area) containing area that sets the given override. */
function innermost<K extends 'sun' | 'moisture'>(pt: Vec2, areas: Area[], key: K): Area | undefined {
  let best: Area | undefined, bestA = Infinity;
  for (const a of areas) {
    if (a[key] == null || a.polygon.length < 3 || !pointInPolygon(pt, a.polygon)) continue;
    const A = polygonArea(a.polygon);
    if (A < bestA) { best = a; bestA = A; }
  }
  return best;
}
export const exposureAt = (p: Project, pt: Vec2): Sun => (innermost(pt, p.areas, 'sun')?.sun as Sun | undefined) ?? p.site.sun;
export const moistureAt = (p: Project, pt: Vec2): Moisture => (innermost(pt, p.areas, 'moisture')?.moisture as Moisture | undefined) ?? p.site.moisture;

/** Plain code-unit comparison (same on every platform, unlike localeCompare). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortResults(r: CheckResult[]): CheckResult[] {
  return r
    .map((x) => ({ ...x, subjectIds: [...x.subjectIds].sort() }))
    .sort((a, b) => cmp(a.ruleId, b.ruleId) || cmp(a.subjectIds[0] ?? '', b.subjectIds[0] ?? '') || cmp(a.subjectIds.join(','), b.subjectIds.join(',')));
}

/** Runs every rule. Results are sorted by ruleId, then first subject id; overrides are applied. */
export function runChecks(p: Project, cat: Catalog): CheckResult[] {
  const out: CheckResult[] = [];
  const region = cat.region(p.site.regionId);
  const zone = zoneNumber(p.site.hardiness.zone);
  const known: { inst: PlantInstance; plant: Plant }[] = [];
  for (const inst of p.plants) {
    const plant = cat.plant(inst.plantId);
    if (plant) known.push({ inst, plant });
  }
  const name = (pl: Plant) => commonName(pl);

  for (const { inst, plant } of known) {
    const pt: Vec2 = [inst.x, inst.y];
    // OL-HARDY
    if (Number.isFinite(zone) && (zone < plant.hardiness.min || zone > plant.hardiness.max))
      out.push({ ruleId: 'OL-HARDY', severity: 'error', subjectIds: [inst.id], message: `${name(plant)} is hardy in zones ${plant.hardiness.min}–${plant.hardiness.max}; this site is zone ${p.site.hardiness.zone}.` });
    // OL-INVASIVE (proposed only)
    if (inst.status === 'proposed') {
      const bad = policiesFor(plant, region, p.site.regionId).filter((x) => ['invasive', 'noxious', 'prohibited'].includes(x.status));
      if (bad.length)
        out.push({ ruleId: 'OL-INVASIVE', severity: 'error', subjectIds: [inst.id], message: `${name(plant)} is listed ${bad.map((b) => `${b.status} (${b.jurisdiction})`).join(', ')}. Choose a different plant.` });
    }
    // OL-ONHARD (proposed only)
    if (inst.status === 'proposed') {
      const hard = p.areas.find((a) => HARD_KINDS.includes(a.kind) && a.polygon.length >= 3 && pointInPolygon(pt, a.polygon));
      if (hard) out.push({ ruleId: 'OL-ONHARD', severity: 'error', subjectIds: [inst.id], message: `${name(plant)} is placed in ${hard.name || hard.kind}.` });
    }
    // OL-SUN
    const sun = exposureAt(p, pt);
    if (!plant.sun.includes(sun))
      out.push({ ruleId: 'OL-SUN', severity: 'warning', subjectIds: [inst.id], message: `${name(plant)} wants ${plant.sun.join(' / ')} sun; this spot is ${sun}.` });
    // OL-WATER
    const wet = moistureAt(p, pt);
    if (!plant.moisture.includes(wet))
      out.push({ ruleId: 'OL-WATER', severity: 'warning', subjectIds: [inst.id], message: `${name(plant)} wants ${plant.moisture.join(' / ')} soil; this spot is ${wet}.` });
  }

  // OL-OVERLAP — pairwise on mature radii, spatially hashed so large masses stay fast.
  const live = known.filter((k) => k.inst.status !== 'remove');
  const radii = live.map((k) => matureRadius(k.plant));
  const cell = Math.max(0.5, ...radii) * 2;
  const grid = new Map<string, number[]>();
  live.forEach((k, i) => {
    const key = `${Math.floor(k.inst.x / cell)},${Math.floor(k.inst.y / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    const cx = Math.floor(a.inst.x / cell), cy = Math.floor(a.inst.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (j <= i) continue;
        const b = live[j];
        if (a.inst.groupId && a.inst.groupId === b.inst.groupId) continue;
        const r1 = radii[i], r2 = radii[j];
        const d = Math.hypot(a.inst.x - b.inst.x, a.inst.y - b.inst.y);
        if (r1 + r2 - d > 0.5 * Math.min(r1, r2))
          out.push({ ruleId: 'OL-OVERLAP', severity: 'warning', subjectIds: [a.inst.id, b.inst.id], message: `${name(a.plant)} and ${name(b.plant)} will crowd each other at maturity (${d.toFixed(1)} m apart, mature radii ${r1.toFixed(1)} + ${r2.toFixed(1)} m).` });
      }
    }
  }

  // OL-CLEARANCE — trees, conifers and palms against building walls.
  const walls = wallSegments(p.building);
  if (walls.length)
    for (const { inst, plant } of known) {
      if (!['tree', 'conifer', 'palm'].includes(plant.form)) continue;
      const pt: Vec2 = [inst.x, inst.y];
      const d = Math.min(...walls.map((w) => distToSegment(pt, w.a, w.b)));
      if (d < 0.5 * matureSpread(plant))
        out.push({ ruleId: 'OL-CLEARANCE', severity: 'warning', subjectIds: [inst.id], message: `${name(plant)} is ${d.toFixed(1)} m from the building; its mature canopy is ${matureSpread(plant).toFixed(1)} m wide.` });
    }

  // OL-OUTSIDE
  const boundary = p.site.boundary;
  if (boundary && boundary.length >= 3) {
    for (const inst of p.plants)
      if (!pointInPolygon([inst.x, inst.y], boundary))
        out.push({ ruleId: 'OL-OUTSIDE', severity: 'warning', subjectIds: [inst.id], message: `${cat.plant(inst.plantId) ? name(cat.plant(inst.plantId)!) : 'A plant'} is outside the property boundary.` });
    for (const o of p.objects)
      if (!pointInPolygon([o.x, o.y], boundary))
        out.push({ ruleId: 'OL-OUTSIDE', severity: 'warning', subjectIds: [o.id], message: `${o.catalogId.replace(/_/g, ' ')} is outside the property boundary.` });
  }

  // OL-BLOOMGAP
  const proposed = known.filter((k) => k.inst.status === 'proposed');
  if (proposed.length >= 5) {
    const flowering = known.filter((k) => k.inst.status === 'proposed' || k.inst.status === 'retain');
    const gaps: number[] = [];
    for (let m = 4; m <= 10; m++) if (!flowering.some((k) => k.plant.bloom?.months.includes(m))) gaps.push(m);
    if (gaps.length)
      out.push({ ruleId: 'OL-BLOOMGAP', severity: 'info', subjectIds: [], message: `Nothing is in flower in ${gaps.map(monthName).join(', ')}.` });
  }

  // OL-UNVERIFIED
  if (boundary && boundary.length >= 3 && !p.verification?.boundary)
    out.push({ ruleId: 'OL-UNVERIFIED', severity: 'info', subjectIds: [], message: 'The property boundary is not verified. Check it against a survey before building fences or walls on it.' });

  return applyOverrides(sortResults(out), p);
}

/** An override with matching ruleId and subjectId downgrades the result to `info` and appends the note. */
export function applyOverrides(results: CheckResult[], p: Project): CheckResult[] {
  return results.map((r) => {
    const o = (p.overrides ?? []).find((x) => x.ruleId === r.ruleId && (r.subjectIds.length ? r.subjectIds.includes(x.subjectId) : x.subjectId === '' || x.subjectId === p.id));
    if (!o) return r;
    return { ...r, severity: 'info', message: `${r.message} Override: ${o.note}`, overridden: { note: o.note, originalSeverity: r.severity } };
  });
}

/** What parity fixtures compare. */
export const checkKeys = (r: CheckResult[]) => r.map((x) => ({ ruleId: x.ruleId, subjectIds: [...x.subjectIds].sort() }));
