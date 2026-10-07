import { describe, expect, it } from 'vitest';
import { catalog, zoneNumber } from '../src/lib/catalog/catalog';
import { SAMPLES, buildSample, sampleCopy } from '../src/lib/site/samples';
import { runChecks } from '../src/lib/analysis/checks';
import { fromOpenPlan, toOpenPlan } from '../src/lib/io/openplan';
import { isRoomPlanJsonLike } from './helpers';

const BLOCKING = ['OL-HARDY', 'OL-INVASIVE', 'OL-ONHARD', 'OL-OUTSIDE'];

describe('sample gardens', () => {
  it('one per pilot region', () => {
    expect(new Set(SAMPLES.map((s) => s.regionId))).toEqual(new Set(['us-northeast', 'us-southeast', 'us-southwest']));
  });

  for (const s of SAMPLES) {
    describe(s.id, () => {
      const p = buildSample(s.id)!;
      const checks = runChecks(p, catalog);
      it('summary', () => {
        const species = new Set(p.plants.map((x) => x.plantId));
        const count = (sev: string) => checks.filter((c) => c.severity === sev).length;
        const byRule: Record<string, number> = {};
        for (const c of checks) byRule[c.ruleId] = (byRule[c.ruleId] ?? 0) + 1;
        console.log(`${s.id}: ${p.plants.length} plants, ${species.size} species, ${p.groups.length} groups; checks ${count('error')} errors / ${count('warning')} warnings / ${count('info')} info ${JSON.stringify(byRule)}`);
      });
      it('builds deterministically', () => {
        expect(JSON.stringify(buildSample(s.id))).toBe(JSON.stringify(p));
      });
      it('uses only known plant ids, all hardy in the site zone', () => {
        const z = zoneNumber(p.site.hardiness.zone);
        for (const i of p.plants) {
          const pl = catalog.plant(i.plantId);
          expect(pl, i.plantId).toBeTruthy();
          expect(z >= pl!.hardiness.min && z <= pl!.hardiness.max, `${i.plantId} hardy in ${p.site.hardiness.zone}`).toBe(true);
        }
        expect(p.site.hardiness.zone).toBe(catalog.region(s.regionId)!.defaultZone);
        expect(p.site.frost).toEqual(catalog.region(s.regionId)!.frost);
      });
      it('has no errors and none of the blocking rules; few overlaps', () => {
        expect(checks.filter((c) => c.severity === 'error')).toEqual([]);
        expect(checks.filter((c) => BLOCKING.includes(c.ruleId))).toEqual([]);
        expect(checks.filter((c) => c.ruleId === 'OL-OVERLAP').length).toBeLessThanOrEqual(3);
      });
      it('15–30 distinct plants and 60–250 plants in total, using groups', () => {
        const species = new Set(p.plants.map((x) => x.plantId)).size;
        expect(species).toBeGreaterThanOrEqual(15);
        expect(species).toBeLessThanOrEqual(30);
        expect(p.plants.length).toBeGreaterThanOrEqual(60);
        expect(p.plants.length).toBeLessThanOrEqual(250);
        expect(p.groups.length).toBeGreaterThanOrEqual(3);
        expect(p.scenario).toMatchObject({ month: 6, year: 5 });
      });
      it('round-trips through the OpenPlan3D export', () => {
        const j = JSON.parse(JSON.stringify(toOpenPlan(p, catalog, { embedWebProject: false })));
        expect(isRoomPlanJsonLike(j)).toBe(true);
        const back = fromOpenPlan(j, catalog);
        expect(back.plants).toEqual(p.plants);
        expect(back.alternatives).toEqual(p.alternatives);
      });
      it('opening it twice gives two independent projects', () => {
        const a = sampleCopy(s.id)!, b = sampleCopy(s.id)!;
        expect(a.id).not.toBe(b.id);
        expect(a.id).not.toBe(p.id);
        expect(a.name).toBe(`${s.name} (sample)`);
        a.plants.pop();
        a.areas[0].name = 'changed';
        expect(b.plants.length).toBe(p.plants.length);
        expect(b.areas[0].name).toBe(p.areas[0].name);
        expect(buildSample(s.id)!.plants.length).toBe(p.plants.length);
      });
    });
  }

  it('has an Option B on at least one sample', () => {
    expect(SAMPLES.some((s) => buildSample(s.id)!.alternatives.some((a) => /Option B/.test(a.name)))).toBe(true);
  });

  it('unknown ids return nothing', () => {
    expect(buildSample('nope')).toBeUndefined();
    expect(sampleCopy('nope')).toBeUndefined();
  });
});
