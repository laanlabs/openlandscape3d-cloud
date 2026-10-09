// Editing session for one site: selection, tools, undo/redo, autosave, derived checks/schedules.
import type { Area, AreaKind, Gate, Line, LineKind, LineStyle, Observation, PlantGroup, PlantInstance, Polygon, Project, Scenario, SiteObject, Status, Vec2, LayerId, WebExtras } from '../model/types';
import { clone, snapshotOf, uid } from '../model/types';
import { catalog as defaultCatalog, commonName, installDims, type Catalog } from '../catalog/catalog';
import { runChecks, type CheckResult } from '../analysis/checks';
import { mixSpacing, resolveGroup } from '../analysis/groups';
import { plantSchedule } from '../analysis/schedule';
import { saveProject } from '../io/storage';
import { dist } from '../model/geometry';
import { gridStep } from '../model/units';
import { makeArea } from '../site/templates';
import { isWebNote, WEB_AUTHOR } from '../model/observations';

export type Selection = { kind: 'plant' | 'area' | 'line' | 'object' | 'group' | 'boundary' | 'observation'; id: string } | null;
export type ViewMode = '2d' | '3d' | 'split';
export type Tool = 'select' | 'boundary' | 'area' | 'line' | 'plant' | 'row' | 'mass' | 'grid' | 'object' | 'note';
export type PlacementTool = 'plant' | 'row' | 'mass' | 'grid';

export const TOOL_KEYS: Record<string, Tool> = { v: 'select', b: 'boundary', a: 'area', l: 'line', p: 'plant', h: 'row', m: 'mass', g: 'grid', o: 'object', n: 'note' };
/** Tools that place one item per click (no shape to draw). */
export const CLICK_TOOLS: readonly Tool[] = ['plant', 'object', 'note'];

/** Autosave delay after the last edit (ms). Drags, tab switches and unloads flush immediately. */
export const SAVE_DEBOUNCE_MS = 150;

/** Keys of `project.web` that are view state: kept across undo/redo, like the scenario. */
const VIEW_WEB_KEYS = ['layers', 'ghostRings', 'hints'] as const;

/** One-time hints the user can dismiss; stored in `project.web.hints` so they stay dismissed on every device the project reaches. */
export type HintId = 'start';

/** Override subjects compare with a missing id read as '' (site-level); iOS writes nil and may write the project id. */
export const subjectKey = (subjectId: unknown, projectId: string) => (subjectId == null || subjectId === '' || subjectId === projectId ? '' : String(subjectId));

/**
 * Gates of a line after removing vertex `index`. Segments index−1 and index merge into one straight
 * run, so a gate on either keeps its place along the fence (a gate on segment index is re-based by the
 * length of the old segment index−1) unless it no longer fits; gates past the vertex shift down one.
 */
export function gatesAfterDeletingVertex(points: Vec2[], gates: Gate[], index: number): Gate[] {
  const last = points.length - 1;
  if (points.length <= 2 || index < 0 || index > last) return gates;
  const out: Gate[] = [];
  for (const g of gates) {
    if (index === 0) { if (g.segment !== 0) out.push({ ...g, segment: g.segment - 1 }); continue; }
    if (index === last) { if (g.segment !== last - 1) out.push(g); continue; }
    if (g.segment < index - 1) { out.push(g); continue; }
    if (g.segment > index) { out.push({ ...g, segment: g.segment - 1 }); continue; }
    const merged = dist(points[index - 1], points[index + 1]);
    const offset = g.segment === index ? g.offset + dist(points[index - 1], points[index]) : g.offset;
    if (offset + g.width > merged + 1e-9) continue;
    out.push({ ...g, segment: index - 1, offset });
  }
  return out;
}

/** Gates of a line after inserting `pt` after vertex `after`: a gate beyond the new vertex moves to the new segment. */
export function gatesAfterInsertingVertex(points: Vec2[], gates: Gate[], after: number, pt: Vec2): Gate[] {
  const first = dist(points[after], pt);
  return gates.map((g) => {
    if (g.segment > after) return { ...g, segment: g.segment + 1 };
    if (g.segment === after && g.offset >= first) return { ...g, segment: after + 1, offset: g.offset - first };
    return g;
  });
}

