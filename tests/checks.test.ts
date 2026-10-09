import { describe, expect, it } from 'vitest';
import { RULE_IDS, applyOverrides, runChecks, type RuleId } from '../src/lib/analysis/checks';
import { houseBuilding } from '../src/lib/site/templates';
import type { Override, Project } from '../src/lib/model/types';
import { area, cat, plant, project, site, square } from './helpers';

const rules = (p: Project, id: RuleId) => runChecks(p, cat).filter((r) => r.ruleId === id);

describe('OL-HARDY', () => {
  it('flags a plant whose range excludes the zone number', () => {
    const agave = plant('agave-parryi', 1, 1); // 5–10
    const p = project({ site: site({ hardiness: { system: 'USDA', zone: '4b' }, sun: 'full', moisture: 'dry' }), plants: [agave] });
    expect(rules(p, 'OL-HARDY').map((r) => r.subjectIds)).toEqual([[agave.id]]);
    expect(rules(p, 'OL-HARDY')[0].severity).toBe('error');
  });
  it('uses the integer part of the zone (5a and 5b both pass a min of 5)', () => {
    const p = project({ site: site({ hardiness: { system: 'USDA', zone: '5a' } }), plants: [plant('agave-parryi', 1, 1)] });
    expect(rules(p, 'OL-HARDY')).toEqual([]);
    const q = project({ site: site({ hardiness: { system: 'USDA', zone: '10b' } }), plants: [plant('agave-parryi', 1, 1)] });
    expect(rules(q, 'OL-HARDY')).toEqual([]);
  });
});

describe('OL-INVASIVE', () => {
  it('flags proposed plants listed for the region or one of its states', () => {
    const b = plant('berberis-thunbergii', 1, 1);
    expect(rules(project({ plants: [b] }), 'OL-INVASIVE').map((r) => r.subjectIds)).toEqual([[b.id]]);
  });
  it('ignores existing plants and other regions', () => {
    expect(rules(project({ plants: [plant('berberis-thunbergii', 1, 1, { status: 'existing' })] }), 'OL-INVASIVE')).toEqual([]);
    const se = project({ site: site({ regionId: 'us-southeast', hardiness: { system: 'USDA', zone: '8a' } }), plants: [plant('berberis-thunbergii', 1, 1)] });
    expect(rules(se, 'OL-INVASIVE')).toEqual([]);
  });
});

describe('OL-ONHARD', () => {
  const patio = area('patio', square(0, 0, 4, 4));
  it('flags a proposed plant centred in a hard area', () => {
    const p1 = plant('ilex-glabra', 2, 2);
    expect(rules(project({ areas: [patio], plants: [p1] }), 'OL-ONHARD').map((r) => r.subjectIds)).toEqual([[p1.id]]);
  });
  it('allows beds, lawn and existing plants', () => {
    expect(rules(project({ areas: [patio], plants: [plant('ilex-glabra', 6, 2)] }), 'OL-ONHARD')).toEqual([]);
    expect(rules(project({ areas: [patio], plants: [plant('ilex-glabra', 2, 2, { status: 'existing' })] }), 'OL-ONHARD')).toEqual([]);
    expect(rules(project({ areas: [area('bed', square(0, 0, 4, 4))], plants: [plant('ilex-glabra', 2, 2)] }), 'OL-ONHARD')).toEqual([]);
  });
});

describe('OL-SUN / OL-WATER', () => {
  it('uses the site default', () => {
    const a = plant('schizachyrium-scoparium', 1, 1); // full sun only
    expect(rules(project({ site: site({ sun: 'shade' }), plants: [a] }), 'OL-SUN').map((r) => r.subjectIds)).toEqual([[a.id]]);
    expect(rules(project({ site: site({ sun: 'full' }), plants: [a] }), 'OL-SUN')).toEqual([]);
  });
  it('uses the innermost containing area override', () => {
    const a = plant('schizachyrium-scoparium', 2, 2);
    const outer = area('bed', square(0, 0, 10, 10), { sun: 'shade' });
    const inner = area('bed', square(1, 1, 3, 3), { sun: 'full' });
    expect(rules(project({ areas: [outer, inner], plants: [a] }), 'OL-SUN')).toEqual([]);
    expect(rules(project({ areas: [outer], plants: [a] }), 'OL-SUN')).toHaveLength(1);
  });
  it('checks moisture the same way', () => {
    const agave = plant('agave-parryi', 2, 2, {}); // dry only
    const wet = area('bed', square(0, 0, 4, 4), { moisture: 'wet' });
    const s = site({ regionId: 'us-southwest', hardiness: { system: 'USDA', zone: '9b' }, moisture: 'dry' });
    expect(rules(project({ site: s, plants: [agave] }), 'OL-WATER')).toEqual([]);
    expect(rules(project({ site: s, areas: [wet], plants: [agave] }), 'OL-WATER').map((r) => r.subjectIds)).toEqual([[agave.id]]);
    expect(rules(project({ site: s, areas: [wet], plants: [agave] }), 'OL-WATER')[0].severity).toBe('warning');
  });
});

