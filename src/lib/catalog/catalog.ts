// The shared regional plant catalog (schema: openlandscape3d-www/catalog/README.md).
// `npm run catalog` copies the published data files next to this module. Everything that reads
// plant facts takes a `Catalog`, so tests can run against tests/fixtures/catalog.
import plantsData from './plants.json';
import regionsData from './regions.json';
import materialsData from './materials.json';
import rulesData from './schedule-rules.json';
import type { Moisture, Soil, Sun } from '../model/types';

export type Form = 'tree' | 'conifer' | 'palm' | 'shrub' | 'perennial' | 'grass' | 'groundcover' | 'vine' | 'succulent';
export const FORMS: Form[] = ['tree', 'conifer', 'palm', 'shrub', 'grass', 'perennial', 'groundcover', 'vine', 'succulent'];
export type Leaf = 'deciduous' | 'evergreen' | 'semi-evergreen' | 'herbaceous';
export type Level = 'low' | 'medium' | 'high';

export interface Plant {
  id: string;
  aliases?: string[];
  scientificName: string;
  authorship?: string | null;
  cultivar?: string | null;
  family: string;
  genus: string;
  commonNames: { name: string; lang: string; preferred?: boolean }[];
  synonyms?: string[];
  form: Form;
  leaf: Leaf;
  mature: { heightM: [number, number]; spreadM: [number, number] };
  growthRate: 'slow' | 'medium' | 'fast';
  yearsToMaturity?: number;
  sun: Sun[];
  moisture: Moisture[];
  soil?: Soil[];
  ph?: [number, number] | null;
  hardiness: { system: 'USDA'; min: number; max: number };
  bloom: { months: number[]; color: string; colorName?: string } | null;
  foliageColor: string;
  fallColor?: string | null;
  nativeRegionIds: string[];
  nativeRange?: string;
  waterUse?: Level;
  maintenance?: Level;
  deerResistance?: Level;
  wildlife?: string[];
  tags?: string[];
  spacingM: number;
  defaultInstallSize: string;
  installSizes: { code: string; heightM: number; spreadM: number }[];
  policy?: { jurisdiction: string; status: string; sourceId?: string; effective?: string }[];
  summary?: string;
  designNotes?: string[];
  representation?: { openplanProxy?: string; symbol2d?: string; crown?: string };
  externalIds?: Record<string, unknown>;
  provenance?: { fields: string[] | '*'; sourceId: string; retrieved?: string; method?: string; reviewStatus: string; confidence: string }[];
  quality?: { score: number; indexable: boolean };
}

export interface Region {
  id: string;
  name: string;
  country: string;
  states: string[];
  hardinessZones: string[];
  defaultZone: string;
  frost: { lastSpring: string; firstFall: string };
  climate?: string;
  precipitationMm?: number;
  summary?: string;
  designGuidance?: string[];
  ecoregions?: string[];
}

export interface Material {
  id: string;
  kind: 'surface' | 'fence' | 'edging' | 'wall';
  appliesTo: string[];
  name: string;
  color: string;
  unit: 'm2' | 'm' | 'm3';
  priceUsd?: { low: number; high: number };
  notes?: string;
}

export interface ScheduleWindow { anchor: 'lastSpring' | 'firstFall'; startDays: number; endDays: number; alternate?: boolean }
export interface ScheduleRule {
  id: string;
  task: string;
  label: string;
  appliesTo: { forms?: string[]; leaf?: string[]; tags?: string[] };
  windows: ScheduleWindow[];
  recurrence: string;
  constraints?: string;
  sourceId: string;
  confidence: string;
}

export interface CatalogData {
  catalogVersion: string;
  plants: Plant[];
  regions: Region[];
  materials: Material[];
  rules: ScheduleRule[];
  fixture?: boolean;
}

export class Catalog {
  readonly version: string;
  readonly plants: Plant[];
  readonly regions: Region[];
  readonly materials: Material[];
  readonly rules: ScheduleRule[];
  readonly fixture: boolean;
  private byId = new Map<string, Plant>();

  constructor(d: CatalogData) {
    this.version = d.catalogVersion;
    this.plants = d.plants;
    this.regions = d.regions;
    this.materials = d.materials;
    this.rules = d.rules;
    this.fixture = !!d.fixture;
    for (const p of d.plants) this.byId.set(p.id, p);
    for (const p of d.plants) for (const a of p.aliases ?? []) if (!this.byId.has(a)) this.byId.set(a, p);
  }

  /** Resolves ids and aliases; `undefined` for an unknown plant (shown as a placeholder, never dropped). */
  plant(id: string): Plant | undefined {
    return this.byId.get(id);
  }
  region(id: string): Region | undefined {
    return this.regions.find((r) => r.id === id);
  }
  material(id: string | undefined): Material | undefined {
    return id ? this.materials.find((m) => m.id === id) : undefined;
  }
  materialsFor(kind: string): Material[] {
    return this.materials.filter((m) => m.appliesTo.includes(kind));
  }
}

export const catalog = new Catalog({
  catalogVersion: (plantsData as any).catalogVersion ?? 'ol-plants@0.1',
  plants: (plantsData as any).plants as Plant[],
  regions: (regionsData as any).regions as Region[],
  materials: (materialsData as any).materials as Material[],
  rules: (rulesData as any).rules as ScheduleRule[],
  fixture: !!(plantsData as any).fixture
});

// ---------- plant helpers ----------

export const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
export const matureHeight = (p: Plant) => mid(p.mature.heightM);
export const matureSpread = (p: Plant) => mid(p.mature.spreadM);
export const commonName = (p: Plant) => (p.commonNames.find((n) => n.preferred && n.lang === 'en') ?? p.commonNames.find((n) => n.preferred) ?? p.commonNames[0])?.name ?? p.scientificName;
export const displayScientific = (p: Plant) => (p.cultivar ? `${p.scientificName} '${p.cultivar}'` : p.scientificName);

/** Size at planting for an install-size code, falling back to the catalog default or a fraction of mature size. */
export function installDims(p: Plant, code?: string): { code: string; heightM: number; spreadM: number } {
  const c = code ?? p.defaultInstallSize;
  const hit = p.installSizes.find((s) => s.code === c) ?? p.installSizes.find((s) => s.code === p.defaultInstallSize) ?? p.installSizes[0];
  if (hit) return { code: c, heightM: hit.heightM, spreadM: hit.spreadM };
  return { code: c, heightM: Math.max(0.1, matureHeight(p) * 0.2), spreadM: Math.max(0.1, matureSpread(p) * 0.2) };
}

export const zoneNumber = (zone: string) => parseInt(zone, 10);

export function isDraft(p: Plant) {
  return !p.provenance?.length || p.provenance.some((x) => x.reviewStatus !== 'reviewed');
}

/** Policy entries that apply to a region (by region id or one of its states, `US-XX`). */
export function policiesFor(p: Plant, region: Region | undefined, regionId: string) {
  const juris = new Set([regionId, ...(region?.states ?? []).map((s) => `US-${s}`), ...(region?.states ?? [])]);
  return (p.policy ?? []).filter((x) => juris.has(x.jurisdiction));
}

export function isNativeTo(p: Plant, regionId: string) {
  return p.nativeRegionIds.includes(regionId);
}