/** Site object presets (OpenPlan3D outdoor catalog ids and their default sizes, metres). */
export const OBJECT_PRESETS: { id: string; name: string; w: number; d: number; h: number }[] = [
  { id: 'pergola', name: 'Pergola', w: 3, d: 3, h: 2.5 },
  { id: 'gazebo', name: 'Gazebo', w: 3, d: 3, h: 2.8 },
  { id: 'shed', name: 'Garden shed', w: 2, d: 2.5, h: 2.3 },
  { id: 'raised_bed', name: 'Raised bed', w: 1.8, d: 0.9, h: 0.4 },
  { id: 'raised_garden_bed', name: 'Raised garden bed', w: 1.2, d: 0.6, h: 0.4 },
  { id: 'planter_box', name: 'Planter box', w: 0.8, d: 0.3, h: 0.3 },
  { id: 'outdoor_pot_large', name: 'Large pot', w: 0.4, d: 0.4, h: 0.35 },
  { id: 'outdoor_pot_small', name: 'Small pot', w: 0.25, d: 0.25, h: 0.25 },
  { id: 'bench_outdoor', name: 'Bench', w: 1.5, d: 0.5, h: 0.8 },
  { id: 'boulder', name: 'Boulder', w: 1.5, d: 1.2, h: 1 },
  { id: 'rock_large', name: 'Large rock', w: 1, d: 0.8, h: 0.6 },
  { id: 'rock_small', name: 'Small rock', w: 0.3, d: 0.25, h: 0.2 },
  { id: 'pool_round', name: 'Round pool', w: 3, d: 3, h: 0.15 },
  { id: 'spot_light_outdoor', name: 'Spot light', w: 0.15, d: 0.15, h: 0.25 }
];

export class Editor {
  project = $state.raw<Project>(null as unknown as Project);
  readonly cat: Catalog = defaultCatalog;
  selection = $state<Selection>(null);
  view = $state<ViewMode>('split');
  private tool_ = $state<Tool>('select');
  areaKind = $state<AreaKind>('bed');
  lineKind = $state<LineKind>('fence');
  lineStyle = $state<LineStyle>('board');
  objectId = $state('pergola');
  /** Plant mix for placement tools; the first entry is used by the single-plant tool. */
  mix = $state<{ plantId: string; ratio: number }[]>([]);
  placeStatus = $state<Status>('proposed');
  snap = $state(true);
  saveState = $state<'saved' | 'saving' | 'error'>('saved');
  toast = $state<{ text: string; id: number } | null>(null);
  /** Plant id shown in the detail sheet. */
  detailPlantId = $state<string | null>(null);
  hoverIds = $state<string[]>([]);
  /** Observation whose text the Inspector should focus (a note just dropped on the plan). */
  focusNoteId = $state<string | null>(null);
  readonly = false;
  /**
   * Notes written in this editing session and not yet sent anywhere. Only these may be truly deleted:
   * once a note has left this browser the contract makes it append-only (resolve replaces delete).
   */
  private draftNotes = new Set<string>();

  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  undoCount = $state(0);
  redoCount = $state(0);
  private dragSnapshot: Project | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  checks = $derived<CheckResult[]>(runChecks(this.project, this.cat));
  schedule = $derived(plantSchedule(this.project, this.cat));
  codes = $derived(new Map(this.schedule.map((r) => [r.plantId, r.code])));

  constructor(p: Project, opts: { readonly?: boolean; catalog?: Catalog } = {}) {
    // Routes hold the project in $state; keep a plain copy so structuredClone/exports work.
    this.project = $state.snapshot(p) as Project;
    this.cat = opts.catalog ?? defaultCatalog;
    this.readonly = !!opts.readonly;
  }

  get units() { return this.project.web.units; }
  get step() { return gridStep(this.units) / 2; }
  layer(id: LayerId) { return this.project.web.layers?.[id] !== false; }
  get ghost() { return !!this.project.web.ghostRings; }
  hint(id: HintId) { return !!(this.project.web.hints as Partial<Record<HintId, boolean>> | undefined)?.[id]; }

