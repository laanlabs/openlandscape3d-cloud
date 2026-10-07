<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor, Selection } from './editor.svelte';
  import type { Area, Line, PlantInstance, Project, Vec2 } from '../model/types';
  import { HARD_KINDS } from '../model/types';
  import { bbox, centroid, closestOnSegment, dist, polygonArea, polylineLength, rectCorners, snapTo, wallSegments, wallOpenings } from '../model/geometry';
  import { fmtArea, fmtLen } from '../model/units';
  import { sizeAt, seasonLook, matureRadius } from '../analysis/growth';
  import { commonName, type Plant } from '../catalog/catalog';
  import { rowPoints, gridPoints } from '../analysis/groups';

  let { editor, print = false }: { editor: Editor; print?: boolean } = $props();

  // Literal colours (not CSS variables) so the exported PNG renders identically.
  const C = {
    bg: '#f7f6f1', grid: '#e6e5dc', major: '#d3d2c6', boundary: '#8a5a2b', building: '#4f4a43', buildingFill: '#e9e4da',
    line: '#2b352e', soft: '#98a198', accent: '#2f6b4f', sel: '#1f7a8c', error: '#b4382f', warn: '#c58a1c', text: '#1d2a22'
  };
  const KIND_FILL: Record<string, string> = { lawn: '#9cc47a', bed: '#7a5a3c', mulch: '#7a5a3c', gravel: '#c9bfa8', patio: '#a3a9ad', path: '#c2b59b', deck: '#9c7a5c', driveway: '#6c6f72', water: '#7cc0dc' };
  const SOFT = ['lawn', 'bed', 'mulch', 'gravel'];

  let svg: SVGSVGElement;
  let view = $state({ x: -5, y: -5, w: 40, h: 30 });
  let size = $state({ w: 800, h: 600 });
  let fittedFor = '';
  const p = $derived(editor.project);
  const units = $derived(p.web.units);
  const k = $derived(Math.max(view.w / Math.max(1, size.w), view.h / Math.max(1, size.h))); // metres per px

  export function fit() {
    const pts: Vec2[] = [...(p.site.boundary ?? []), ...p.areas.flatMap((a) => a.polygon), ...p.lines.flatMap((l) => l.points), ...p.plants.map((x) => [x.x, x.y] as Vec2), ...p.objects.map((o) => [o.x, o.y] as Vec2), ...wallSegments(p.building).flatMap((w) => [w.a, w.b])];
    if (!pts.length) pts.push([0, 0], [20, 15]);
    const b = bbox(pts);
    const pad = Math.max(2, (b.max[0] - b.min[0] + b.max[1] - b.min[1]) * 0.06);
    const w = b.max[0] - b.min[0] + pad * 2, h = b.max[1] - b.min[1] + pad * 2;
    const aspect = size.w / Math.max(1, size.h);
    const vw = Math.max(w, h * aspect), vh = vw / aspect;
    view = { x: (b.min[0] + b.max[0]) / 2 - vw / 2, y: (b.min[1] + b.max[1]) / 2 - vh / 2, w: vw, h: vh };
  }

  $effect(() => {
    if (fittedFor !== p.id && size.w > 10 && size.h > 10) { fittedFor = p.id; fit(); }
  });

  function toPlan(e: { clientX: number; clientY: number }): Vec2 {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [r.x, r.y];
  }

  // ---------- snapping ----------
  function vertices(): Vec2[] {
    return [...(p.site.boundary ?? []), ...p.areas.flatMap((a) => a.polygon), ...p.lines.flatMap((l) => l.points), ...wallSegments(p.building).flatMap((w) => [w.a, w.b]), ...draft];
  }
  function snapPoint(pt: Vec2, e?: { altKey?: boolean; shiftKey?: boolean }, exclude?: Vec2): Vec2 {
    if (e?.shiftKey && draft.length) {
      // Constrain to 45° steps from the previous point.
      const last = draft[draft.length - 1];
      const d = dist(pt, last), a = Math.round(Math.atan2(pt[1] - last[1], pt[0] - last[0]) / (Math.PI / 4)) * (Math.PI / 4);
      pt = [last[0] + Math.cos(a) * d, last[1] + Math.sin(a) * d];
    }
    if (!editor.snap || e?.altKey) return pt;
    const tol = 10 * k;
    let best: Vec2 | null = null, bd = tol;
    for (const v of vertices()) {
      if (exclude && v === exclude) continue;
      const d = dist(v, pt);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) return [best[0], best[1]];
    if (e?.shiftKey && draft.length) return pt;
    return [snapTo(pt[0], editor.step), snapTo(pt[1], editor.step)];
  }

  // ---------- drawing ----------
  let draft = $state<Vec2[]>([]);
  let cursor = $state<Vec2 | null>(null);
  const drawing = $derived(['boundary', 'area', 'line', 'row', 'mass', 'grid'].includes(editor.tool));
  const polyTool = $derived(['boundary', 'area', 'mass', 'grid'].includes(editor.tool));
  $effect(() => { editor.tool; draft = []; });

  function finishDraft() {
    const pts = draft;
    if (polyTool && pts.length >= 3) {
      if (editor.tool === 'boundary') editor.setBoundary(pts);
      else if (editor.tool === 'area') editor.addArea(editor.areaKind, pts);
      else editor.addGroup(editor.tool as 'mass' | 'grid', pts);
    } else if (!polyTool && pts.length >= 2) {
      if (editor.tool === 'line') editor.addLine(editor.lineKind, pts);
      else editor.addGroup('row', pts);
    } else return;
    draft = [];
    if (editor.tool === 'boundary') editor.tool = 'select';
  }

  function clickTool(pt: Vec2, e: PointerEvent) {
    if (editor.readonly) return;
    const s = snapPoint(pt, e);
    if (editor.tool === 'plant') {
      const id = editor.mix[0]?.plantId;
      if (!id) { editor.notify('Pick a plant in the Plants panel first'); return; }
      editor.addPlant(id, s);
    } else if (editor.tool === 'object') {
      editor.addObject(editor.objectId, s);
    } else if (drawing) {
      if (polyTool && draft.length >= 3 && dist(s, draft[0]) < 10 * k) return finishDraft();
      if (draft.length && dist(s, draft[draft.length - 1]) < 1e-6) return finishDraft(); // double click
      draft = [...draft, s];
    } else {
      editor.selection = null;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (print || !drawing || (e.target as HTMLElement).closest('input, textarea, select')) return;
    if (e.key === 'Enter') { e.preventDefault(); finishDraft(); }
    else if (e.key === 'Escape') { if (draft.length) { e.preventDefault(); e.stopPropagation(); draft = []; } }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && draft.length) { e.preventDefault(); e.stopPropagation(); draft = draft.slice(0, -1); }
  }

  // ---------- pointer handling ----------
  type Mode =
    | { t: 'pending'; start: { x: number; y: number }; view: typeof view; pt: Vec2; moved: boolean }
    | { t: 'move'; sel: NonNullable<Selection>; from: Vec2; start: Project }
    | { t: 'vertex'; target: { kind: 'boundary' | 'area' | 'line'; id: string }; index: number; orig: Vec2 }
    | null;
  let mode: Mode = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; view: typeof view; mid: Vec2 } | null = null;

  function startMove(e: PointerEvent, sel: NonNullable<Selection>) {
    if (e.button !== 0 || print) return;
    if (drawing || editor.tool === 'plant' || editor.tool === 'object') return; // let the tool handle the click
    e.stopPropagation();
    // Clicking an instance of the selected group drags the whole group.
    const cur = editor.selection;
    if (sel.kind === 'plant' && cur?.kind === 'group' && p.plants.find((x) => x.id === sel.id)?.groupId === cur.id) sel = cur;
    else editor.selection = sel;
    if (editor.readonly) return;
    mode = { t: 'move', sel, from: toPlan(e), start: p };
    svg.setPointerCapture(e.pointerId);
  }

  function startVertex(e: PointerEvent, target: { kind: 'boundary' | 'area' | 'line'; id: string }, index: number, orig: Vec2) {
    if (e.button !== 0 || editor.readonly) return;
    e.stopPropagation();
    mode = { t: 'vertex', target, index, orig };
    svg.setPointerCapture(e.pointerId);
  }

  function onDown(e: PointerEvent) {
    if (print) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...view }, mid: toPlan({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
      mode = null;
      return;
    }
    mode = { t: 'pending', start: { x: e.clientX, y: e.clientY }, view: { ...view }, pt: toPlan(e), moved: false };
    svg.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (print) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const f = pinch.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      view = { x: pinch.mid[0] - (pinch.mid[0] - pinch.view.x) * f, y: pinch.mid[1] - (pinch.mid[1] - pinch.view.y) * f, w: pinch.view.w * f, h: pinch.view.h * f };
      return;
    }
    const pt = toPlan(e);
    cursor = drawing || editor.tool === 'plant' || editor.tool === 'object' ? snapPoint(pt, e) : pt;
    if (!mode) return;
    if (mode.t === 'pending') {
      const dx = e.clientX - mode.start.x, dy = e.clientY - mode.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) mode.moved = true;
      if (mode.moved) view = { ...mode.view, x: mode.view.x - dx * k, y: mode.view.y - dy * k };
    } else if (mode.t === 'move') {
      let d: Vec2 = [pt[0] - mode.from[0], pt[1] - mode.from[1]];
      if (editor.snap && !e.altKey) d = [snapTo(d[0], editor.step), snapTo(d[1], editor.step)];
      editor.moveItem(mode.sel, mode.start, d);
    } else if (mode.t === 'vertex') {
      editor.moveVertex(mode.target, mode.index, snapPoint(pt, e, mode.orig));
    }
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (mode?.t === 'move' || mode?.t === 'vertex') editor.endDrag();
    else if (mode?.t === 'pending' && !mode.moved) clickTool(mode.pt, e);
    mode = null;
  }

  function onWheel(e: WheelEvent) {
    if (print) return;
    e.preventDefault();
    const pt = toPlan(e);
    const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const w = Math.min(2000, Math.max(2, view.w * f));
    const r = w / view.w;
    view = { x: pt[0] - (pt[0] - view.x) * r, y: pt[1] - (pt[1] - view.y) * r, w, h: view.h * r };
  }

  export function zoom(f: number) {
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    view = { x: cx - (view.w * f) / 2, y: cy - (view.h * f) / 2, w: view.w * f, h: view.h * f };
  }

  /** Keyboard nudge of the selection (arrow keys), one snap step (Shift: 10×). */
  export function nudge(dx: number, dy: number) {
    const s = editor.selection;
    if (!s || editor.readonly) return;
    const start = p;
    editor.moveItem(s, start, [dx * editor.step, dy * editor.step]);
    editor.endDrag();
  }

  // ---------- drawing helpers ----------
  const pts = (q: Vec2[]) => q.map((a) => `${a[0].toFixed(3)},${a[1].toFixed(3)}`).join(' ');
  const areaFill = (a: Area) => editor.cat.material(a.materialId)?.color ?? KIND_FILL[a.kind] ?? '#bbb';
  const sortedAreas = $derived([...p.areas].sort((a, b) => Number(!SOFT.includes(a.kind)) - Number(!SOFT.includes(b.kind)) || polygonArea(b.polygon) - polygonArea(a.polygon)));
  const walls = $derived(wallSegments(p.building));
  const openings = $derived(wallOpenings(p.building));
  const flagged = $derived.by(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const r of editor.checks) {
      if (r.severity === 'info') continue;
      for (const id of r.subjectIds) if (m.get(id) !== 'error') m.set(id, r.severity as 'error' | 'warning');
    }
    return m;
  });

  interface PlantDraw { inst: PlantInstance; plant: Plant | undefined; r: number; fill: string; stroke: string; bloom: string | null; off: boolean; ghost: number; symbol: string }
  const plantDraws = $derived.by((): PlantDraw[] => {
    const yr = p.scenario.year, month = p.scenario.month;
    return p.plants.map((inst) => {
      const plant = editor.cat.plant(inst.plantId);
      const s = sizeAt(inst, plant, yr);
      const r = Math.max(0.05, s.spread / 2);
      if (!plant) return { inst, plant, r, fill: '#c8c8c8', stroke: '#777', bloom: null, off: false, ghost: 0, symbol: 'unknown' };
      const look = seasonLook(plant, month, p.site.frost);
      return {
        inst, plant, r, fill: look.foliage, stroke: shade(look.foliage, -0.35), bloom: look.bloom, off: look.leafOff || look.dormant,
        ghost: matureRadius(plant), symbol: plant.representation?.symbol2d ?? (plant.form === 'conifer' ? 'conifer' : plant.form === 'tree' ? 'canopy' : 'shrub')
      };
    }).sort((a, b) => b.r - a.r); // big canopies underneath
  });

  function shade(hex: string, f: number) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => Math.round(Math.max(0, Math.min(255, f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
  }

  // Unit-radius symbol decorations (scaled per plant).
  const SYMBOLS: Record<string, string> = {
    canopy: Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, b = ((i + 1) / 12) * Math.PI * 2; return `${i ? '' : `M${Math.cos(a)},${Math.sin(a)}`}Q${1.18 * Math.cos((a + b) / 2)},${1.18 * Math.sin((a + b) / 2)} ${Math.cos(b)},${Math.sin(b)}`; }).join('') + 'Z',
    conifer: Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; const rr = i % 2 ? 0.72 : 1; return `${i ? 'L' : 'M'}${rr * Math.cos(a)},${rr * Math.sin(a)}`; }).join('') + 'Z',
    shrub: 'M-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0Z',
    clump: 'M-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0Z',
    spiky: Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; const rr = i % 2 ? 0.35 : 1; return `${i ? 'L' : 'M'}${rr * Math.cos(a)},${rr * Math.sin(a)}`; }).join('') + 'Z',
    mat: 'M-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0Z',
    unknown: 'M-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0Z'
  };
  const INNER: Record<string, string> = {
    canopy: 'M-0.06,0a0.06,0.06 0 1,0 0.12,0a0.06,0.06 0 1,0 -0.12,0',
    conifer: 'M0,0L0,-0.7M0,0L0.6,0.35M0,0L-0.6,0.35',
    shrub: 'M-0.55,0a0.55,0.55 0 1,0 1.1,0a0.55,0.55 0 1,0 -1.1,0',
    clump: 'M-0.3,-0.2h0.01M0.3,-0.25h0.01M0,0.3h0.01M0.05,-0.05h0.01',
    spiky: '',
    mat: 'M-0.6,-0.3h1.2M-0.7,0.1h1.4M-0.5,0.5h1',
    unknown: ''
  };

  function lineStroke(l: Line) {
    if (l.kind === 'retaining_wall') return { color: '#7d7468', width: Math.max(l.thickness, 1.5 * k), dash: undefined };
    if (l.kind === 'edging') return { color: '#5b4a3f', width: 1.5 * k, dash: undefined };
    return { color: '#7a5532', width: 2.2 * k, dash: l.style === 'picket' ? `${k * 2} ${k * 3}` : l.style === 'rail' ? `${k * 10} ${k * 4}` : undefined };
  }

  function gateGeom(l: Line, g: Line['gates'][number]) {
    const a = l.points[g.segment], b = l.points[g.segment + 1];
    if (!a || !b) return null;
    const L = dist(a, b) || 1;
    const t0 = Math.max(0, g.offset / L), t1 = Math.min(1, (g.offset + g.width) / L);
    return { a: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0] as Vec2, b: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1] as Vec2 };
  }

  const editTarget = $derived.by((): { kind: 'boundary' | 'area' | 'line'; id: string; pts: Vec2[]; closed: boolean } | null => {
    if (print || editor.readonly) return null;
    const s = editor.selection;
    if (s?.kind === 'boundary' && p.site.boundary) return { kind: 'boundary', id: 'boundary', pts: p.site.boundary, closed: true };
    if (s?.kind === 'area') { const a = p.areas.find((x) => x.id === s.id); return a ? { kind: 'area', id: a.id, pts: a.polygon, closed: true } : null; }
    if (s?.kind === 'line') { const l = p.lines.find((x) => x.id === s.id); return l ? { kind: 'line', id: l.id, pts: l.points, closed: false } : null; }
    return null;
  });

  function segLabels(q: Vec2[], closed: boolean) {
    const out: { at: Vec2; ang: number; text: string }[] = [];
    const n = closed ? q.length : q.length - 1;
    for (let i = 0; i < n; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      const L = dist(a, b);
      if (L / k < 40) continue;
      let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      out.push({ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang, text: fmtLen(L, units) });
    }
    return out;
  }

  const preview = $derived.by(() => {
    if (!drawing || !draft.length) return null;
    const q = cursor ? [...draft, cursor] : draft;
    return { q, area: polyTool && q.length >= 3 ? polygonArea(q) : 0, length: polylineLength(q) };
  });
  const previewPlants = $derived.by((): Vec2[] => {
    if (!preview || !editor.mix.length) return [];
    const spacing = editor.mix.reduce((a, m) => a + (editor.cat.plant(m.plantId)?.spacingM ?? 0.6) * m.ratio, 0) / Math.max(1e-9, editor.mix.reduce((a, m) => a + m.ratio, 0));
    if (editor.tool === 'row' && preview.q.length >= 2) return rowPoints(preview.q, spacing).slice(0, 400);
    if ((editor.tool === 'grid' || editor.tool === 'mass') && preview.q.length >= 3) return gridPoints(preview.q, spacing).slice(0, 400);
    return [];
  });

  // ---------- scale bar & north ----------
  const scaleBar = $derived.by(() => {
    const unit = units === 'imperial' ? 0.3048 : 1;
    const target = (110 * k) / unit;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((f) => f * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { px: (nice * unit) / k, label: units === 'imperial' ? `${nice} ft` : nice >= 1 ? `${nice} m` : `${Math.round(nice * 100)} cm` };
  });
  const northDeg = $derived((Math.atan2(p.site.north[0], -p.site.north[1]) * 180) / Math.PI);

  /** PNG of the current plan view. */
  export async function toPng(scale = 2): Promise<Blob> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(size.w * scale));
    clone.setAttribute('height', String(size.h * scale));
    clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
    const data = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.w * scale; canvas.height = size.h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  }

  onMount(() => () => { mode = null; });

  const cursorStyle = $derived(drawing || editor.tool === 'plant' || editor.tool === 'object' ? 'crosshair' : 'default');
  const labelsOn = $derived(editor.layer('labels'));
