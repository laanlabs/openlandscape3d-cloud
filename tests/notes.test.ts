// Field notes (observations) in the editor: placing, editing, moving, resolving, deleting and undo,
// plus the contract round trip of a note written on the web (EXPORT_FORMAT.md `observations`:
// append-only, merged by id, resolve replaces delete).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Observation, Project } from '../src/lib/model/types';
import { cat, project } from './helpers';

const saved = vi.fn(async (_p: Project) => {});
vi.mock('../src/lib/io/storage', () => ({ saveProject: (p: Project) => saved(p) }));

import { Editor, TOOL_KEYS } from '../src/lib/ui/editor.svelte';
import { fromOpenPlan, toOpenPlan } from '../src/lib/io/openplan';
import { decodePayload, encodePayload, transferJson } from '../src/lib/io/transfer';
import { mergeObservations, observationNumbers, sortObservations } from '../src/lib/model/observations';

const field = (over: Partial<Observation> = {}): Observation => ({
  id: '0e5c1000-0000-4000-8000-0000000000f1', kind: 'issue', createdAt: '2027-02-01T09:00:00Z', author: 'ios',
  x: 4, y: 5, lat: 41.31, lon: -72.92, headingDeg: 200, text: 'Water pools here', resolved: false, ...over
});

beforeEach(() => { vi.useFakeTimers(); saved.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('adding a note', () => {
  it('N is a free tool key for the note placement', () => {
    expect(TOOL_KEYS.n).toBe('note');
    expect(Object.values(TOOL_KEYS).filter((t) => t === 'note')).toHaveLength(1);
  });

  it('drops a web note at the point, selects it, focuses its text and returns to Select — one undo step', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.setTool('note');
    ed.addNote([3, 7]);
    expect(ed.project.observations).toHaveLength(1);
    const o = ed.project.observations[0];
    expect(o).toMatchObject({ kind: 'note', author: 'web', x: 3, y: 7, resolved: false });
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(o.createdAt))).toBe(false);
    expect(ed.selection).toEqual({ kind: 'observation', id: o.id });
    expect(ed.focusNoteId).toBe(o.id);
    expect(ed.tool).toBe('select');
    expect(ed.undoCount).toBe(1);
    ed.undo();
    expect(ed.project.observations).toEqual([]);
    expect(ed.selection).toBeNull();
    ed.redo();
    expect(ed.project.observations).toEqual([o]);
  });

  it('turns the notes layer back on when it was hidden', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.setLayer('notes', false);
    ed.addNote([1, 1]);
    expect(ed.layer('notes')).toBe(true);
  });

  it('does nothing in a read-only view', () => {
    const ed = new Editor(project(), { catalog: cat, readonly: true });
    ed.addNote([1, 1]);
    expect(ed.project.observations).toEqual([]);
  });
});