  /**
   * The active tool. Picking a drawing or placement tool deselects, so Delete/Backspace while drawing
   * can only ever touch the shape in progress. Every assignment goes through this setter.
   */
  get tool(): Tool { return this.tool_; }
  set tool(t: Tool) {
    if (t !== 'select') this.selection = null;
    this.tool_ = t;
  }
  setTool(t: Tool) { this.tool = t; }

  /**
   * Arms the placement tools with catalog plants (deep link from a plant page). Unknown ids are
   * reported and dropped. Returns the toast text, '' when nothing was armed or reported.
   */
  arm(plantIds: string[], tool?: PlacementTool): string {
    if (this.readonly) return '';
    const ids = [...new Set(plantIds)];
    const unknown = ids.filter((id) => !this.cat.plant(id));
    const known = ids.filter((id) => this.cat.plant(id));
    const msgs = unknown.map((id) => `${id} is not in this catalog version (${this.cat.version})`);
    if (known.length) {
      this.mix = known.map((id) => ({ plantId: id, ratio: 1 }));
      const t = tool ?? (known.length > 1 ? 'mass' : 'plant');
      this.setTool(t);
      msgs.push(t === 'row' ? 'Draw a line for the hedge' : t === 'plant' ? `Click in the plan to place ${commonName(this.cat.plant(known[0])!).replace(/^./, (c) => c.toUpperCase())} — Esc to stop` : 'Draw an area to plant the mix');
    }
    const text = msgs.join(' · ');
    if (text) this.notify(text);
    return text;
  }

