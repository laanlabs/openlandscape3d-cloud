// Region / climate resolution: pilot region → zone, frost dates and a coarse location.
import { catalog as defaultCatalog, type Catalog } from '../catalog/catalog';
import type { Site } from '../model/types';

/** Approximate state centres (coarse location for the sun model; never presented as the site's address). */
export const STATE_CENTERS: Record<string, [number, number, string]> = {
  AL: [32.8, -86.8, 'Alabama'], AZ: [34.3, -111.7, 'Arizona'], CT: [41.6, -72.7, 'Connecticut'], DE: [39.0, -75.5, 'Delaware'],
  FL: [28.6, -82.4, 'Florida'], GA: [32.7, -83.4, 'Georgia'], MA: [42.3, -71.8, 'Massachusetts'], MD: [39.0, -76.8, 'Maryland'],
  ME: [45.4, -69.2, 'Maine'], NC: [35.5, -79.4, 'North Carolina'], NH: [43.7, -71.6, 'New Hampshire'], NJ: [40.2, -74.7, 'New Jersey'],
  NM: [34.4, -106.1, 'New Mexico'], NV: [39.3, -116.6, 'Nevada'], NY: [42.9, -75.5, 'New York'], PA: [40.9, -77.8, 'Pennsylvania'],
  RI: [41.7, -71.5, 'Rhode Island'], SC: [33.9, -80.9, 'South Carolina'], TN: [35.9, -86.4, 'Tennessee'], TX: [31.5, -99.3, 'Texas'],
  UT: [39.3, -111.7, 'Utah'], VA: [37.5, -78.9, 'Virginia'], VT: [44.1, -72.7, 'Vermont'], WV: [38.6, -80.6, 'West Virginia'],
  CA: [37.2, -119.5, 'California'], CO: [39.0, -105.5, 'Colorado'], MS: [32.7, -89.7, 'Mississippi'], LA: [31.0, -92.0, 'Louisiana']
};

/** Region centre: mean of its states' centres (falls back to the continental US centre). */
export function regionCenter(regionId: string, cat: Catalog = defaultCatalog): [number, number] {
  const r = cat.region(regionId);
  const pts = (r?.states ?? []).map((s) => STATE_CENTERS[s]).filter(Boolean);
  if (!pts.length) return [39.8, -98.6];
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

export function regionForState(state: string, cat: Catalog = defaultCatalog) {
  return cat.regions.find((r) => r.states.includes(state));
}

export function defaultSite(regionId: string, cat: Catalog = defaultCatalog, state?: string): Site {
  const r = cat.region(regionId) ?? cat.regions[0];
  const c = state && STATE_CENTERS[state] ? STATE_CENTERS[state] : regionCenter(r?.id ?? regionId, cat);
  return {
    location: { lat: Math.round(c[0] * 100) / 100, lon: Math.round(c[1] * 100) / 100, precision: 'coarse' },
    regionId: r?.id ?? regionId,
    hardiness: { system: 'USDA', zone: r?.defaultZone ?? '6b' },
    frost: { ...(r?.frost ?? { lastSpring: '04-20', firstFall: '10-25' }) },
    north: [0, -1],
    sun: 'full',
    moisture: 'medium',
    soil: 'loam',
    terrain: { kind: 'flat' }
  };
}

export const ALL_ZONES = ['3a', '3b', '4a', '4b', '5a', '5b', '6a', '6b', '7a', '7b', '8a', '8b', '9a', '9b', '10a', '10b', '11a'];