describe('OL-OVERLAP', () => {
  // Inkberry mature spread 1.2–2.4 → radius 0.9. Threshold: 1.8 − d > 0.45 ⇔ d < 1.35.
  it('flags pairs over the threshold', () => {
    const a = plant('ilex-glabra', 0, 0), b = plant('ilex-glabra', 1.3, 0);
    const r = rules(project({ plants: [a, b] }), 'OL-OVERLAP');
    expect(r.map((x) => x.subjectIds)).toEqual([[a.id, b.id].sort()]);
  });
  it('passes at the threshold, within one group, and for removed plants', () => {
    expect(rules(project({ plants: [plant('ilex-glabra', 0, 0), plant('ilex-glabra', 1.36, 0)] }), 'OL-OVERLAP')).toEqual([]);
    const g = '00000000-0000-4000-8000-0000000000aa';
    expect(rules(project({ plants: [plant('ilex-glabra', 0, 0, { groupId: g }), plant('ilex-glabra', 0.5, 0, { groupId: g })] }), 'OL-OVERLAP')).toEqual([]);
    expect(rules(project({ plants: [plant('ilex-glabra', 0, 0, { groupId: g }), plant('ilex-glabra', 0.5, 0)] }), 'OL-OVERLAP')).toHaveLength(1);
    expect(rules(project({ plants: [plant('ilex-glabra', 0, 0, { status: 'remove' }), plant('ilex-glabra', 0.5, 0)] }), 'OL-OVERLAP')).toEqual([]);
  });
});

describe('OL-CLEARANCE', () => {
  const building = houseBuilding(0, 0, 10, 8, { doorSide: 'bottom' });
  it('flags trees whose mature radius reaches a wall', () => {
    const maple = plant('acer-rubrum', 5, 12); // 4 m from the wall; half spread = 5.25
    expect(rules(project({ building, plants: [maple] }), 'OL-CLEARANCE').map((r) => r.subjectIds)).toEqual([[maple.id]]);
  });
  it('passes distant trees and ignores shrubs', () => {
    expect(rules(project({ building, plants: [plant('acer-rubrum', 5, 14)] }), 'OL-CLEARANCE')).toEqual([]);
    expect(rules(project({ building, plants: [plant('ilex-glabra', 5, 8.3)] }), 'OL-CLEARANCE')).toEqual([]);
    expect(rules(project({ plants: [plant('acer-rubrum', 5, 8.3)] }), 'OL-CLEARANCE')).toEqual([]);
  });
});

describe('OL-OUTSIDE', () => {
  it('flags plants and objects outside the boundary', () => {
    const out = plant('ilex-glabra', 30, 3);
    const obj = { id: '00000000-0000-4000-8000-0000000000bb', catalogId: 'shed', x: -2, y: 1, rotation: 0, width: 2, depth: 2.5, height: 2.3, elevation: 0, status: 'proposed' as const };
    const p = project({ site: site({ boundary: square(0, 0, 20, 20) }), plants: [out, plant('ilex-glabra', 3, 3)], objects: [obj] });
    expect(rules(p, 'OL-OUTSIDE').map((r) => r.subjectIds[0]).sort()).toEqual([out.id, obj.id].sort());
  });
  it('needs a boundary', () => {
    expect(rules(project({ plants: [plant('ilex-glabra', 300, 3)] }), 'OL-OUTSIDE')).toEqual([]);
  });
});