  get selectedPlant(): PlantInstance | undefined { return this.selection?.kind === 'plant' ? this.project.plants.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedArea(): Area | undefined { return this.selection?.kind === 'area' ? this.project.areas.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedLine(): Line | undefined { return this.selection?.kind === 'line' ? this.project.lines.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedObject(): SiteObject | undefined { return this.selection?.kind === 'object' ? this.project.objects.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedGroup(): PlantGroup | undefined { return this.selection?.kind === 'group' ? this.project.groups.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedObservation(): Observation | undefined { return this.selection?.kind === 'observation' ? this.project.observations.find((x) => x.id === this.selection!.id) : undefined; }

  /** Ids highlighted with the selection (a group's instances, or a selected plant). */
  get selectedIds(): Set<string> {
    const s = this.selection;
    if (!s) return new Set();
    if (s.kind === 'group') return new Set(this.selectedGroup?.instanceIds ?? []);
    return new Set([s.id]);
  }

  // ---------- history ----------

  edit(change: (p: Project) => Project, notice?: string) {
    if (this.readonly) return;
    const before = this.project;
    const after = change(before);
    if (after === before) return;
    this.commit(before, { ...after, updatedAt: new Date().toISOString() });
    if (notice) this.notify(notice);
  }

  private commit(before: Project, after: Project) {
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.project = after;
    this.syncCounts();
    this.scheduleSave();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.project);
    this.project = this.carryView(prev);
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project);
    this.project = this.carryView(next);
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
  }

  /** Undo/redo restore edits only: the month/year/hour, layers, canopy rings and dismissed hints are view state and stay put. */
  private carryView(target: Project): Project {
    const cur = this.project;
    const web: Record<string, unknown> = { ...target.web };
    for (const k of VIEW_WEB_KEYS) {
      if (cur.web[k] === undefined) delete web[k];
      else web[k] = cur.web[k];
    }
    return { ...target, scenario: cur.scenario, web: web as WebExtras };
  }

  private syncCounts() { this.undoCount = this.undoStack.length; this.redoCount = this.redoStack.length; }

  private fixSelection() {
    const s = this.selection;
    if (!s) return;
    const p = this.project;
    const ok = s.kind === 'plant' ? p.plants.some((x) => x.id === s.id)
      : s.kind === 'area' ? p.areas.some((x) => x.id === s.id)
      : s.kind === 'line' ? p.lines.some((x) => x.id === s.id)
      : s.kind === 'object' ? p.objects.some((x) => x.id === s.id)
      : s.kind === 'group' ? p.groups.some((x) => x.id === s.id)
      : s.kind === 'observation' ? p.observations.some((x) => x.id === s.id)
      : !!p.site.boundary;
    if (!ok) this.selection = null;
  }

  private scheduleSave() {
    if (this.readonly) return;
    this.saveState = 'saving';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  /** Writes the current project now. Shows 'saved' only if nothing changed while the write was in flight. */
  private async save() {
    const p = this.project;
    try { await saveProject(p); if (this.project === p) this.saveState = 'saved'; }
    catch (e) { console.error(e); this.saveState = 'error'; }
  }

  /** Saves immediately (end of a drag, tab hidden, page unload, or the user's retry after an error). */
  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.readonly) return;
    await this.save();
  }

  notify(text: string) {
    const id = Date.now();
    this.toast = { text, id };
    setTimeout(() => { if (this.toast?.id === id) this.toast = null; }, 3200);
  }

  /** Begin/continue a live drag; `endDrag` commits it as one undo step. */
  live(change: (p: Project) => Project) {
    if (this.readonly) return;
    if (!this.dragSnapshot) this.dragSnapshot = this.project;
    this.project = change(this.project);
  }
  endDrag() {
    const before = this.dragSnapshot;
    this.dragSnapshot = null;
    if (!before || before === this.project) return;
    this.commit(before, { ...this.project, updatedAt: new Date().toISOString() });
    void this.flush();
  }
  get dragging() { return !!this.dragSnapshot; }

  // ---------- view state (saved, not undoable) ----------

  setScenario(patch: Partial<Scenario>) {
    this.project = { ...this.project, scenario: { ...this.project.scenario, ...patch } };
    this.scheduleSave();
  }
  setLayer(id: LayerId, on: boolean) {
    this.project = { ...this.project, web: { ...this.project.web, layers: { ...(this.project.web.layers ?? {}), [id]: on } } };
    this.scheduleSave();
  }
  setGhost(on: boolean) {
    this.project = { ...this.project, web: { ...this.project.web, ghostRings: on } };
    this.scheduleSave();
  }
  /** Dismisses (or restores) a one-time hint. Not an edit, so it is not undoable. */
  setHint(id: HintId, dismissed: boolean) {
    const hints = { ...((this.project.web.hints as Partial<Record<HintId, boolean>> | undefined) ?? {}), [id]: dismissed };
    this.project = { ...this.project, web: { ...this.project.web, hints } };
    this.scheduleSave();
  }

  // ---------- site ----------

  rename(name: string) { this.edit((p) => ({ ...p, name })); }
  setSite(patch: Partial<Project['site']>) { this.edit((p) => ({ ...p, site: { ...p.site, ...patch } })); }
  setWeb(patch: Partial<Project['web']>) { this.edit((p) => ({ ...p, web: { ...p.web, ...patch } })); }
  setBoundary(poly: Polygon | undefined) {
    this.edit((p) => {
      const { boundary: _b, ...site } = p.site;
      return { ...p, site: poly ? { ...site, boundary: poly } : site, verification: { ...p.verification, boundary: false } };
    });
    if (poly) this.selection = { kind: 'boundary', id: 'boundary' };
  }
  setBoundaryVerified(v: boolean) { this.edit((p) => ({ ...p, verification: { ...p.verification, boundary: v } })); }

  // ---------- areas & lines ----------

  addArea(kind: AreaKind, polygon: Polygon) {
    const a = makeArea(kind, polygon, this.cat, `${kind[0].toUpperCase()}${kind.slice(1)} ${this.project.areas.filter((x) => x.kind === kind).length + 1}`);
    this.edit((p) => ({ ...p, areas: [...p.areas, a] }));
    this.selection = { kind: 'area', id: a.id };
  }
  updateArea(id: string, patch: Partial<Area>) {
    this.edit((p) => ({ ...p, areas: p.areas.map((a) => (a.id === id ? clean({ ...a, ...patch }) : a)) }));
  }
  addLine(kind: LineKind, points: Vec2[]) {
    const l: Line = {
      id: uid(), kind, style: kind === 'fence' ? this.lineStyle : kind === 'retaining_wall' ? 'block' : 'steel', points,
      height: kind === 'fence' ? 1.8 : kind === 'retaining_wall' ? 0.6 : 0.1, thickness: kind === 'retaining_wall' ? 0.3 : kind === 'fence' ? 0.1 : 0.01,
      gates: [], materialId: this.cat.materialsFor(kind)[0]?.id
    };
    this.edit((p) => ({ ...p, lines: [...p.lines, l] }));
    this.selection = { kind: 'line', id: l.id };
  }
  updateLine(id: string, patch: Partial<Line>) {
    this.edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }
  addGate(lineId: string, segment: number) {
    const l = this.project.lines.find((x) => x.id === lineId);
    if (!l) return;
    const a = l.points[segment], b = l.points[segment + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const width = Math.min(1, L * 0.8);
    this.updateLine(lineId, { gates: [...l.gates, { id: uid(), segment, offset: Math.max(0, (L - width) / 2), width }] });
  }

  /** Live vertex drag for the boundary, an area or a line. */
  moveVertex(target: { kind: 'boundary' | 'area' | 'line'; id: string }, index: number, pt: Vec2) {
    this.live((p) => {
      const set = (pts: Vec2[]) => pts.map((q, i) => (i === index ? pt : q));
      if (target.kind === 'boundary') return p.site.boundary ? { ...p, site: { ...p.site, boundary: set(p.site.boundary) } } : p;
      if (target.kind === 'area') return { ...p, areas: p.areas.map((a) => (a.id === target.id ? { ...a, polygon: set(a.polygon) } : a)) };
      return { ...p, lines: p.lines.map((l) => (l.id === target.id ? { ...l, points: set(l.points) } : l)) };
    });
  }
  insertVertex(target: { kind: 'boundary' | 'area' | 'line'; id: string }, after: number, pt: Vec2) {
    const ins = (pts: Vec2[]) => [...pts.slice(0, after + 1), pt, ...pts.slice(after + 1)];
    this.edit((p) => {
      if (target.kind === 'boundary') return p.site.boundary ? { ...p, site: { ...p.site, boundary: ins(p.site.boundary) } } : p;
      if (target.kind === 'area') return { ...p, areas: p.areas.map((a) => (a.id === target.id ? { ...a, polygon: ins(a.polygon) } : a)) };
      return { ...p, lines: p.lines.map((l) => (l.id === target.id ? { ...l, points: ins(l.points), gates: gatesAfterInsertingVertex(l.points, l.gates, after, pt) } : l)) };
    });
  }
  /** Removes a corner; polygons keep at least 3 points and lines at least 2 (otherwise nothing changes). */
  deleteVertex(target: { kind: 'boundary' | 'area' | 'line'; id: string }, index: number) {
    const del = (pts: Vec2[]) => pts.filter((_, i) => i !== index);
    this.edit((p) => {
      if (target.kind === 'boundary') {
        const b = p.site.boundary;
        return b && b.length > 3 && index < b.length ? { ...p, site: { ...p.site, boundary: del(b) } } : p;
      }
      if (target.kind === 'area') {
        const a = p.areas.find((x) => x.id === target.id);
        return a && a.polygon.length > 3 && index < a.polygon.length ? { ...p, areas: p.areas.map((x) => (x === a ? { ...a, polygon: del(a.polygon) } : x)) } : p;
      }
      const l = p.lines.find((x) => x.id === target.id);
      if (!l || l.points.length <= 2 || index >= l.points.length) return p;
      return { ...p, lines: p.lines.map((x) => (x === l ? { ...l, points: del(l.points), gates: gatesAfterDeletingVertex(l.points, l.gates, index) } : x)) };
    });
  }

  // ---------- plants ----------

  addPlant(plantId: string, at: Vec2) {
    const plant = this.cat.plant(plantId);
    const d = plant ? installDims(plant) : { code: '#1', heightM: 0.3, spreadM: 0.3 };
    const existing = this.placeStatus !== 'proposed';
    const inst: PlantInstance = {
      id: uid(), plantId, x: at[0], y: at[1], status: this.placeStatus, plantedYear: existing ? -5 : 0,
      installSize: existing ? 'existing' : d.code, installHeight: d.heightM, installSpread: d.spreadM, seed: Math.floor(Math.random() * 1e9)
    };
    this.edit((p) => ({ ...p, plants: [...p.plants, inst] }));
    this.selection = { kind: 'plant', id: inst.id };
  }
  updatePlant(id: string, patch: Partial<PlantInstance>) {
    this.edit((p) => ({ ...p, plants: p.plants.map((x) => (x.id === id ? clean({ ...x, ...patch }) : x)) }));
  }

  addGroup(kind: PlantGroup['kind'], geom: Vec2[]) {
    const mix = this.mix.length ? this.mix.map((m) => ({ ...m })) : [];
    if (!mix.length) { this.notify('Pick a plant (or a mix) in the Plants panel first'); return; }
    const g: PlantGroup = { id: uid(), kind, mix, spacing: mixSpacing(mix, this.cat), ...(kind === 'row' ? { path: geom } : { polygon: geom }), seed: Math.floor(Math.random() * 1e6), instanceIds: [] };
    const inst = resolveGroup(g, this.cat, { status: this.placeStatus });
    g.instanceIds = inst.map((i) => i.id);
    this.edit((p) => ({ ...p, groups: [...p.groups, g], plants: [...p.plants, ...inst] }));
    this.selection = { kind: 'group', id: g.id };
    this.notify(`${inst.length} plants placed — ${kind === 'row' ? 'hedge / row' : kind}`);
  }

  /** Changes a group's recipe and re-resolves its instances (keeping status/planted year). */
  updateGroup(id: string, patch: Partial<PlantGroup>) {
    this.edit((p) => {
      const g0 = p.groups.find((g) => g.id === id);
      if (!g0) return p;
      const g = { ...g0, ...patch };
      const first = p.plants.find((x) => x.groupId === id);
      const inst = resolveGroup(g, this.cat, { status: first?.status, plantedYear: first?.plantedYear });
      g.instanceIds = inst.map((i) => i.id);
      return { ...p, groups: p.groups.map((x) => (x.id === id ? g : x)), plants: [...p.plants.filter((x) => x.groupId !== id), ...inst] };
    });
  }

  /** Live move of a group: geometry and instances by a delta from the drag start. */
  moveGroup(id: string, start: Project, delta: Vec2) {
    this.live(() => {
      const mv = (pts?: Vec2[]) => pts?.map((q) => [q[0] + delta[0], q[1] + delta[1]] as Vec2);
      return {
        ...start,
        groups: start.groups.map((g) => (g.id === id ? { ...g, ...(g.path ? { path: mv(g.path) } : {}), ...(g.polygon ? { polygon: mv(g.polygon) } : {}) } : g)),
        plants: start.plants.map((x) => (x.groupId === id ? { ...x, x: x.x + delta[0], y: x.y + delta[1] } : x))
      };
    });
  }
  /** Live move of an area/line/object/plant/boundary by a delta from the drag start. */
  moveItem(sel: NonNullable<Selection>, start: Project, delta: Vec2) {
    if (sel.kind === 'group') return this.moveGroup(sel.id, start, delta);
    this.live(() => {
      const mv = (pts: Vec2[]) => pts.map((q) => [q[0] + delta[0], q[1] + delta[1]] as Vec2);
      switch (sel.kind) {
        case 'plant': return { ...start, plants: start.plants.map((x) => (x.id === sel.id ? { ...x, x: x.x + delta[0], y: x.y + delta[1] } : x)) };
        case 'object': return { ...start, objects: start.objects.map((x) => (x.id === sel.id ? { ...x, x: x.x + delta[0], y: x.y + delta[1] } : x)) };
        case 'area': return { ...start, areas: start.areas.map((a) => (a.id === sel.id ? { ...a, polygon: mv(a.polygon) } : a)) };
        case 'line': return { ...start, lines: start.lines.map((l) => (l.id === sel.id ? { ...l, points: mv(l.points) } : l)) };
        case 'boundary': return start.site.boundary ? { ...start, site: { ...start.site, boundary: mv(start.site.boundary) } } : start;
        case 'observation': {
          const o = start.observations.find((x) => x.id === sel.id);
          if (!o || !this.canEditObservation(o) || o.x == null || o.y == null) return start;
          return { ...start, observations: start.observations.map((x) => (x === o ? { ...o, x: o.x! + delta[0], y: o.y! + delta[1] } : x)) };
        }
      }
      return start;
    });
  }

  // ---------- objects ----------

  addObject(catalogId: string, at: Vec2) {
    const pre = OBJECT_PRESETS.find((o) => o.id === catalogId) ?? { w: 1, d: 1, h: 1 };
    const o: SiteObject = { id: uid(), catalogId, x: at[0], y: at[1], rotation: 0, width: pre.w, depth: pre.d, height: pre.h, elevation: 0, status: this.placeStatus };
    this.edit((p) => ({ ...p, objects: [...p.objects, o] }));
    this.selection = { kind: 'object', id: o.id };
  }
  updateObject(id: string, patch: Partial<SiteObject>) {
    this.edit((p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  }

  // ---------- selection actions ----------

  removeSelected() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'observation') { this.removeObservation(s.id); return; }
    this.edit((p) => {
      switch (s.kind) {
        case 'plant': {
          const inst = p.plants.find((x) => x.id === s.id);
          return { ...p, plants: p.plants.filter((x) => x.id !== s.id), groups: p.groups.map((g) => (g.id === inst?.groupId ? { ...g, instanceIds: g.instanceIds.filter((i) => i !== s.id) } : g)) };
        }
        case 'group': return { ...p, groups: p.groups.filter((g) => g.id !== s.id), plants: p.plants.filter((x) => x.groupId !== s.id) };
        case 'area': return { ...p, areas: p.areas.filter((a) => a.id !== s.id) };
        case 'line': return { ...p, lines: p.lines.filter((l) => l.id !== s.id) };
        case 'object': return { ...p, objects: p.objects.filter((o) => o.id !== s.id) };
        case 'boundary': { const { boundary: _b, ...site } = p.site; return { ...p, site }; }
      }
      return p;
    }, 'Deleted');
    this.selection = null;
  }

  duplicateSelected() {
    const s = this.selection;
    const off = 1;
    if (s?.kind === 'plant') {
      const x = this.selectedPlant!;
      const { groupId: _g, ...rest } = x;
      const copy = { ...rest, id: uid(), x: x.x + off, y: x.y + off, seed: Math.floor(Math.random() * 1e9) };
      this.edit((p) => ({ ...p, plants: [...p.plants, copy] }));
      this.selection = { kind: 'plant', id: copy.id };
    } else if (s?.kind === 'object') {
      const o = this.selectedObject!;
      const copy = { ...o, id: uid(), x: o.x + off, y: o.y + off };
      this.edit((p) => ({ ...p, objects: [...p.objects, copy] }));
      this.selection = { kind: 'object', id: copy.id };
    } else if (s?.kind === 'area') {
      const a = this.selectedArea!;
      const copy = { ...a, id: uid(), polygon: a.polygon.map(([x, y]) => [x + off, y + off] as Vec2) };
      this.edit((p) => ({ ...p, areas: [...p.areas, copy] }));
      this.selection = { kind: 'area', id: copy.id };
    }
  }

  rotateSelected(by = 15) {
    const o = this.selectedObject;
    if (o) this.updateObject(o.id, { rotation: (((o.rotation + by) % 360) + 360) % 360 });
  }

  // ---------- field notes (observations) ----------

  /**
   * Text and position can be edited only on notes written here (author "web"). Observations from the
   * field are append-only facts: the planner can resolve them, not rewrite them. (Even a web note's
   * edits reach a copy that already has it only as "resolved" — the contract merge keeps the first copy.)
   */
  canEditObservation(o: Observation) { return !this.readonly && isWebNote(o); }
  /** True delete is confined to notes written in this session that have not been exported or shared. */
  canDeleteObservation(o: Observation) { return !this.readonly && isWebNote(o) && this.draftNotes.has(o.id); }

  /** Drops a note at `at` (author "web"), selects it and asks the Inspector to focus its text. */
  addNote(at: Vec2, text = '') {
    if (this.readonly) return;
    const o: Observation = { id: uid(), kind: 'note', createdAt: new Date().toISOString(), author: WEB_AUTHOR, x: at[0], y: at[1], ...(text ? { text } : {}), resolved: false };
    if (!this.layer('notes')) this.setLayer('notes', true);
    this.edit((p) => ({ ...p, observations: [...p.observations, o] }));
    this.draftNotes.add(o.id);
    this.tool = 'select';
    this.selection = { kind: 'observation', id: o.id };
    this.focusNoteId = o.id;
  }

  /** Edits a web note (text, value, position…). Field observations are left alone. `resolved` goes through setResolved. */
  updateObservation(id: string, patch: Partial<Omit<Observation, 'id' | 'resolved'>>) {
    const o = this.project.observations.find((x) => x.id === id);
    if (!o || !this.canEditObservation(o)) return;
    this.edit((p) => ({ ...p, observations: p.observations.map((x) => (x.id === id ? clean({ ...x, ...patch }) : x)) }));
  }

  setResolved(id: string, resolved: boolean, notice?: string) {
    const o = this.project.observations.find((x) => x.id === id);
    if (!o || !!o.resolved === resolved) return;
    this.edit((p) => ({ ...p, observations: p.observations.map((x) => (x.id === id ? { ...x, resolved } : x)) }), notice);
  }

  /** Delete for a draft web note; otherwise resolve, because observations are append-only. */
  removeObservation(id: string) {
    const o = this.project.observations.find((x) => x.id === id);
    if (!o || this.readonly) return;
    if (this.canDeleteObservation(o)) {
      this.edit((p) => ({ ...p, observations: p.observations.filter((x) => x.id !== id) }), 'Note deleted');
      if (this.selection?.id === id) this.selection = null;
    } else if (!o.resolved) {
      this.setResolved(id, true, 'Resolved — field notes are kept, not deleted');
    } else {
      this.notify('Already resolved. Field notes are append-only, so they are kept');
    }
  }

  /** Called when the project leaves this browser (export, link, handoff): its notes become append-only. */
  sealNotes() { this.draftNotes.clear(); }

  // ---------- checks ----------

  /**
   * Accepts a check result with a note (`note`), or removes the override (`note` null). A site-level
   * result has subjectId '' — a missing subjectId (iOS writes nil) or the project id count as the same.
   */
  setOverride(ruleId: string, subjectId: string | null | undefined, note: string | null) {
    this.edit((p) => {
      const key = subjectKey(subjectId, p.id);
      const rest = p.overrides.filter((o) => !(o.ruleId === ruleId && subjectKey(o.subjectId, p.id) === key));
      if (note == null && rest.length === p.overrides.length) return p;
      return { ...p, overrides: note == null ? rest : [...rest, { ruleId, subjectId: key, note }] };
    });
  }
  removeOverride(ruleId: string, subjectId?: string | null) { this.setOverride(ruleId, subjectId, null); }

  /** Select the subject of a check result. */
  selectSubject(id: string | undefined) {
    if (!id) { if (this.project.site.boundary) this.selection = { kind: 'boundary', id: 'boundary' }; return; }
    const p = this.project;
    if (p.plants.some((x) => x.id === id)) this.selection = { kind: 'plant', id };
    else if (p.objects.some((x) => x.id === id)) this.selection = { kind: 'object', id };
    else if (p.areas.some((x) => x.id === id)) this.selection = { kind: 'area', id };
    else if (p.lines.some((x) => x.id === id)) this.selection = { kind: 'line', id };
  }

  // ---------- alternatives ----------

  saveAlternative(name: string) {
    const alt = { id: uid(), name: name || `Option ${String.fromCharCode(65 + this.project.alternatives.length)}`, createdAt: new Date().toISOString(), snapshot: snapshotOf(this.project) };
    this.edit((p) => ({ ...p, alternatives: [...p.alternatives, alt] }), `Saved “${alt.name}” as a design option`);
  }
  restoreAlternative(id: string) {
    const alt = this.project.alternatives.find((a) => a.id === id);
    if (!alt) return;
    this.edit((p) => ({ ...p, ...clone(alt.snapshot) }), `Restored “${alt.name}” — undo to go back`);
    this.selection = null;
  }
  renameAlternative(id: string, name: string) {
    this.edit((p) => ({ ...p, alternatives: p.alternatives.map((a) => (a.id === id ? { ...a, name } : a)) }));
  }
  deleteAlternative(id: string) {
    this.edit((p) => ({ ...p, alternatives: p.alternatives.filter((a) => a.id !== id) }));
  }
}

/** Drops keys explicitly set to undefined so exports stay clean. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