</script>

<svelte:window onkeydown={onKey} />

<div class="plan" class:print bind:clientWidth={size.w} bind:clientHeight={size.h} style:cursor={cursorStyle}>
  <svg
    bind:this={svg}
    viewBox="{view.x} {view.y} {view.w} {view.h}"
    preserveAspectRatio="xMidYMid meet"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onpointerleave={() => (cursor = null)}
    onwheel={onWheel}
    role="application"
    aria-label="Site plan. Use the tools panel to draw; arrow keys move the selection."
    font-family="Inter, system-ui, sans-serif"
  >
    <defs>
      <pattern id="grid-minor" width={editor.step * 2} height={editor.step * 2} patternUnits="userSpaceOnUse">
        <path d="M{editor.step * 2} 0H0V{editor.step * 2}" fill="none" stroke={C.grid} stroke-width={k} />
      </pattern>
      <pattern id="grid-major" width={editor.step * 20} height={editor.step * 20} patternUnits="userSpaceOnUse">
        <rect width={editor.step * 20} height={editor.step * 20} fill="url(#grid-minor)" />
        <path d="M{editor.step * 20} 0H0V{editor.step * 20}" fill="none" stroke={C.major} stroke-width={k * 1.2} />
      </pattern>
      <pattern id="hatch-building" width="0.4" height="0.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="0.4" stroke="#cfc7b8" stroke-width="0.08" />
      </pattern>
    </defs>
    <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={C.bg} />
    {#if !print}<rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#grid-major)" />{/if}

    <!-- areas -->
    {#each sortedAreas as a (a.id)}
      {@const visible = SOFT.includes(a.kind) ? editor.layer('planting') || editor.layer('hardscape') : editor.layer('hardscape')}
      {#if visible && a.polygon.length >= 3}
        {@const sel = editor.selection?.kind === 'area' && editor.selection.id === a.id}
        <polygon
          points={pts(a.polygon)}
          fill={areaFill(a)}
          fill-opacity={a.kind === 'bed' || a.kind === 'mulch' ? 0.35 : a.kind === 'lawn' ? 0.45 : 0.75}
          stroke={sel ? C.sel : shade(areaFill(a), -0.3)}
          stroke-width={k * (sel ? 2.5 : 1)}
          stroke-dasharray={a.kind === 'path' ? undefined : undefined}
          onpointerdown={(e) => startMove(e, { kind: 'area', id: a.id })}
          role="button" tabindex="-1" aria-label="{a.name} ({a.kind})"
        />
        {#if a.kind === 'water'}<polygon points={pts(a.polygon)} fill="none" stroke="#3d8fb5" stroke-width={k * 0.8} stroke-dasharray="{k * 6} {k * 4}" pointer-events="none" />{/if}
        {#if labelsOn && polygonArea(a.polygon) / (k * k) > 2500}
          {@const c = centroid(a.polygon)}
          <text x={c[0]} y={c[1]} font-size={k * 11} text-anchor="middle" fill={C.text} opacity=".8" pointer-events="none">
            <tspan x={c[0]} font-weight="600">{a.name}</tspan>
            <tspan x={c[0]} dy={k * 13}>{fmtArea(polygonArea(a.polygon), units)}{a.sun ? ` · ${a.sun} sun` : ''}{a.moisture ? ` · ${a.moisture}` : ''}</tspan>
          </text>
        {/if}
      {/if}
    {/each}

    <!-- property boundary -->
    {#if p.site.boundary && p.site.boundary.length >= 2}
      {@const sel = editor.selection?.kind === 'boundary'}
      <polygon points={pts(p.site.boundary)} fill="none" stroke="transparent" stroke-width={k * 12} onpointerdown={(e) => startMove(e, { kind: 'boundary', id: 'boundary' })} role="button" tabindex="-1" aria-label="Property boundary" />
      <polygon points={pts(p.site.boundary)} fill="none" stroke={sel ? C.sel : C.boundary} stroke-width={k * (sel ? 2.5 : 1.8)} stroke-dasharray="{k * 12} {k * 4} {k * 2} {k * 4}" pointer-events="none" />
    {/if}

    <!-- building -->
    {#if editor.layer('building')}
      {#each p.building?.objects ?? [] as o, i (o.identifier ?? i)}
        {#if Array.isArray(o.transform) && Array.isArray(o.dimensions)}
          <polygon points={pts(rectCorners(o.transform[12], o.transform[14], o.dimensions[0], o.dimensions[2], (Math.atan2(o.transform[2], o.transform[0]) * 180) / Math.PI))} fill="none" stroke={C.soft} stroke-width={k} stroke-dasharray="{k * 3} {k * 3}" pointer-events="none" />
        {/if}
      {/each}
      {#if walls.length >= 3}
        {@const poly = walls.map((w) => w.a)}
        <polygon points={pts(poly)} fill="url(#hatch-building)" stroke="none" pointer-events="none" />
      {/if}
      {#each walls as w (w.id)}
        <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke={C.building} stroke-width={Math.max(w.thickness, k * 2)} stroke-linecap="square" pointer-events="none" />
      {/each}
      {#each openings as o (o.id)}
        {@const dx = (Math.cos(o.angle) * o.width) / 2}
        {@const dy = (Math.sin(o.angle) * o.width) / 2}
        <line x1={o.center[0] - dx} y1={o.center[1] - dy} x2={o.center[0] + dx} y2={o.center[1] + dy} stroke={o.kind === 'window' ? '#7cc0dc' : '#f7f6f1'} stroke-width={Math.max(0.12, k * 3)} pointer-events="none" />
      {/each}
      {#if labelsOn}
        {#each p.building?.sections ?? [] as s, i (i)}
          {#if Array.isArray(s.center)}<text x={s.center[0]} y={s.center[2]} font-size={k * 12} text-anchor="middle" fill={C.building} font-weight="600" pointer-events="none">{s.displayName ?? 'Building'}</text>{/if}
        {/each}
      {/if}
    {/if}

    <!-- lines -->
    {#if editor.layer('hardscape')}
      {#each p.lines as l (l.id)}
        {@const st = lineStroke(l)}
        {@const sel = editor.selection?.kind === 'line' && editor.selection.id === l.id}
        <polyline points={pts(l.points)} fill="none" stroke="transparent" stroke-width={k * 12} onpointerdown={(e) => startMove(e, { kind: 'line', id: l.id })} role="button" tabindex="-1" aria-label="{l.kind.replace('_', ' ')}" />
        <polyline points={pts(l.points)} fill="none" stroke={sel ? C.sel : st.color} stroke-width={st.width} stroke-dasharray={st.dash} stroke-linejoin="round" pointer-events="none" />
        {#if l.kind === 'fence'}
          {#each l.points as q, i (i)}<rect x={q[0] - k * 2.5} y={q[1] - k * 2.5} width={k * 5} height={k * 5} fill={st.color} pointer-events="none" />{/each}
          {#each l.gates as g (g.id)}
            {@const gg = gateGeom(l, g)}
            {#if gg}<line x1={gg.a[0]} y1={gg.a[1]} x2={gg.b[0]} y2={gg.b[1]} stroke={C.bg} stroke-width={k * 4} pointer-events="none" /><line x1={gg.a[0]} y1={gg.a[1]} x2={gg.b[0]} y2={gg.b[1]} stroke={st.color} stroke-width={k * 1} stroke-dasharray="{k * 2} {k * 2}" pointer-events="none" />{/if}
          {/each}
        {/if}
        {#if sel}
          {#each segLabels(l.points, false) as s, i (i)}<text x={s.at[0]} y={s.at[1]} dy={-k * 6} transform="rotate({s.ang} {s.at[0]} {s.at[1]})" font-size={k * 10.5} text-anchor="middle" fill={C.sel} font-weight="600" pointer-events="none">{s.text}</text>{/each}
        {/if}
      {/each}
    {/if}

    <!-- site objects -->
    {#if editor.layer('hardscape')}
      {#each p.objects as o (o.id)}
        {@const sel = editor.selection?.kind === 'object' && editor.selection.id === o.id}
        {@const flag = flagged.get(o.id)}
        <g onpointerdown={(e) => startMove(e, { kind: 'object', id: o.id })} role="button" tabindex="-1" aria-label={o.catalogId.replace(/_/g, ' ')}>
          <polygon points={pts(rectCorners(o.x, o.y, o.width, o.depth, o.rotation))} fill={o.catalogId.includes('pool') ? '#7cc0dc' : o.catalogId.includes('rock') || o.catalogId === 'boulder' ? '#a8a29e' : '#c9b38f'} fill-opacity=".8" stroke={sel ? C.sel : flag === 'warning' ? C.warn : '#6b5a45'} stroke-width={k * (sel ? 2.5 : 1)} stroke-dasharray={o.status === 'remove' ? `${k * 4} ${k * 3}` : undefined} />
          {#if labelsOn && Math.min(o.width, o.depth) / k > 26}<text x={o.x} y={o.y} font-size={k * 10} text-anchor="middle" dominant-baseline="middle" fill={C.text} pointer-events="none">{o.catalogId.replace(/_/g, ' ')}</text>{/if}
        </g>
      {/each}
    {/if}

    <!-- plants -->
    {#if editor.layer('planting')}
      {#if editor.ghost}
        {#each plantDraws as d (d.inst.id)}
          {#if d.ghost > d.r + 0.05}<circle cx={d.inst.x} cy={d.inst.y} r={d.ghost} fill="none" stroke={d.stroke} stroke-opacity=".45" stroke-width={k} stroke-dasharray="{k * 3} {k * 3}" pointer-events="none" />{/if}
        {/each}
      {/if}
      {#each plantDraws as d (d.inst.id)}
        {@const sel = editor.selectedIds.has(d.inst.id)}
        {@const flag = flagged.get(d.inst.id)}
        {@const code = editor.codes.get(d.inst.plantId)}
        <g transform="translate({d.inst.x} {d.inst.y})" onpointerdown={(e) => startMove(e, { kind: 'plant', id: d.inst.id })} role="button" tabindex="-1" aria-label={d.plant ? commonName(d.plant) : `Unknown plant ${d.inst.plantId}`} opacity={d.inst.status === 'remove' ? 0.55 : 1}>
          {#if d.symbol === 'unknown'}
            <circle r={d.r} fill="#e5e5e5" stroke="#777" stroke-width={k * 1.2} stroke-dasharray="{k * 3} {k * 2}" />
            <text font-size={Math.min(d.r, k * 14)} text-anchor="middle" dominant-baseline="central" fill="#555">?</text>
          {:else}
            <path d={SYMBOLS[d.symbol] ?? SYMBOLS.shrub} transform="scale({d.r})" fill={d.off ? 'none' : d.fill} fill-opacity={d.off ? 0 : 0.78} stroke={sel ? C.sel : d.stroke} stroke-width={k * (sel ? 2.5 : 1)} vector-effect="non-scaling-stroke" stroke-dasharray={d.off ? `${k * 3} ${k * 2}` : undefined} />
            {#if INNER[d.symbol]}<path d={INNER[d.symbol]} transform="scale({d.r})" fill={d.symbol === 'shrub' ? 'none' : d.stroke} stroke={d.stroke} stroke-opacity=".7" stroke-width={k} vector-effect="non-scaling-stroke" stroke-linecap="round" />{/if}
            {#if d.bloom}<circle r={Math.max(d.r * 0.32, k * 2.5)} fill={d.bloom} stroke="#fff" stroke-width={k * 0.8} />{/if}
          {/if}
          {#if d.inst.status === 'existing' || d.inst.status === 'retain'}<circle r={d.r + k * 2} fill="none" stroke="#4f4a43" stroke-width={k} />{/if}
          {#if d.inst.status === 'remove'}<path d="M{-d.r * 0.7},{-d.r * 0.7}L{d.r * 0.7},{d.r * 0.7}M{d.r * 0.7},{-d.r * 0.7}L{-d.r * 0.7},{d.r * 0.7}" stroke={C.error} stroke-width={k * 2} />{/if}
          {#if flag && !print}<circle cx={d.r * 0.72} cy={-d.r * 0.72} r={k * 3.5} fill={flag === 'error' ? C.error : C.warn} stroke="#fff" stroke-width={k} />{/if}
          {#if labelsOn && code && d.r / k > 11}<text font-size={Math.min(k * 10, d.r * 0.6)} text-anchor="middle" dominant-baseline="central" fill="#fff" stroke={d.stroke} stroke-width={k * 2.2} paint-order="stroke" font-weight="700" pointer-events="none">{code}</text>{/if}
        </g>
      {/each}
    {/if}

    <!-- vertex editing -->
    {#if editTarget}
      {#each segLabels(editTarget.pts, editTarget.closed) as s, i (i)}<text x={s.at[0]} y={s.at[1]} dy={-k * 6} transform="rotate({s.ang} {s.at[0]} {s.at[1]})" font-size={k * 10.5} text-anchor="middle" fill={C.sel} font-weight="600" pointer-events="none" data-noexport>{s.text}</text>{/each}
      {#each editTarget.pts as q, i (i)}
        {@const nx = editTarget.pts[(i + 1) % editTarget.pts.length]}
        {#if editTarget.closed || i < editTarget.pts.length - 1}
          <circle data-noexport cx={(q[0] + nx[0]) / 2} cy={(q[1] + nx[1]) / 2} r={k * 4} fill="#fff" stroke={C.sel} stroke-width={k} opacity=".8" class="mid"
            onpointerdown={(e) => { e.stopPropagation(); editor.insertVertex(editTarget!, i, [(q[0] + nx[0]) / 2, (q[1] + nx[1]) / 2]); }} role="button" tabindex="-1" aria-label="Add a point here" />
        {/if}
      {/each}
      {#each editTarget.pts as q, i (i)}
        <rect data-noexport x={q[0] - k * 5} y={q[1] - k * 5} width={k * 10} height={k * 10} fill={C.sel} stroke="#fff" stroke-width={k * 1.5} class="handle"
          onpointerdown={(e) => startVertex(e, editTarget!, i, q)} ondblclick={() => editor.deleteVertex(editTarget!, i)} role="button" tabindex="-1" aria-label="Move point {i + 1} (double-click to delete)" />
      {/each}
    {/if}

    <!-- drawing preview -->
    {#if preview}
      {#if polyTool && preview.q.length >= 3}<polygon data-noexport points={pts(preview.q)} fill={C.accent} fill-opacity=".12" stroke="none" pointer-events="none" />{/if}
      <polyline data-noexport points={pts(preview.q)} fill="none" stroke={C.accent} stroke-width={k * 2} stroke-dasharray="{k * 6} {k * 4}" pointer-events="none" />
      {#each previewPlants as q, i (i)}<circle data-noexport cx={q[0]} cy={q[1]} r={k * 3} fill={C.accent} opacity=".5" pointer-events="none" />{/each}
      {#each draft as q, i (i)}<circle data-noexport cx={q[0]} cy={q[1]} r={k * (i === 0 && polyTool ? 6 : 4)} fill={i === 0 ? '#fff' : C.accent} stroke={C.accent} stroke-width={k * 1.5} pointer-events="none" />{/each}
      {#each segLabels(preview.q, false) as s, i (i)}<text data-noexport x={s.at[0]} y={s.at[1]} dy={-k * 6} transform="rotate({s.ang} {s.at[0]} {s.at[1]})" font-size={k * 11} text-anchor="middle" fill={C.accent} font-weight="700" pointer-events="none">{s.text}</text>{/each}
    {/if}
    {#if cursor && !print && (drawing || editor.tool === 'plant' || editor.tool === 'object')}
      <circle data-noexport cx={cursor[0]} cy={cursor[1]} r={k * 3} fill="none" stroke={C.accent} stroke-width={k * 1.5} pointer-events="none" />
    {/if}
  </svg>

  <div class="overlay" aria-hidden="true">
    <div class="north" title="North"><svg width="34" height="34" viewBox="-17 -17 34 34" style:transform="rotate({northDeg}deg)"><circle r="15" fill="#fff" stroke="#c9c8bd" /><path d="M0,-12 L5,4 L0,1 L-5,4Z" fill="#2b352e" /><text y="12" font-size="8" text-anchor="middle" fill="#2b352e" font-weight="700">N</text></svg></div>
    <div class="scale"><span style:width="{scaleBar.px}px"></span>{scaleBar.label}</div>
  </div>
  {#if preview && !print}
    <div class="readout" role="status">
      {#if polyTool && preview.area > 0}<strong>{fmtArea(preview.area, units)}</strong> · {/if}{fmtLen(preview.length, units)} · {draft.length} point{draft.length === 1 ? '' : 's'}
      <span class="muted">— {polyTool ? 'click the first point or press Enter to close' : 'double-click or Enter to finish'} · Backspace undoes a point · Esc cancels{editor.snap ? ' · Alt: no snap' : ''} · Shift: 45°</span>
    </div>
  {:else if !print && !editor.readonly && editor.tool !== 'select'}
    <div class="readout muted" role="status">
      {editor.tool === 'plant' ? 'Click to place the selected plant' : editor.tool === 'object' ? 'Click to place the object' : editor.tool === 'boundary' ? 'Click the property corners' : editor.tool === 'row' ? 'Click along the hedge / row line' : editor.tool === 'area' ? `Click the corners of the ${editor.areaKind}` : editor.tool === 'line' ? `Click along the ${editor.lineKind.replace('_', ' ')}` : `Click the corners of the ${editor.tool} planting`}
    </div>
  {/if}
  {#if !print}
    <div class="zoom" role="toolbar" aria-label="Zoom">
      <button class="chip" onclick={() => zoom(0.8)} aria-label="Zoom in">＋</button>
      <button class="chip" onclick={() => zoom(1.25)} aria-label="Zoom out">−</button>
      <button class="chip" onclick={fit} title="Fit the site">Fit</button>
    </div>
  {/if}
</div>

<style>
  .plan { position: relative; width: 100%; height: 100%; overflow: hidden; background: #f7f6f1; touch-action: none; user-select: none; }
  svg { display: block; width: 100%; height: 100%; }
  .handle { cursor: move; }
  .mid { cursor: copy; }
  .overlay { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; }
  .scale { font-size: 11px; color: #2b352e; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.8); padding: 2px 6px; border-radius: 6px; }
  .scale span { display: inline-block; height: 6px; border: 1.5px solid #2b352e; border-top: 0; }
  .readout { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); background: rgba(255,255,255,.95); border: 1px solid var(--border); border-radius: 10px; padding: 6px 12px; font-size: 12px; box-shadow: var(--shadow); max-width: calc(100% - 24px); text-align: center; }
  .zoom { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 4px; }
  .print .overlay { right: 6px; bottom: 6px; }
</style>