describe('OL-BLOOMGAP', () => {
  it('lists April–October months with nothing in bloom when ≥ 5 proposed plants', () => {
    const five = [0, 1, 2, 3, 4].map((i) => plant('echinacea-purpurea', i * 3, 0)); // Jun–Aug
    const r = rules(project({ plants: five }), 'OL-BLOOMGAP');
    expect(r).toHaveLength(1);
    expect(r[0].subjectIds).toEqual([]);
    expect(r[0].message).toContain('Apr, May, Sep, Oct');
  });
  it('counts retained plants and needs five proposed', () => {
    const four = [0, 1, 2, 3].map((i) => plant('echinacea-purpurea', i * 3, 0));
    expect(rules(project({ plants: four }), 'OL-BLOOMGAP')).toEqual([]);
    const five = [0, 1, 2, 3, 4].map((i) => plant('echinacea-purpurea', i * 3, 0));
    const fill = [plant('phlox-subulata', 30, 0, { status: 'retain' }), plant('schizachyrium-scoparium', 33, 0, { status: 'retain' }), plant('ilex-glabra', 40, 0, { status: 'retain' })];
    const r = rules(project({ plants: [...five, ...fill] }), 'OL-BLOOMGAP');
    expect(r[0].message).toContain('Oct');
    expect(r[0].message).not.toContain('Apr');
    expect(r[0].message).not.toContain('Sep');
  });
});

describe('OL-UNVERIFIED', () => {
  it('reports an unverified boundary only', () => {
    expect(rules(project({ site: site({ boundary: square(0, 0, 5, 5) }) }), 'OL-UNVERIFIED')).toHaveLength(1);
    expect(rules(project({ site: site({ boundary: square(0, 0, 5, 5) }), verification: { boundary: true, measurements: {} } }), 'OL-UNVERIFIED')).toEqual([]);
    expect(rules(project(), 'OL-UNVERIFIED')).toEqual([]);
  });
});

describe('results', () => {
  it('are sorted by ruleId then first subject, and overrides downgrade to info with the note', () => {
    const b = plant('berberis-thunbergii', 1, 1);
    const p = project({ site: site({ boundary: square(0, 0, 5, 5), sun: 'shade' }), plants: [b, plant('acer-rubrum', 20, 20)] });
    const all = runChecks(p, cat);
    const keys = all.map((r) => r.ruleId);
    expect([...keys].sort()).toEqual(keys);
    const o = runChecks({ ...p, overrides: [{ ruleId: 'OL-INVASIVE', subjectId: b.id, note: 'Existing hedge kept for now' }] }, cat).find((r) => r.ruleId === 'OL-INVASIVE')!;
    expect(o.severity).toBe('info');
    expect(o.message).toContain('Existing hedge kept for now');
    expect(o.overridden?.originalSeverity).toBe('error');
  });
  it('match site-level results with an absent, empty or project-id subjectId (iOS writes nil)', () => {
    const p = project({ site: site({ boundary: square(0, 0, 5, 5) }) });
    const unverified = (q: Project) => runChecks(q, cat).find((r) => r.ruleId === 'OL-UNVERIFIED')!;
    expect(unverified(p).overridden).toBeUndefined();
    // subjectId missing entirely, as the iOS encoder writes it
    const absent = unverified({ ...p, overrides: [{ ruleId: 'OL-UNVERIFIED', note: 'Surveyed' } as Override] });
    expect(absent.severity).toBe('info');
    expect(absent.overridden).toEqual({ note: 'Surveyed', originalSeverity: 'info' });
    expect(absent.message).toContain('Override: Surveyed');
    expect(unverified({ ...p, overrides: [{ ruleId: 'OL-UNVERIFIED', subjectId: '', note: 'Surveyed' }] }).overridden?.note).toBe('Surveyed');
    expect(unverified({ ...p, overrides: [{ ruleId: 'OL-UNVERIFIED', subjectId: p.id, note: 'Surveyed' }] }).overridden?.note).toBe('Surveyed');
    // but not some other subject, and never a result that has subjects
    expect(unverified({ ...p, overrides: [{ ruleId: 'OL-UNVERIFIED', subjectId: 'someone-else', note: 'No' }] }).overridden).toBeUndefined();
    const flagged = [{ ruleId: 'OL-SUN' as const, severity: 'warning' as const, subjectIds: ['plant-1'], message: 'm' }];
    expect(applyOverrides(flagged, { ...p, overrides: [{ ruleId: 'OL-SUN', note: 'No' } as Override] })[0].overridden).toBeUndefined();
  });
  it('skip unknown plants for fact rules but keep them for OL-OUTSIDE', () => {
    const u = plant('mystery-plant', 50, 50);
    const r = runChecks(project({ site: site({ boundary: square(0, 0, 5, 5) }), plants: [u] }), cat);
    expect(r.filter((x) => x.subjectIds.includes(u.id)).map((x) => x.ruleId)).toEqual(['OL-OUTSIDE']);
  });
  it('cover every rule id', () => expect(RULE_IDS).toHaveLength(10));
});
