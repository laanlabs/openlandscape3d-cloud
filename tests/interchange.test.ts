import { describe, expect, it } from 'vitest';
import { fromOpenPlan, heading, plantCategory, toOpenPlan } from '../src/lib/io/openplan';
import { decodePayload, encodePayload, iosImportUrl, shareUrl, transferJson, webImportUrl } from '../src/lib/io/transfer';
import { sendToOpenPlan } from '../src/lib/io/handoff';
import { houseBuilding, newProject } from '../src/lib/site/templates';
import { BLOCK_SCHEMA, type Project } from '../src/lib/model/types';
import { sizeAt } from '../src/lib/analysis/growth';
import { area, cat, plant, project, site, square } from './helpers';

const garden = () => newProject({ name: 'Back garden', units: 'imperial', regionId: 'us-northeast', template: 'backyard' }, cat);
const obj = (j: any, id: string) => j.objects.find((o: any) => o.identifier === id);
const catOf = (o: any) => Object.keys(o.category)[0];

describe('OpenPlan3D export contract', () => {
  it('writes the prepared RoomPlan envelope and block', () => {
    const p = garden();
    const j = toOpenPlan(p, cat);
    expect(j.openplanPrepared).toBe(true);
    expect(j.openplanHandoffVersion).toBe(1);
    expect(j.version).toBe(2);
    expect(j.stories).toEqual([{ index: 0, name: 'Ground Floor' }]);
    expect(j.openlandscape3d.schema).toBe(BLOCK_SCHEMA);
    expect(j.openlandscape3d.producer).toBe('web');
    expect(j.openlandscape3d.units).toBe('m');
    expect(j.openlandscape3d.building).toBeNull();
    expect(j.walls).toHaveLength(4);
    expect(j.walls).toEqual(p.building!.walls);
  });

  it('maps plants to OpenPlan3D catalog ids at the scenario-year size, y = h/2', () => {
    const p = project({ scenario: { month: 6, year: 3, hour: 12 }, plants: [plant('acer-rubrum', 4, 5), plant('pinus-strobus', 9, 9), plant('ilex-glabra', 1, 1), plant('echinacea-purpurea', 2, 2), plant('phlox-subulata', 3, 3), plant('schizachyrium-scoparium', 4, 4), plant('agave-parryi', 6, 6)] });
    const j = toOpenPlan(p, cat);
    expect(p.plants.map((i) => catOf(obj(j, i.id)))).toEqual(['tree_default', 'tree_pine', 'bush_large', 'flower_red', 'grass_tuft', 'grass_large', 'cactus_short']);
    const m = obj(j, p.plants[0].id);
    const s = sizeAt(p.plants[0], cat.plant('acer-rubrum'), 3);
    expect(m.dimensions[0]).toBeCloseTo(s.spread, 5);
    expect(m.dimensions[1]).toBeCloseTo(s.height, 5);
    expect(m.dimensions[2]).toBeCloseTo(s.spread, 5);
    expect(m.transform[12]).toBe(4);
    expect(m.transform[14]).toBe(5);
    expect(m.transform[13]).toBeCloseTo(s.height / 2, 5);
    expect(m.attributes).toEqual({ openlandscape3dRole: 'proposed', openlandscape3dKind: 'plant', plantId: 'acer-rubrum' });
  });

  it('writes the catalog openplanProxy verbatim (never derived)', () => {
    const odd = { ...cat.plant('echinacea-purpurea')!, representation: { openplanProxy: 'flower_purple_b', symbol2d: 'clump', crown: 'upright' } };
    expect(plantCategory(odd)).toBe('flower_purple_b');
    for (const pl of cat.plants) expect(plantCategory(pl)).toBe(pl.representation!.openplanProxy);
  });

  it('exports one fence object per segment, gates, retaining walls and hard areas', () => {
    const p = garden();
    p.lines.push({ id: '00000000-0000-4000-8000-0000000000c1', kind: 'retaining_wall', style: 'block', points: [[2, 20], [8, 20]], height: 0.6, thickness: 0.3, gates: [] });
    p.lines.push({ id: '00000000-0000-4000-8000-0000000000c2', kind: 'edging', style: 'steel', points: [[2, 21], [8, 21]], height: 0.1, thickness: 0.01, gates: [] });
    p.areas.push(area('water', square(14, 17, 18, 19)));
    const j = toOpenPlan(p, cat);
    const fences = j.objects.filter((o: any) => o.attributes?.openlandscape3dKind === 'fence');
    expect(fences).toHaveLength(3);
    expect(fences.map((o: any) => catOf(o))).toEqual(['fence_planks', 'fence_planks', 'fence_planks']);
    expect(fences[0].dimensions).toEqual([18, 1.8, 0.1]);
    expect(heading(fences[0].transform)).toBeCloseTo(Math.PI / 2);
    const gate = j.objects.find((o: any) => catOf(o) === 'fence_gate');
    expect(gate.dimensions).toEqual([1, 1.8, 0.1]);
    expect(gate.transform[14]).toBeCloseTo(12 + 0.6 + 0.5);
    const wall = j.objects.filter((o: any) => catOf(o) === 'retaining_wall');
    expect(wall).toHaveLength(1);
    expect(wall[0].dimensions).toEqual([6, 0.6, 0.3]);
    expect(j.objects.filter((o: any) => o.attributes?.lineId === '00000000-0000-4000-8000-0000000000c2')).toEqual([]);
    const patio = obj(j, p.areas.find((a) => a.kind === 'patio')!.id);
    expect(catOf(patio)).toBe('deck_patio');
    expect([patio.dimensions[0], patio.dimensions[2]].sort()).toEqual([4, 6.5]);
    expect(patio.dimensions[1]).toBe(0.15);
    expect(patio.transform[13]).toBeCloseTo(0.075);
    expect(catOf(obj(j, p.areas.at(-1)!.id))).toBe('pool_rectangular');
    expect(j.objects.some((o: any) => o.identifier === p.areas.find((a) => a.kind === 'lawn')!.id)).toBe(false);
    const bench = obj(j, p.objects[0].id);
    expect(catOf(bench)).toBe('bench_outdoor');
    expect(bench.dimensions).toEqual([1.5, 0.8, 0.5]);
    expect((heading(bench.transform) * 180) / Math.PI).toBeCloseTo(180);
    const ids = j.objects.map((o: any) => o.identifier);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exports one object per resolved group instance', () => {
    const p = garden();
    const j = toOpenPlan(p, cat);
    for (const g of p.groups) for (const id of g.instanceIds) expect(obj(j, id).attributes.groupId).toBe(g.id);
  });
});