describe('editing and moving', () => {
  it('edits the text of a web note; clearing it removes the key', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addNote([1, 1]);
    const id = ed.project.observations[0].id;
    ed.updateObservation(id, { text: 'Keep the gate clear' });
    expect(ed.project.observations[0].text).toBe('Keep the gate clear');
    ed.updateObservation(id, { text: undefined });
    expect('text' in ed.project.observations[0]).toBe(false);
    ed.undo();
    expect(ed.project.observations[0].text).toBe('Keep the gate clear');
  });

  it('moves a web note as one undo step', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addNote([1, 1]);
    const id = ed.project.observations[0].id;
    const start = ed.project;
    ed.moveItem({ kind: 'observation', id }, start, [0.5, 0]);
    ed.moveItem({ kind: 'observation', id }, start, [2, 3]);
    ed.endDrag();
    expect(ed.project.observations[0]).toMatchObject({ x: 3, y: 4 });
    expect(ed.undoCount).toBe(2);
    ed.undo();
    expect(ed.project.observations[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('leaves field observations as captured: no text edits, no moves', () => {
    const o = field();
    const ed = new Editor(project({ observations: [o] }), { catalog: cat });
    expect(ed.canEditObservation(ed.project.observations[0])).toBe(false);
    ed.updateObservation(o.id, { text: 'rewritten' });
    const start = ed.project;
    ed.moveItem({ kind: 'observation', id: o.id }, start, [5, 5]);
    ed.endDrag();
    expect(ed.project.observations[0]).toEqual(o);
    expect(ed.undoCount).toBe(0);
  });
});

describe('resolve and delete', () => {
  it('resolves and reopens any observation, each an undo step', () => {
    const o = field();
    const ed = new Editor(project({ observations: [o] }), { catalog: cat });
    ed.setResolved(o.id, true);
    expect(ed.project.observations[0].resolved).toBe(true);
    ed.setResolved(o.id, true); // no change, no step
    expect(ed.undoCount).toBe(1);
    ed.undo();
    expect(ed.project.observations[0].resolved).toBe(false);
  });

  it('Delete on a field observation resolves it instead, with a toast that undoes', () => {
    const o = field();
    const ed = new Editor(project({ observations: [o] }), { catalog: cat });
    ed.selection = { kind: 'observation', id: o.id };
    ed.removeSelected();
    expect(ed.project.observations).toHaveLength(1);
    expect(ed.project.observations[0].resolved).toBe(true);
    expect(ed.toast?.text).toMatch(/Resolved/);
    expect(ed.selection).toEqual({ kind: 'observation', id: o.id });
    ed.undo();
    expect(ed.project.observations[0].resolved).toBe(false);
    // Already resolved: nothing to do but say why it stays.
    ed.setResolved(o.id, true);
    const before = ed.undoCount;
    ed.removeSelected();
    expect(ed.undoCount).toBe(before);
    expect(ed.project.observations).toHaveLength(1);
  });

  it('a note written in this session and not yet sent anywhere can be deleted, and undo brings it back', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addNote([2, 2], 'typo note');
    const o = ed.project.observations[0];
    expect(ed.canDeleteObservation(o)).toBe(true);
    ed.removeSelected();
    expect(ed.project.observations).toEqual([]);
    expect(ed.selection).toBeNull();
    expect(ed.toast?.text).toBe('Note deleted');
    ed.undo();
    expect(ed.project.observations).toEqual([o]);
  });

  it('once exported or shared (sealNotes), a web note is append-only too', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addNote([2, 2], 'sent to the crew');
    ed.sealNotes();
    ed.removeSelected();
    expect(ed.project.observations).toHaveLength(1);
    expect(ed.project.observations[0].resolved).toBe(true);
  });

  it('a web note from an earlier session is not deletable', () => {
    const o = field({ id: '0e5c1000-0000-4000-8000-0000000000f2', kind: 'note', author: 'web', lat: undefined, lon: undefined, headingDeg: undefined });
    const ed = new Editor(project({ observations: [o] }), { catalog: cat });
    expect(ed.canEditObservation(ed.project.observations[0])).toBe(true);
    expect(ed.canDeleteObservation(ed.project.observations[0])).toBe(false);
  });

  it('a selection whose observation vanished on undo is cleared', () => {
    const ed = new Editor(project(), { catalog: cat });
    ed.addNote([1, 1]);
    ed.undo();
    expect(ed.selectedObservation).toBeUndefined();
    expect(ed.selection).toBeNull();
  });
});

