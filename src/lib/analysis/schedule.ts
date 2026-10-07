// Plant schedule (quantities) and task schedule (dated care windows) — EXPORT_FORMAT.md
// "Schedule" and "Quantities / plant schedule CSV".
import type { Catalog, Form, Plant, ScheduleRule } from '../catalog/catalog';
import { FORMS, commonName, displayScientific, isNativeTo, matureHeight, matureSpread, policiesFor } from '../catalog/catalog';
import type { Project } from '../model/types';

export interface PlantScheduleRow {
  code: string;
  plantId: string;
  scientific_name: string;
  common_name: string;
  quantity: number;
  install_size: string;
  spacing_m: number;
  mature_height_m: number;
  mature_spread_m: number;
  native: boolean;
  notes: string;
  form: Form | 'unknown';
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function speciesCode(sci: string): string {
  const [genus = '', species = ''] = sci.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
  return (genus.slice(0, 2) + species.slice(0, 2)).toUpperCase() || 'XX';
}

/** One row per plantId + installSize for proposed plants, sorted by form then scientific name. */
export function plantSchedule(p: Project, cat: Catalog): PlantScheduleRow[] {
  const rows = new Map<string, PlantScheduleRow>();
  for (const inst of p.plants) {
    if (inst.status !== 'proposed') continue;
    const key = `${inst.plantId}|${inst.installSize}`;
    const row = rows.get(key);
    if (row) { row.quantity++; continue; }
    const plant = cat.plant(inst.plantId);
    rows.set(key, plant ? rowFor(plant, inst.plantId, String(inst.installSize), p, cat) : {
      code: '', plantId: inst.plantId, scientific_name: inst.plantId, common_name: 'Unknown plant', quantity: 1,
      install_size: String(inst.installSize), spacing_m: 0, mature_height_m: 0, mature_spread_m: 0, native: false,
      notes: 'Not in this catalog version', form: 'unknown'
    });
  }
  const formIndex = (f: string) => { const i = FORMS.indexOf(f as Form); return i < 0 ? 99 : i; };
  const list = [...rows.values()].sort((a, b) => formIndex(a.form) - formIndex(b.form) || a.scientific_name.localeCompare(b.scientific_name) || a.install_size.localeCompare(b.install_size));
  // Codes are per plant id; a second species with the same code gets a numeric suffix (ACRU, ACRU2…).
  const byPlant = new Map<string, string>();
  const used = new Map<string, number>();
  for (const row of list) {
    let code = byPlant.get(row.plantId);
    if (!code) {
      const base = speciesCode(row.scientific_name);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      code = n === 1 ? base : `${base}${n}`;
      byPlant.set(row.plantId, code);
    }
    row.code = code;
  }
  return list;
}

function rowFor(plant: Plant, plantId: string, size: string, p: Project, cat: Catalog): PlantScheduleRow {
  const notes: string[] = [];
  if (plant.cultivar) notes.push(`cultivar ${plant.cultivar}`);
  const pol = policiesFor(plant, cat.region(p.site.regionId), p.site.regionId);
  if (pol.length) notes.push(pol.map((x) => `${x.status} in ${x.jurisdiction}`).join('; '));
  if (plant.provenance?.some((x) => x.reviewStatus !== 'reviewed')) notes.push('draft data, unreviewed');
  return {
    code: '', plantId, scientific_name: displayScientific(plant), common_name: commonName(plant), quantity: 1, install_size: size,
    spacing_m: r2(plant.spacingM), mature_height_m: r2(matureHeight(plant)), mature_spread_m: r2(matureSpread(plant)),
    native: isNativeTo(plant, p.site.regionId), notes: notes.join('; '), form: plant.form
  };
}

// ---------- task schedule ----------

export interface TaskRow {
  ruleId: string;
  task: string;
  taskCode: string;
  plantId: string;
  plant: string;
  scientific_name: string;
  quantity: number;
  start: string;
  end: string;
  alternate: boolean;
  recurrence: string;
  source: string;
  confidence: string;
  constraints: string;
}

/** The calendar year plants go in: `web.plantingYear`, else the year the project was created. */
export function plantingYear(p: Project): number {
  return p.web?.plantingYear ?? (parseInt(p.createdAt?.slice(0, 4), 10) || new Date().getFullYear());
}

export function anchorDate(year: number, mmdd: string, offsetDays: number): Date {
  const [m, d] = mmdd.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, d + offsetDays));
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function ruleApplies(rule: ScheduleRule, plant: Plant): boolean {
  const a = rule.appliesTo ?? {};
  if (a.forms?.length && !a.forms.includes(plant.form)) return false;
  if (a.leaf?.length && !a.leaf.includes(plant.leaf)) return false;
  if (a.tags?.length && !a.tags.some((t) => plant.tags?.includes(t))) return false;
  return true;
}

/** For each distinct proposed plant and each matching rule, every window dated from `site.frost`. */
export function taskSchedule(p: Project, cat: Catalog): TaskRow[] {
  const year = plantingYear(p);
  const qty = new Map<string, number>();
  for (const i of p.plants) if (i.status === 'proposed' && cat.plant(i.plantId)) qty.set(i.plantId, (qty.get(i.plantId) ?? 0) + 1);
  const rows: TaskRow[] = [];
  for (const [plantId, n] of qty) {
    const plant = cat.plant(plantId)!;
    for (const rule of cat.rules) {
      if (!ruleApplies(rule, plant)) continue;
      for (const w of rule.windows) {
        const anchor = w.anchor === 'firstFall' ? p.site.frost.firstFall : p.site.frost.lastSpring;
        rows.push({
          ruleId: rule.id,
          task: w.alternate ? `${rule.label} (alternate window)` : rule.label,
          taskCode: rule.task,
          plantId,
          plant: commonName(plant),
          scientific_name: displayScientific(plant),
          quantity: n,
          start: isoDate(anchorDate(year, anchor, w.startDays)),
          end: isoDate(anchorDate(year, anchor, w.endDays)),
          alternate: !!w.alternate,
          recurrence: rule.recurrence,
          source: rule.sourceId,
          confidence: rule.confidence,
          constraints: rule.constraints ?? ''
        });
      }
    }
  }
  return rows.sort((a, b) => a.start.localeCompare(b.start) || a.task.localeCompare(b.task) || a.scientific_name.localeCompare(b.scientific_name));
}

/** Months 1–12 → proposed/retained plant ids in bloom, for the bloom calendar. */
export function bloomCalendar(p: Project, cat: Catalog): { plantId: string; name: string; color: string; months: number[]; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of p.plants) if ((i.status === 'proposed' || i.status === 'retain' || i.status === 'existing') && cat.plant(i.plantId)?.bloom) counts.set(i.plantId, (counts.get(i.plantId) ?? 0) + 1);
  return [...counts].map(([id, count]) => {
    const pl = cat.plant(id)!;
    return { plantId: id, name: commonName(pl), color: pl.bloom!.color, months: pl.bloom!.months, count };
  }).sort((a, b) => Math.min(...a.months) - Math.min(...b.months) || a.name.localeCompare(b.name));
}