describe('import', () => {
  it('round-trips a web project losslessly through its own export', () => {
    const p = garden();
    expect(fromOpenPlan(JSON.parse(JSON.stringify(toOpenPlan(p, cat))), cat)).toEqual(p);
  });

  it('reads an iOS export (no webProject) from the block', () => {
    const p = garden();
    const j = JSON.parse(JSON.stringify(toOpenPlan(p, cat, { embedWebProject: false })));
    j.openlandscape3d.producer = 'ios';
    const back = fromOpenPlan(j, cat);
    expect(back.id).toBe(p.id);
    expect(back.plants).toEqual(p.plants);
    expect(back.groups).toEqual(p.groups);
    expect(back.areas).toEqual(p.areas);
    expect(back.lines).toEqual(p.lines);
    expect(back.building!.walls).toEqual(p.building!.walls);
    expect(back.web).toEqual(p.web);
  });

  it('keeps unknown plants as placeholders with their OpenPlan category and size, and re-exports them', () => {
    const p = project({ plants: [plant('acer-rubrum', 1, 1)] });
    const j = JSON.parse(JSON.stringify(toOpenPlan(p, cat, { embedWebProject: false })));
    j.openlandscape3d.producer = 'ios';
    j.openlandscape3d.plants[0].plantId = 'quercus-futura';
    j.objects[0].category = { tree_oak: {} };
    j.objects[0].dimensions = [3, 5, 3];
    const back = fromOpenPlan(j, cat);
    expect(back.plants[0].plantId).toBe('quercus-futura');
    expect(back.plants[0].fallback).toEqual({ category: 'tree_oak', width: 3, height: 5, depth: 3 });
    const again = toOpenPlan(back, cat, { embedWebProject: false });
    expect(again.objects[0].category).toEqual({ tree_oak: {} });
    expect(again.objects[0].dimensions).toEqual([3, 5, 3]);
    expect(again.openlandscape3d.plants[0].plantId).toBe('quercus-futura');
    expect(again.openlandscape3d.plants[0].fallback).toBeUndefined();
  });

  it('preserves unknown fields inside the openlandscape3d block', () => {
    const p = garden();
    const j = JSON.parse(JSON.stringify(toOpenPlan(p, cat, { embedWebProject: false })));
    const b = j.openlandscape3d;
    b.producer = 'ios';
    b.futureTopLevel = { a: [1, 2, 3] };
    b.site.futureSiteField = 'x';
    b.plants[0].iosOnly = { tag: 42 };
    b.areas[0].survey = { accuracy: 0.02 };
    b.lines[0].postSpacing = 2.4;
    b.web.someWebFlag = true;
    b.ios = { lastSync: '2027-01-01' };
    const again = toOpenPlan(fromOpenPlan(j, cat), cat, { embedWebProject: false }).openlandscape3d;
    expect(again.futureTopLevel).toEqual({ a: [1, 2, 3] });
    expect(again.ios).toEqual({ lastSync: '2027-01-01' });
    expect(again.site.futureSiteField).toBe('x');
    expect(again.plants[0].iosOnly).toEqual({ tag: 42 });
    expect(again.areas[0].survey).toEqual({ accuracy: 0.02 });
    expect(again.lines[0].postSpacing).toBe(2.4);
    expect(again.web.someWebFlag).toBe(true);
  });

  it('imports a plain OpenPlan3D building file and re-exports walls/doors/windows identically', () => {
    const b = houseBuilding(0, 0, 12, 9, { doorSide: 'bottom', name: 'Cottage' });
    const plain = { openplanPrepared: true, openplanHandoffVersion: 1, version: 2, ...b, objects: [
      { identifier: 'sofa-1', dimensions: [2, 0.8, 0.9], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0.4, 4, 1], category: { sofa: {} }, story: 0 },
      { identifier: 'pergola-1', dimensions: [3, 2.5, 3], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6, 1.25, 14, 1], category: { pergola: {} }, story: 0 }
    ] };
    const p = fromOpenPlan(JSON.parse(JSON.stringify(plain)), cat);
    expect(p.name).toBe('Cottage');
    expect(p.captureSource).toBe('openplan');
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0]).toMatchObject({ id: 'pergola-1', catalogId: 'pergola', x: 6, y: 14, width: 3, height: 2.5, depth: 3, elevation: 0 });
    const out = toOpenPlan(p, cat);
    for (const k of ['walls', 'doors', 'windows', 'openings', 'sections', 'stories', 'floors', 'defaults'] as const) expect(out[k]).toEqual((plain as any)[k]);
    expect(out.objects.find((o: any) => o.identifier === 'sofa-1')).toEqual(plain.objects[0]);
    expect(obj(out, 'pergola-1').category).toEqual({ pergola: {} });
  });
});

