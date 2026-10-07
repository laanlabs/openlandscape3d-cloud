import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Catalog } from '../src/lib/catalog/catalog';
import { normalizeProject } from '../src/lib/io/openplan';
import type { Area, PlantInstance, Project, Vec2 } from '../src/lib/model/types';
import { installDims } from '../src/lib/catalog/catalog';

const dir = join(__dirname, 'fixtures/catalog');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

/** The small schema-valid catalog in tests/fixtures/catalog — stable regardless of the shipped catalog. */
export function fixtureCatalog(): Catalog {
  const plants = read('plants.json');
  return new Catalog({ catalogVersion: plants.catalogVersion, plants: plants.plants, regions: read('regions.json').regions, materials: read('materials.json').materials, rules: read('schedule-rules.json').rules, fixture: true });
}

export const cat = fixtureCatalog();

let n = 0;
export const id = (tag = 'x') => `00000000-0000-4000-8000-${tag.padStart(4, '0').slice(-4)}${(++n).toString(16).padStart(8, '0')}`;

export function site(overrides: Partial<Project['site']> = {}): Project['site'] {
  return { regionId: 'us-northeast', hardiness: { system: 'USDA', zone: '6b' }, frost: { lastSpring: '04-25', firstFall: '10-15' }, north: [0, -1], sun: 'full', moisture: 'medium', soil: 'loam', terrain: { kind: 'flat' }, ...overrides };
}

export function project(over: Partial<Project> = {}): Project {
  return normalizeProject({ id: '00000000-0000-4000-8000-000000000001', name: 'Test', createdAt: '2027-01-10T00:00:00.000Z', updatedAt: '2027-01-10T00:00:00.000Z', site: site(), web: { units: 'metric' }, ...over });
}

export function plant(plantId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance {
  const p = cat.plant(plantId);
  const d = p ? installDims(p) : { code: '#1', heightM: 0.3, spreadM: 0.3 };
  return { id: id('p'), plantId, x, y, status: 'proposed', plantedYear: 0, installSize: d.code, installHeight: d.heightM, installSpread: d.spreadM, seed: 1, ...over };
}

export function area(kind: Area['kind'], polygon: Vec2[], over: Partial<Area> = {}): Area {
  return { id: id('a'), kind, name: kind, polygon, elevation: 0, ...over };
}

export const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
