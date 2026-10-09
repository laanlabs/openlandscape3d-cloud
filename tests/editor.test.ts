// Editing-session behaviour: tool/selection interplay, history, autosave, gates and overrides.
// The Editor class uses runes; vitest compiles .svelte.ts through the Svelte plugin, and IndexedDB is
// replaced by a mock so saves can be asserted without a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line, Project } from '../src/lib/model/types';
import { cat, id, plant, project, square } from './helpers';

const saved = vi.fn(async (_p: Project) => {});
vi.mock('../src/lib/io/storage', () => ({ saveProject: (p: Project) => saved(p) }));

import { Editor, gatesAfterDeletingVertex, gatesAfterInsertingVertex, SAVE_DEBOUNCE_MS, subjectKey } from '../src/lib/ui/editor.svelte';

const line = (points: [number, number][], gates: Line['gates'] = []): Line => ({ id: id('l'), kind: 'fence', style: 'board', points, height: 1.8, thickness: 0.1, gates });
const gate = (segment: number, offset: number, width: number) => ({ id: id('g'), segment, offset, width });

beforeEach(() => { vi.useFakeTimers(); saved.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('tools and selection', () => {
  it('picking a drawing tool deselects, so Backspace while drawing cannot delete the selection', () => {
    const pl = plant('ilex-glabra', 1, 1);
    const ed = new Editor(project({ plants: [pl] }), { catalog: cat });
    ed.selection = { kind: 'plant', id: pl.id };
    ed.setTool('area');
    expect(ed.tool).toBe('area');
    expect(ed.selection).toBeNull();
  });
  it('the same happens for direct assignments from panels, but not when returning to Select', () => {
    const pl = plant('ilex-glabra', 1, 1);
    const ed = new Editor(project({ plants: [pl] }), { catalog: cat });
    ed.selection = { kind: 'plant', id: pl.id };
    ed.tool = 'select';
    expect(ed.selection).toEqual({ kind: 'plant', id: pl.id });
    ed.tool = 'row';
    expect(ed.selection).toBeNull();
  });
  it('finishing a boundary keeps it selected while the tool returns to Select', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.setTool('boundary');
    ed.setBoundary(square(0, 0, 10, 10));
    ed.tool = 'select';
    expect(ed.selection).toEqual({ kind: 'boundary', id: 'boundary' });
  });
  it('removeSelected does nothing when nothing is selected', () => {
    const pl = plant('ilex-glabra', 1, 1);
    const ed = new Editor(project({ plants: [pl] }), { catalog: cat });
    const before = ed.project;
    ed.removeSelected();
    expect(ed.project).toBe(before);
    expect(ed.undoCount).toBe(0);
    expect(ed.toast).toBeNull();
  });
  it('removeSelected deletes the selection and clears it', () => {
    const pl = plant('ilex-glabra', 1, 1);
    const ed = new Editor(project({ plants: [pl] }), { catalog: cat });
    ed.selection = { kind: 'plant', id: pl.id };
    ed.removeSelected();
    expect(ed.project.plants).toEqual([]);
    expect(ed.selection).toBeNull();
    expect(ed.undoCount).toBe(1);
  });
});

describe('arm (deep link from a plant page)', () => {
  it('arms a single plant with the plant tool and says what to do', () => {
    const ed = new Editor(project(), { catalog: cat });
    const text = ed.arm(['ilex-glabra']);
    expect(ed.mix.map((m) => m.plantId)).toEqual(['ilex-glabra']);
    expect(ed.tool).toBe('plant');
    expect(text).toMatch(/^Click in the plan to place .+ — Esc to stop$/);
    expect(ed.toast?.text).toBe(text);
  });
  it('defaults several plants to a drift and honours an explicit tool', () => {
    const ed = new Editor(project(), { catalog: cat });
    expect(ed.arm(['ilex-glabra', 'echinacea-purpurea'])).toBe('Draw an area to plant the mix');
    expect(ed.tool).toBe('mass');
    expect(ed.arm(['ilex-glabra'], 'row')).toBe('Draw a line for the hedge');
    expect(ed.tool).toBe('row');
  });
  it('drops unknown ids with a message naming the catalog version', () => {
    const ed = new Editor(project(), { catalog: cat });
    const text = ed.arm(['no-such-plant', 'ilex-glabra']);
    expect(text).toContain(`no-such-plant is not in this catalog version (${cat.version})`);
    expect(ed.mix.map((m) => m.plantId)).toEqual(['ilex-glabra']);
    expect(ed.tool).toBe('plant');
    const none = new Editor(project(), { catalog: cat });
    none.arm(['no-such-plant']);
    expect(none.mix).toEqual([]);
    expect(none.tool).toBe('select');
  });
  it('does nothing in a read-only view', () => {
    const ed = new Editor(project(), { catalog: cat, readonly: true });
    expect(ed.arm(['ilex-glabra'])).toBe('');
    expect(ed.mix).toEqual([]);
  });
});

describe('undo and redo carry view state', () => {
  it('keeps the current scenario, layers, canopy rings and dismissed hints', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addArea('lawn', square(0, 0, 5, 5));
    ed.setScenario({ month: 9, year: 10 });
    ed.setLayer('labels', false);
    ed.setGhost(true);
    ed.setHint('start', true);
    ed.undo();
    expect(ed.project.areas).toEqual([]);
    expect(ed.project.scenario.month).toBe(9);
    expect(ed.project.scenario.year).toBe(10);
    expect(ed.layer('labels')).toBe(false);
    expect(ed.ghost).toBe(true);
    expect(ed.hint('start')).toBe(true);
    ed.setScenario({ month: 2 });
    ed.redo();
    expect(ed.project.areas).toHaveLength(1);
    expect(ed.project.scenario.month).toBe(2);
    expect(ed.undoCount).toBe(1);
    expect(ed.redoCount).toBe(0);
  });
  it('does not resurrect view keys the user has since cleared', () => {
    const ed = new Editor(project({ web: { units: 'metric', ghostRings: true } }), { catalog: cat });
    ed.addArea('bed', square(0, 0, 2, 2));
    ed.project = { ...ed.project, web: { units: 'metric' } }; // e.g. a reset elsewhere
    ed.undo();
    expect('ghostRings' in ed.project.web).toBe(false);
  });
  it('view-state changes are not undo steps and hints are not edits', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.setScenario({ month: 1 });
    ed.setHint('start', true);
    expect(ed.undoCount).toBe(0);
    expect(ed.project.updatedAt).toBe('2027-01-10T00:00:00.000Z');
  });
});