describe('links', () => {
  const precise = (): Project => {
    const p = garden();
    p.site.location = { lat: 41.123456, lon: -72.987654, precision: 'precise' };
    p.observations.push({ id: '00000000-0000-4000-8000-0000000000d1', kind: 'photo', createdAt: '2027-05-01T00:00:00Z', author: 'ios', x: 3, y: 4, lat: 41.1234, lon: -72.9876, headingDeg: 120, text: 'Wet corner', photoFile: 'obs-1.jpg' });
    return p;
  };

  it('strip webProject, precise location and observation coordinates', () => {
    const j = transferJson(precise(), cat);
    expect(j.openlandscape3d.webProject).toBeUndefined();
    expect(j.openlandscape3d.site.location).toEqual({ lat: 41.12, lon: -72.99, precision: 'coarse' });
    const o = j.openlandscape3d.observations[0];
    expect(o.lat).toBeUndefined();
    expect(o.lon).toBeUndefined();
    expect(o.headingDeg).toBeUndefined();
    expect(o.text).toBe('Wet corner');
    expect(o.x).toBe(3);
  });

  it('round-trip through the deflate-raw base64url payload', async () => {
    const p = precise();
    const j = transferJson(p, cat);
    const payload = await encodePayload(j);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePayload(payload)).toEqual(JSON.parse(JSON.stringify(j)));
    expect(await webImportUrl(p, cat)).toMatch(/^https:\/\/app\.openlandscape3d\.com\/#\/import\/v1\/[A-Za-z0-9_-]+$/);
    expect(await iosImportUrl(p, cat)).toMatch(/^openlandscape3d:\/\/import\/v1\/[A-Za-z0-9_-]+$/);
    expect(await shareUrl(p, cat, 'https://x.test')).toMatch(/^https:\/\/x\.test\/#\/view\/v1\//);
    const back = fromOpenPlan((await decodePayload(payload)) as any, cat);
    expect(back.plants).toEqual(p.plants);
    expect(back.site.location?.precision).toBe('coarse');
  });

  it('rejects junk payloads', async () => {
    await expect(decodePayload('not-a-payload')).rejects.toThrow();
  });
});

describe('OpenPlan3D handoff', () => {
  it('POSTs compact key-sorted JSON and returns the editor link', async () => {
    let sent: any;
    const fake = (async (url: string, init: any) => { sent = { url, init }; return new Response(JSON.stringify({ code: 'ABCD2345' }), { status: 201 }); }) as any;
    const link = await sendToOpenPlan({ b: 1, a: { d: 2, c: 3 } }, fake);
    expect(link).toBe('https://app.openplan3d.com/editor?import=ABCD2345');
    expect(sent.url).toBe('https://app.openplan3d.com/api/handoffs');
    expect(sent.init.body).toBe('{"a":{"c":3,"d":2},"b":1}');
    await expect(sendToOpenPlan({}, (async () => new Response('{}', { status: 503 })) as any)).rejects.toThrow(/unavailable/);
  });
});

export { site };