describe('ordering, numbering and the contract merge', () => {
  const a = field({ id: 'a', createdAt: '2027-01-01T00:00:00Z' });
  const b = field({ id: 'b', createdAt: '2027-01-02T00:00:00Z' });
  const c = field({ id: 'c', createdAt: '2027-01-03T00:00:00Z' });

  it('numbers in date order; the print numbering skips resolved ones', () => {
    const list = [c, { ...b, resolved: true }, a];
    expect(sortObservations(list).map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect([...observationNumbers(list)]).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect([...observationNumbers(list, true)]).toEqual([['a', 1], ['c', 2]]);
  });

  it('merges like iOS ObservationMerge: union by id, resolved copy wins, never un-resolves, idempotent', () => {
    const local = [a, b];
    const incoming = [{ ...b, resolved: true }, c];
    const merged = mergeObservations(local, incoming);
    expect(merged.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1].resolved).toBe(true);
    expect(mergeObservations(merged, local)).toEqual(merged);
    // The local copy is kept for an id both have (append-only: the first copy stands).
    expect(mergeObservations([{ ...a, text: 'mine' }], [{ ...a, text: 'theirs' }])[0].text).toBe('mine');
  });
});

describe('a web note round-trips exactly like an iOS one', () => {
  const iosFile = () => JSON.parse(readFileSync(join(__dirname, 'fixtures/ios/ios-sample-garden.openplan3d.json'), 'utf8'));

  function withWebNote() {
    const ed = new Editor(fromOpenPlan(iosFile(), cat), { catalog: cat });
    const iosObs = clone(ed.project.observations);
    ed.addNote([6.5, 9.25]);
    const id = ed.project.observations.at(-1)!.id;
    ed.updateObservation(id, { text: 'Move the hose bib before the patio goes in' });
    return { ed, iosObs, note: ed.project.observations.at(-1)! };
  }
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  it('is written to the openlandscape3d block with contract keys only', () => {
    const { ed, iosObs, note } = withWebNote();
    expect(iosObs.length).toBeGreaterThan(0);
    const block = toOpenPlan(ed.project, cat).openlandscape3d;
    const out = block.observations.find((o: any) => o.id === note.id);
    expect(out).toEqual({ id: note.id, kind: 'note', createdAt: note.createdAt, author: 'web', x: 6.5, y: 9.25, text: 'Move the hose bib before the patio goes in', resolved: false });
    // iOS observations are untouched, including their GPS fields in a file export.
    for (const o of iosObs) expect(block.observations.find((x: any) => x.id === o.id)).toEqual(o);
  });

  it('survives the file (webProject), the block alone and the deflated link', async () => {
    const { ed, note } = withWebNote();
    const viaFile = fromOpenPlan(clone(toOpenPlan(ed.project, cat)), cat);
    expect(viaFile.observations).toEqual(ed.project.observations);
    const viaBlock = fromOpenPlan(clone(toOpenPlan(ed.project, cat, { embedWebProject: false })), cat);
    expect(viaBlock.observations).toEqual(ed.project.observations);
    const viaLink = fromOpenPlan((await decodePayload(await encodePayload(transferJson(ed.project, cat)))) as any, cat);
    expect(viaLink.observations.find((o) => o.id === note.id)).toEqual(note);
  });

  it('web → iOS (merge) → web keeps the note, takes iOS resolving it, and never loses one on replace', () => {
    const { ed, note } = withWebNote();
    ed.sealNotes();
    // iOS side: merge the incoming block's observations into its copy, resolve the web note, export.
    const sent = clone(toOpenPlan(ed.project, cat, { embedWebProject: false })).openlandscape3d;
    const ios = iosFile();
    const merged = mergeObservations(ios.openlandscape3d.observations, sent.observations).map((o) => (o.id === note.id ? { ...o, resolved: true } : o));
    ios.openlandscape3d.observations = merged;
    const back = fromOpenPlan(ios, cat);
    expect(back.observations.find((o) => o.id === note.id)).toEqual({ ...note, resolved: true });
    // Meanwhile the web added another note; replacing with the iOS copy merges instead of dropping it.
    ed.addNote([1, 2], 'second thought');
    const second = ed.project.observations.at(-1)!;
    const replaced = mergeObservations(ed.project.observations, back.observations);
    expect(replaced.find((o) => o.id === second.id)).toEqual(second);
    expect(replaced.find((o) => o.id === note.id)?.resolved).toBe(true);
    expect(replaced).toHaveLength(ed.project.observations.length);
  });
});
