// Project model. Field names and units (metres, plan x → world X, plan y → world Z, +y down on
// screen) follow the `openlandscape3d` block in openlandscape3d-ios/docs/EXPORT_FORMAT.md, so the
// web project *is* that block plus a few web-only fields. Entries are kept as plain objects and
// edited with spreads, so unknown keys written by another producer survive a round trip.

export type Vec2 = [number, number];
export type Polygon = Vec2[];

export type Sun = 'full' | 'part' | 'shade';
export type Moisture = 'dry' | 'medium' | 'wet';
export type Soil = 'sand' | 'loam' | 'clay';
export type Status = 'proposed' | 'existing' | 'retain' | 'remove';

export const AREA_KINDS = ['lawn', 'bed', 'mulch', 'gravel', 'patio', 'path', 'deck', 'driveway', 'water'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
/** Areas a proposed plant may not be centred in (OL-ONHARD). */
export const HARD_KINDS: readonly AreaKind[] = ['patio', 'path', 'deck', 'driveway', 'water'];

export const LINE_KINDS = ['fence', 'retaining_wall', 'edging'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export type LineStyle = 'board' | 'picket' | 'metal' | 'rail' | 'stone' | 'block' | 'steel';

export const INSTALL_SIZES = ['#1', '#3', '#5', '#7', '#15', 'plug', 'flat', 'bareroot', 'BB-1.5in', 'BB-2in', 'BB-3in', 'existing'] as const;
export type InstallSize = (typeof INSTALL_SIZES)[number];

export interface Site {
  location?: { lat: number; lon: number; precision: 'coarse' | 'precise'; [k: string]: unknown };
  regionId: string;
  hardiness: { system: 'USDA'; zone: string };
  frost: { lastSpring: string; firstFall: string };
  north: Vec2;
  sun: Sun;
  moisture: Moisture;
  soil: Soil;
  boundary?: Polygon;
  terrain: { kind: 'flat' } | { kind: 'points'; points: [number, number, number][] };
  [k: string]: unknown;
}

export interface Scenario { month: number; year: number; hour: number }

export interface Area {
  id: string;
  kind: AreaKind;
  name: string;
  materialId?: string;
  polygon: Polygon;
  elevation: number;
  sun?: Sun;
  moisture?: Moisture;
  [k: string]: unknown;
}

export interface Gate { id: string; segment: number; offset: number; width: number; [k: string]: unknown }

export interface Line {
  id: string;
  kind: LineKind;
  style: LineStyle;
  points: Vec2[];
  height: number;
  thickness: number;
  gates: Gate[];
  materialId?: string;
  [k: string]: unknown;
}

export interface PlantInstance {
  id: string;
  plantId: string;
  x: number;
  y: number;
  status: Status;
  plantedYear: number;
  installSize: InstallSize | string;
  installHeight: number;
  installSpread: number;
  groupId?: string;
  condition?: 'good' | 'fair' | 'poor' | 'dead';
  measuredHeight?: number;
  measuredSpread?: number;
  seed: number;
  note?: string;
  /** Web-internal: what OpenPlan3D object this came in as, for unknown plant ids. Kept on re-export. */
  fallback?: { category: string; width: number; height: number; depth: number };
  [k: string]: unknown;
}

export type GroupKind = 'row' | 'mass' | 'grid';
export interface PlantGroup {
  id: string;
  kind: GroupKind;
  mix: { plantId: string; ratio: number }[];
  spacing: number;
  path?: Vec2[];
  polygon?: Polygon;
  seed: number;
  instanceIds: string[];
  [k: string]: unknown;
}

export interface SiteObject {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  /** Degrees, front = (−sin r, cos r). */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  status: Status;
  [k: string]: unknown;
}

export interface Observation {
  id: string;
  kind: 'note' | 'photo' | 'issue' | 'measurement' | 'inventory';
  createdAt: string;
  author: string;
  x?: number; y?: number;
  lat?: number; lon?: number; headingDeg?: number;
  text?: string;
  photoFile?: string;
  value?: number; unit?: string;
  plantInstanceId?: string;
  resolved?: boolean;
  [k: string]: unknown;
}

export interface DesignSnapshot {
  plants: PlantInstance[];
  groups: PlantGroup[];
  areas: Area[];
  lines: Line[];
  objects: SiteObject[];
}
export interface Alternative { id: string; name: string; createdAt: string; snapshot: DesignSnapshot; [k: string]: unknown }

export interface Override { ruleId: string; subjectId: string; note: string; [k: string]: unknown }

/** Verbatim OpenPlan3D building arrays (prepared RoomPlan JSON, metres). */
export interface Building {
  walls: any[];
  doors: any[];
  windows: any[];
  openings: any[];
  sections: any[];
  stories: any[];
  floors: any[];
  defaults: Record<string, unknown>;
  /** Non-landscape OpenPlan3D objects (furniture etc.), passed through unchanged. */
  objects?: any[];
  [k: string]: unknown;
}

export type LayerId = 'building' | 'hardscape' | 'planting' | 'labels';

/** Web-only data in `openlandscape3d.web`; iOS stores it verbatim and writes it back. */
export interface WebExtras {
  units: 'metric' | 'imperial';
  /** Calendar year the planting happens; schedules are dated from it. Default: year of createdAt. */
  plantingYear?: number;
  layers?: Partial<Record<LayerId, boolean>>;
  ghostRings?: boolean;
  [k: string]: unknown;
}

export const WEB_SCHEMA = 'openlandscape3d/web-project@0.1';
export const BLOCK_SCHEMA = 'openlandscape3d/project@0.1';

export interface Project {
  schema: typeof WEB_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  catalogVersion: string;
  captureSource: 'manual' | 'gps-walk' | 'ar' | 'openplan' | 'template' | string;
  site: Site;
  scenario: Scenario;
  areas: Area[];
  lines: Line[];
  plants: PlantInstance[];
  groups: PlantGroup[];
  objects: SiteObject[];
  observations: Observation[];
  alternatives: Alternative[];
  verification: { boundary: boolean; measurements: Record<string, boolean>; [k: string]: unknown };
  overrides: Override[];
  building: Building | null;
  web: WebExtras;
  /** Unknown top-level keys of the `openlandscape3d` block, re-emitted verbatim. */
  extra: Record<string, unknown>;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/** Deterministic UUID-shaped id from a string key (FNV-1a based). Same key → same id. */
export function stableId(key: string): string {
  const h = (seed: number) => {
    let x = 0x811c9dc5 ^ seed;
    for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const s = h(1) + h(2) + h(3) + h(4);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${'89ab'[parseInt(s[16], 16) & 3]}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** Deep copy of plain JSON data. Unlike structuredClone it also accepts Svelte state proxies. */
export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const snapshotOf = (p: Project): DesignSnapshot => clone({ plants: p.plants, groups: p.groups, areas: p.areas, lines: p.lines, objects: p.objects });
