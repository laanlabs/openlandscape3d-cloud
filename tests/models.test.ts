import { describe, expect, it } from 'vitest';
import { GROWTH_K, ageAt, dormant, grow, inBloom, inFallColor, leafOff, seasonLook, sizeAt } from '../src/lib/analysis/growth';
import { dayLength, solarPosition, sunDirection } from '../src/lib/analysis/sun';
import { fmtArea, fmtLen, parseLen } from '../src/lib/model/units';
import { orientedRect, pointInPolygon, polygonArea } from '../src/lib/model/geometry';
import { cat, plant } from './helpers';

const maple = cat.plant('acer-rubrum')!;
const frost = { lastSpring: '04-25', firstFall: '10-15' };

describe('growth model', () => {
  it('follows s(t) = sm − (sm − s0)·exp(−k·t) with the contract rates', () => {
    expect(GROWTH_K).toEqual({ slow: 0.12, medium: 0.25, fast: 0.45 });
    expect(grow(1, 10, 0.25, 0)).toBe(1);
    expect(grow(1, 10, 0.25, 4)).toBeCloseTo(10 - 9 * Math.exp(-1), 12);
    expect(grow(1, 10, 0.25, -3)).toBe(1); // clamped at t = 0
  });

  it('sizes an instance from install size toward the mature midpoint', () => {
    const i = plant('acer-rubrum', 0, 0, { installHeight: 3, installSpread: 1.2 });
    expect(sizeAt(i, maple, 0)).toEqual({ height: 3, spread: 1.2 });
    const s5 = sizeAt(i, maple, 5);
    expect(s5.height).toBeCloseTo(15 - 12 * Math.exp(-0.45 * 5), 10);
    expect(s5.spread).toBeCloseTo(10.5 - 9.3 * Math.exp(-0.45 * 5), 10);
    expect(sizeAt(i, maple, 200).height).toBeCloseTo(15, 6);
  });

  it('uses t = scenario.year − plantedYear, clamped at 0', () => {
    const later = plant('acer-rubrum', 0, 0, { plantedYear: 3 });
    expect(ageAt(later, 1)).toBe(0);
    expect(ageAt(later, 5)).toBe(2);
    const old = plant('acer-rubrum', 0, 0, { status: 'existing', plantedYear: -10 });
    expect(ageAt(old, 0)).toBe(10);
  });

  it('existing plants with measured sizes start from the measurement at t = 0', () => {
    const tree = plant('acer-rubrum', 0, 0, { status: 'existing', plantedYear: -30, measuredHeight: 6, measuredSpread: 5 });
    expect(sizeAt(tree, maple, 0)).toEqual({ height: 6, spread: 5 });
    expect(sizeAt(tree, maple, 2).height).toBeCloseTo(15 - 9 * Math.exp(-0.9), 10);
  });

  it('unknown plants keep their arrival size', () => {
    const u = plant('no-such-plant', 0, 0, { fallback: { category: 'tree_oak', width: 3, height: 5, depth: 3 } });
    expect(sizeAt(u, undefined, 10)).toEqual({ height: 5, spread: 3 });
  });
});

describe('season model', () => {
  it('deciduous leaf-off strictly outside the frost months', () => {
    expect(leafOff(maple, 3, frost)).toBe(true);
    expect(leafOff(maple, 4, frost)).toBe(false); // last-spring month itself is leafed
    expect(leafOff(maple, 10, frost)).toBe(false);
    expect(leafOff(maple, 11, frost)).toBe(true);
    expect(leafOff(cat.plant('ilex-glabra')!, 1, frost)).toBe(false); // evergreen
  });
  it('blooms in catalog months; fall colour in the frost month and the one before', () => {
    expect(inBloom(maple, 3)).toBe(true);
    expect(inBloom(maple, 4)).toBe(false);
    expect(inFallColor(maple, 9, frost)).toBe(true);
    expect(inFallColor(maple, 10, frost)).toBe(true);
    expect(inFallColor(maple, 8, frost)).toBe(false);
    expect(inFallColor(cat.plant('ilex-glabra')!, 10, frost)).toBe(false);
  });
  it('herbaceous plants go dormant (visual only)', () => {
    expect(dormant(cat.plant('echinacea-purpurea')!, 1, frost)).toBe(true);
    expect(dormant(maple, 1, frost)).toBe(false);
  });
  it('produces a look per month', () => {
    expect(seasonLook(maple, 10, frost).foliage).toBe(maple.fallColor);
    expect(seasonLook(maple, 12, frost).leafOff).toBe(true);
    expect(seasonLook(cat.plant('echinacea-purpurea')!, 7, frost).bloom).toBe('#c2549a');
  });
});

describe('sun', () => {
  it('is due south at solar noon in the northern hemisphere', () => {
    const s = solarPosition(41, 6, 12);
    expect((s.azimuth * 180) / Math.PI).toBeCloseTo(180, 3);
    expect((s.altitude * 180) / Math.PI).toBeGreaterThan(65);
    expect((solarPosition(41, 12, 12).altitude * 180) / Math.PI).toBeLessThan(30);
  });
  it('maps azimuth through the north vector', () => {
    const d = sunDirection(41, 6, 12, [0, -1]); // north up the screen → sun towards +y (down = south)
    expect(d[2]).toBeGreaterThan(0);
    expect(Math.abs(d[0])).toBeLessThan(1e-6);
    const e = sunDirection(41, 6, 12, [1, 0]); // north points +x → south is −x
    expect(e[0]).toBeLessThan(0);
    expect(dayLength(41, 6).set - dayLength(41, 6).rise).toBeGreaterThan(14);
  });
});

describe('helpers', () => {
  it('geometry', () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(polygonArea(sq)).toBe(8);
    expect(pointInPolygon([1, 1], sq)).toBe(true);
    expect(pointInPolygon([5, 1], sq)).toBe(false);
    const c = Math.cos(0.5), s = Math.sin(0.5);
    const rot = sq.map(([x, y]) => [x * c - y * s + 10, x * s + y * c + 3] as [number, number]);
    const r = orientedRect(rot);
    expect(r.width * r.depth).toBeCloseTo(8, 6);
    expect(Math.max(r.width, r.depth)).toBeCloseTo(4, 6);
  });
  it('units', () => {
    expect(parseLen('12', 'metric')).toBe(12);
    expect(parseLen('40cm', 'metric')).toBeCloseTo(0.4);
    expect(parseLen('30', 'imperial')).toBeCloseTo(9.144);
    expect(parseLen("10' 6\"", 'metric')).toBeCloseTo(3.2004);
    expect(parseLen('x', 'metric')).toBeNull();
    expect(fmtLen(3.048, 'imperial')).toBe('10′');
    expect(fmtLen(2.5, 'metric')).toBe('2.5 m');
    expect(fmtArea(9.290304, 'imperial')).toBe('100 ft²');
  });
});
