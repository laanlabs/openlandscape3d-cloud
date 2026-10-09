// Hash routes, parsed without touching the DOM so they can be unit-tested.
//
//   #/p/<id>[?plants=a,b&tool=row]          open a saved site (optionally with plants armed for placement)
//   #/print/<id>                            print sheet
//   #/sample/<id>[?plants=…&tool=…]         open (or reuse) your copy of a sample garden
//   #/new?plants=…&region=…&zone=…&state=…&template=…&units=…&tool=…&name=…   start a site
//   #/import/v1/<payload>, #/view/v1/<payload>   transfer and view-only links (payload may contain '/', never '?')
//
// Query parameters come from the marketing site (plant pages, tools, guides), so every value is
// validated against the catalog before use; anything unknown falls back to a safe default.
import type { Catalog } from '../catalog/catalog';
import type { NewSiteOptions, TemplateId } from '../site/templates';
import type { PlacementTool } from '../ui/editor.svelte';

export interface ParsedRoute {
  head: string;
  rest: string[];
  query: URLSearchParams;
}

export function parseRoute(hash: string): ParsedRoute {
  const h = hash.replace(/^#\/?/, '');
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  const [head = '', ...rest] = path.split('/');
  return { head, rest, query };
}

const PLACEMENT: PlacementTool[] = ['plant', 'row', 'mass', 'grid'];
const TEMPLATE_IDS: TemplateId[] = ['blank', 'rect', 'backyard', 'frontyard'];
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_PLANTS = 24;

/** Plants to arm for placement from `?plants=a,b&tool=row`; ids are syntax-checked here and catalog-checked by the editor. */
export function parseArm(query: URLSearchParams): { plantIds: string[]; tool?: PlacementTool } | null {
  const plantIds = [...new Set((query.get('plants') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => ID.test(s)))].slice(0, MAX_PLANTS);
  if (!plantIds.length) return null;
  const t = query.get('tool') as PlacementTool | null;
  return { plantIds, tool: t && PLACEMENT.includes(t) ? t : undefined };
}

/** The query string that carries an arm on to the next route ('' when there is none). */
export function armQuery(arm: { plantIds: string[]; tool?: PlacementTool } | null): string {
  if (!arm) return '';
  const q = new URLSearchParams({ plants: arm.plantIds.join(',') });
  if (arm.tool) q.set('tool', arm.tool);
  return `?${q.toString()}`;
}

/** Options for `#/new`, validated against the catalog; unknown or missing values fall back to defaults. */
export function newSiteOptions(query: URLSearchParams, cat: Catalog, allZones: string[]): NewSiteOptions {
  const state = (query.get('state') ?? '').toUpperCase();
  const stateRegion = /^[A-Z]{2}$/.test(state) ? cat.regions.find((r) => r.states.includes(state)) : undefined;
  const region = cat.region(query.get('region') ?? '') ?? stateRegion ?? cat.regions[0];
  const zoneQ = (query.get('zone') ?? '').toLowerCase();
  // A bare number ("7") means the region's typical half-zone for it, else the 'a' half.
  const zone = allZones.includes(zoneQ) ? zoneQ
    : /^\d{1,2}$/.test(zoneQ) ? (region?.hardinessZones.find((z) => z.startsWith(zoneQ) && /^\d+[ab]$/.test(z) && parseInt(z, 10) === Number(zoneQ)) ?? (allZones.includes(`${zoneQ}a`) ? `${zoneQ}a` : undefined))
    : undefined;
  const template = query.get('template') as TemplateId | null;
  const units = query.get('units');
  const name = (query.get('name') ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return {
    name: name || 'My garden',
    units: units === 'metric' ? 'metric' : 'imperial',
    regionId: region?.id ?? 'us-northeast',
    zone: zone ?? region?.defaultZone,
    state: stateRegion && stateRegion.id === region?.id ? state : undefined,
    template: template && TEMPLATE_IDS.includes(template) ? template : 'backyard'
  };
}
