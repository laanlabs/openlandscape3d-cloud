// Deterministic growth and season models — EXPORT_FORMAT.md "Deterministic models". Must match iOS.
import type { Plant } from '../catalog/catalog';
import { matureHeight, matureSpread } from '../catalog/catalog';
import type { PlantInstance, Site } from '../model/types';

export const GROWTH_K = { slow: 0.12, medium: 0.25, fast: 0.45 } as const;

/** s(t) = sm − (sm − s0) · exp(−k · t), t clamped at 0. */
export function grow(s0: number, sm: number, k: number, t: number): number {
  if (!(t > 0)) return s0;
  return sm - (sm - s0) * Math.exp(-k * t);
}

/** Years of growth for an instance at scenario year `year`. */
export function ageAt(inst: Pick<PlantInstance, 'plantedYear' | 'status' | 'measuredHeight' | 'measuredSpread'>, year: number): number {
  // Existing plants with a field measurement are their measured size at project year 0.
  if (hasMeasurement(inst)) return Math.max(0, year);
  return Math.max(0, year - (inst.plantedYear ?? 0));
}

const hasMeasurement = (i: Pick<PlantInstance, 'status' | 'measuredHeight' | 'measuredSpread'>) =>
  (i.status === 'existing' || i.status === 'retain' || i.status === 'remove') && (i.measuredHeight != null || i.measuredSpread != null);

export interface Size { height: number; spread: number }

/** Height and spread (metres) of a plant instance in scenario year `year`. */
export function sizeAt(inst: PlantInstance, plant: Plant | undefined, year: number): Size {
  if (!plant) {
    // Unknown plant: keep the size it arrived with; no growth model without facts.
    if (inst.fallback) return { height: inst.fallback.height, spread: Math.max(inst.fallback.width, inst.fallback.depth) };
    return { height: inst.measuredHeight ?? inst.installHeight ?? 1, spread: inst.measuredSpread ?? inst.installSpread ?? 1 };
  }
  const k = GROWTH_K[plant.growthRate] ?? GROWTH_K.medium;
  const t = ageAt(inst, year);
  const measured = hasMeasurement(inst);
  const h0 = measured && inst.measuredHeight != null ? inst.measuredHeight : inst.installHeight;
  const w0 = measured && inst.measuredSpread != null ? inst.measuredSpread : inst.installSpread;
  return { height: grow(h0, matureHeight(plant), k, t), spread: grow(w0, matureSpread(plant), k, t) };
}

/** Mature radius used by OL-OVERLAP and the ghost rings: mature spread midpoint / 2. */
export const matureRadius = (p: Plant) => matureSpread(p) / 2;

// ---------- seasons (visual only) ----------

export const frostMonth = (mmdd: string) => parseInt(mmdd.slice(0, 2), 10);

/** Deciduous plants are leafless strictly after the first-fall-frost month or strictly before the last-spring-frost month. */
export function leafOff(plant: Pick<Plant, 'leaf'>, month: number, frost: Site['frost']): boolean {
  if (plant.leaf !== 'deciduous') return false;
  return month > frostMonth(frost.firstFall) || month < frostMonth(frost.lastSpring);
}

/** Herbaceous plants die back over the same months (visual only; not a contract rule). */
export function dormant(plant: Pick<Plant, 'leaf'>, month: number, frost: Site['frost']): boolean {
  if (plant.leaf !== 'herbaceous') return false;
  return month > frostMonth(frost.firstFall) || month < frostMonth(frost.lastSpring);
}

export const inBloom = (plant: Pick<Plant, 'bloom'>, month: number) => !!plant.bloom?.months.includes(month);

/** Fall colour shows in the first-fall-frost month and the month before it. */
export function inFallColor(plant: Pick<Plant, 'fallColor' | 'leaf'>, month: number, frost: Site['frost']): boolean {
  if (!plant.fallColor) return false;
  const f = frostMonth(frost.firstFall);
  return month === f || month === (f === 1 ? 12 : f - 1);
}

export interface SeasonLook {
  foliage: string;
  bloom: string | null;
  leafOff: boolean;
  dormant: boolean;
  fall: boolean;
}

export function seasonLook(plant: Plant, month: number, frost: Site['frost']): SeasonLook {
  const off = leafOff(plant, month, frost);
  const dorm = dormant(plant, month, frost);
  const fall = !off && !dorm && inFallColor(plant, month, frost);
  return {
    foliage: dorm ? '#b59f78' : off ? '#7a6a5a' : fall ? plant.fallColor! : plant.foliageColor,
    bloom: !off && !dorm && inBloom(plant, month) ? plant.bloom!.color : null,
    leafOff: off,
    dormant: dorm,
    fall
  };
}
