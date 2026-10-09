import { describe, expect, it } from 'vitest';
import { armQuery, newSiteOptions, parseArm, parseRoute } from '../src/lib/io/routes';
import { ALL_ZONES } from '../src/lib/site/regions';
import { cat } from './helpers';



describe('parseRoute', () => {
  it('splits head, path and query', () => {
    const r = parseRoute('#/sample/northeast-back-yard?plants=acer-rubrum&tool=row');
    expect(r.head).toBe('sample');
    expect(r.rest).toEqual(['northeast-back-yard']);
    expect(r.query.get('plants')).toBe('acer-rubrum');
    expect(r.query.get('tool')).toBe('row');
  });
  it('keeps slashes inside link payloads and handles an empty hash', () => {
    expect(parseRoute('#/view/v1/ab/cd').rest).toEqual(['v1', 'ab', 'cd']);
    expect(parseRoute('').head).toBe('');
    expect(parseRoute('#/').head).toBe('');
  });
});

describe('parseArm', () => {
  it('dedupes, lower-cases and validates ids and the tool', () => {
    const a = parseArm(new URLSearchParams('plants=Acer-Rubrum,acer-rubrum,<script>,itea-virginica&tool=row'));
    expect(a).toEqual({ plantIds: ['acer-rubrum', 'itea-virginica'], tool: 'row' });
    expect(parseArm(new URLSearchParams('plants=x&tool=delete-all'))?.tool).toBeUndefined();
    expect(parseArm(new URLSearchParams('tool=row'))).toBeNull();
  });
  it('round-trips through armQuery', () => {
    const a = { plantIds: ['a', 'b'], tool: 'mass' as const };
    expect(parseArm(parseRoute(`#/p/x${armQuery(a)}`).query)).toEqual(a);
    expect(armQuery(null)).toBe('');
  });
});

describe('newSiteOptions', () => {
  it('falls back to safe defaults', () => {
    const o = newSiteOptions(new URLSearchParams(''), cat, ALL_ZONES);
    expect(o.name).toBe('My garden');
    expect(o.units).toBe('imperial');
    expect(o.template).toBe('backyard');
    expect(cat.region(o.regionId)).toBeTruthy();
    expect(o.zone).toBe(cat.region(o.regionId)!.defaultZone);
  });
  it('accepts a known region, zone and template and rejects unknown ones', () => {
    const r = cat.regions[cat.regions.length - 1];
    const ok = newSiteOptions(new URLSearchParams(`region=${r.id}&zone=${r.defaultZone}&template=blank&units=metric&name=Back%20garden`), cat, ALL_ZONES);
    expect(ok).toMatchObject({ regionId: r.id, zone: r.defaultZone, template: 'blank', units: 'metric', name: 'Back garden' });
    const bad = newSiteOptions(new URLSearchParams('region=mars&zone=99z&template=castle'), cat, ALL_ZONES);
    expect(bad.regionId).toBe(cat.regions[0].id);
    expect(bad.template).toBe('backyard');
  });
  it('maps a whole-number zone to a half-zone', () => {
    const o = newSiteOptions(new URLSearchParams('zone=7'), cat, ALL_ZONES);
    expect(o.zone).toMatch(/^7[ab]$/);
  });
});
