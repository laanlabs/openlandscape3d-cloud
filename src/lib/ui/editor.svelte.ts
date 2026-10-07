// Editing session for one site: selection, tools, undo/redo, autosave, derived checks/schedules.
import type { Area, AreaKind, Line, LineKind, LineStyle, PlantGroup, PlantInstance, Polygon, Project, Scenario, SiteObject, Status, Vec2, LayerId } from '../model/types';
import { clone, snapshotOf, uid } from '../model/types';
import { catalog as defaultCatalog, installDims, type Catalog } from '../catalog/catalog';
import { runChecks, type CheckResult } from '../analysis/checks';
import { mixSpacing, resolveGroup } from '../analysis/groups';
import { plantSchedule } from '../analysis/schedule';
import { saveProject } from '../io/storage';
import { gridStep } from '../model/units';
import { makeArea } from '../site/templates';

export type Selection = { kind: 'plant' | 'area' | 'line' | 'object' | 'group' | 'boundary'; id: string } | null;
export type ViewMode = '2d' | '3d' | 'split';
export type Tool = 'select' | 'boundary' | 'area' | 'line' | 'plant' | 'row' | 'mass' | 'grid' | 'object';

export const TOOL_KEYS: Record<string, Tool> = { v: 'select', b: 'boundary', a: 'area', l: 'line', p: 'plant', h: 'row', m: 'mass', g: 'grid', o: 'object' };

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
  tool = $state<Tool>('select');
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
  readonly = false;

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

  get selectedPlant(): PlantInstance | undefined { return this.selection?.kind === 'plant' ? this.project.plants.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedArea(): Area | undefined { return this.selection?.kind === 'area' ? this.project.areas.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedLine(): Line | undefined { return this.selection?.kind === 'line' ? this.project.lines.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedObject(): SiteObject | undefined { return this.selection?.kind === 'object' ? this.project.objects.find((x) => x.id === this.selection!.id) : undefined; }
  get selectedGroup(): PlantGroup | undefined { return this.selection?.kind === 'group' ? this.project.groups.find((x) => x.id === this.selection!.id) : undefined; }

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
    this.project = prev;
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project);
    this.project = next;
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
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
      : !!p.site.boundary;
    if (!ok) this.selection = null;
  }

  private scheduleSave() {
    if (this.readonly) return;
    this.saveState = 'saving';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try { await saveProject(this.project); this.saveState = 'saved'; }
      catch (e) { console.error(e); this.saveState = 'error'; }
    }, 350);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.readonly) await saveProject(this.project);
    this.saveState = 'saved';
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
      return { ...p, lines: p.lines.map((l) => (l.id === target.id ? { ...l, points: ins(l.points), gates: l.gates.map((g) => (g.segment > after ? { ...g, segment: g.segment + 1 } : g)) } : l)) };
    });
  }
  deleteVertex(target: { kind: 'boundary' | 'area' | 'line'; id: string }, index: number) {
    const del = (pts: Vec2[], min: number) => (pts.length > min ? pts.filter((_, i) => i !== index) : pts);
    this.edit((p) => {
      if (target.kind === 'boundary') return p.site.boundary ? { ...p, site: { ...p.site, boundary: del(p.site.boundary, 3) } } : p;
      if (target.kind === 'area') return { ...p, areas: p.areas.map((a) => (a.id === target.id ? { ...a, polygon: del(a.polygon, 3) } : a)) };
      return { ...p, lines: p.lines.map((l) => (l.id === target.id ? { ...l, points: del(l.points, 2), gates: l.gates.filter((g) => g.segment < l.points.length - 2) } : l)) };
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

  // ---------- checks ----------

  setOverride(ruleId: string, subjectId: string, note: string | null) {
    this.edit((p) => {
      const rest = p.overrides.filter((o) => !(o.ruleId === ruleId && o.subjectId === subjectId));
      return { ...p, overrides: note == null ? rest : [...rest, { ruleId, subjectId, note }] };
    });
  }

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
    this.edit((p) => ({ ...p, alternatives: [...p.alternatives, alt] }), `Saved “${alt.name}”`);
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