describe('autosave', () => {
  it('debounces edits to 150 ms and reports saved only when nothing changed meanwhile', async () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addArea('lawn', square(0, 0, 5, 5));
    expect(ed.saveState).toBe('saving');
    expect(SAVE_DEBOUNCE_MS).toBe(150);
    await vi.advanceTimersByTimeAsync(149);
    expect(saved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].areas).toHaveLength(1);
    expect(ed.saveState).toBe('saved');
  });
  it('flushes at the end of a drag', async () => {
    const pl = plant('ilex-glabra', 1, 1);
    const ed = new Editor(project({ plants: [pl] }), { catalog: cat });
    const start = ed.project;
    ed.moveItem({ kind: 'plant', id: pl.id }, start, [1, 0]);
    ed.moveItem({ kind: 'plant', id: pl.id }, start, [2, 0]);
    expect(ed.dragging).toBe(true);
    ed.endDrag();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].plants[0].x).toBe(3);
    expect(ed.undoCount).toBe(1);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(saved).toHaveBeenCalledTimes(1); // the pending debounce was cancelled by the flush
  });
  it('reports an error and recovers on retry (flush)', async () => {
    const ed = new Editor(project(), { catalog: cat });
    saved.mockRejectedValueOnce(new Error('quota'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    ed.addArea('lawn', square(0, 0, 5, 5));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(ed.saveState).toBe('error');
    await ed.flush();
    expect(ed.saveState).toBe('saved');
    quiet.mockRestore();
  });
  it('never saves a read-only view', async () => {
    const ed = new Editor(project(), { catalog: cat, readonly: true });
    ed.setScenario({ month: 3 });
    await ed.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).not.toHaveBeenCalled();
  });
});

describe('gates when a line vertex is deleted', () => {
  // Segments: 0 (0,0)→(4,0) length 4 · 1 (4,0)→(4,3) length 3 · 2 (4,3)→(10,3) length 6.
  const pts: [number, number][] = [[0, 0], [4, 0], [4, 3], [10, 3]];
  it('keeps a fitting gate on segment i−1, re-bases one from segment i and shifts later gates down', () => {
    const [a, b, c] = [gate(0, 1, 1), gate(1, 0.5, 0.4), gate(2, 2, 1)];
    const out = gatesAfterDeletingVertex(pts, [a, b, c], 1); // merged segment (0,0)→(4,3) length 5
    expect(out).toEqual([
      { ...a, segment: 0, offset: 1 },
      { ...b, segment: 0, offset: 4.5 }, // 0.5 + length of old segment 0
      { ...c, segment: 1 }
    ]);
  });
  it('drops a gate that no longer fits the merged segment (offset + width > length)', () => {
    const tooFar = gate(1, 1, 1); // re-based offset 5, width 1 → 6 > 5
    const tooWide = gate(0, 3.5, 2); // 5.5 > 5
    expect(gatesAfterDeletingVertex(pts, [tooFar, tooWide], 1)).toEqual([]);
    const exact = gate(1, 0, 1); // 4 + 1 = 5 fits exactly
    expect(gatesAfterDeletingVertex(pts, [exact], 1)).toEqual([{ ...exact, segment: 0, offset: 4 }]);
  });
  it('deleting an end vertex drops the gates on the vanished segment', () => {
    const [a, b, c] = [gate(0, 1, 1), gate(1, 1, 1), gate(2, 1, 1)];
    expect(gatesAfterDeletingVertex(pts, [a, b, c], 0)).toEqual([{ ...b, segment: 0 }, { ...c, segment: 1 }]);
    expect(gatesAfterDeletingVertex(pts, [a, b, c], 3)).toEqual([a, b]);
  });
  it('a two-point line keeps its points and gates', () => {
    const two: [number, number][] = [[0, 0], [5, 0]];
    const g = [gate(0, 1, 1)];
    expect(gatesAfterDeletingVertex(two, g, 0)).toBe(g);
    const l = line(two, g);
    const ed = new Editor(project({ lines: [l] }), { catalog: cat });
    ed.deleteVertex({ kind: 'line', id: l.id }, 0);
    expect(ed.project.lines[0].points).toEqual(two);
    expect(ed.undoCount).toBe(0);
  });
  it('Editor.deleteVertex applies the rule as one undo step', () => {
    const l = line(pts, [gate(0, 1, 1), gate(1, 1, 1), gate(2, 2, 1)]);
    const ed = new Editor(project({ lines: [l] }), { catalog: cat });
    ed.deleteVertex({ kind: 'line', id: l.id }, 1);
    const after = ed.project.lines[0];
    expect(after.points).toEqual([[0, 0], [4, 3], [10, 3]]);
    expect(after.gates.map((g) => [g.segment, g.offset])).toEqual([[0, 1], [1, 2]]);
    expect(ed.undoCount).toBe(1);
    ed.undo();
    expect(ed.project.lines[0]).toEqual(l);
  });
  it('inserting a vertex moves a gate beyond it onto the new segment', () => {
    const g = [gate(0, 3, 0.5), gate(0, 1, 0.5), gate(1, 1, 1)];
    expect(gatesAfterInsertingVertex(pts, g, 0, [2, 0])).toEqual([{ ...g[0], segment: 1, offset: 1 }, g[1], { ...g[2], segment: 2 }]);
  });
});

describe('overrides', () => {
  it('reads a missing subjectId (iOS nil) and the project id as site-level', () => {
    expect(subjectKey(undefined, 'pid')).toBe('');
    expect(subjectKey(null, 'pid')).toBe('');
    expect(subjectKey('', 'pid')).toBe('');
    expect(subjectKey('pid', 'pid')).toBe('');
    expect(subjectKey('plant-1', 'pid')).toBe('plant-1');
  });
  it('removeOverride removes an iOS-written site-level override that has no subjectId', () => {
    const p = project({ overrides: [{ ruleId: 'OL-BLOOMGAP', note: 'Winter garden' } as unknown as Project['overrides'][number]] });
    const ed = new Editor(p, { catalog: cat });
    ed.removeOverride('OL-BLOOMGAP', '');
    expect(ed.project.overrides).toEqual([]);
    expect(ed.undoCount).toBe(1);
  });
  it('setOverride replaces an existing override for the same subject and writes "" for site level', () => {
    const p = project({ overrides: [{ ruleId: 'OL-UNVERIFIED', subjectId: '00000000-0000-4000-8000-000000000001', note: 'old' }] });
    const ed = new Editor(p, { catalog: cat });
    ed.setOverride('OL-UNVERIFIED', undefined, 'Surveyed in 2026');
    expect(ed.project.overrides).toEqual([{ ruleId: 'OL-UNVERIFIED', subjectId: '', note: 'Surveyed in 2026' }]);
  });
  it('removing an override that is not there is not an edit', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.removeOverride('OL-SUN', 'nobody');
    expect(ed.undoCount).toBe(0);
  });
});
