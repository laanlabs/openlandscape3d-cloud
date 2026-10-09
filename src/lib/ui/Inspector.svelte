<script lang="ts">
  import type { Editor } from './editor.svelte';
  import { OBJECT_PRESETS } from './editor.svelte';
  import LengthInput from './LengthInput.svelte';
  import { AREA_KINDS, INSTALL_SIZES, type Moisture, type Status, type Sun } from '../model/types';
  import { commonName, displayScientific, installDims, matureHeight, matureSpread } from '../catalog/catalog';
  import { sizeAt } from '../analysis/growth';
  import { exposureAt, moistureAt, RULE_INFO } from '../analysis/checks';
  import { fmtArea, fmtLen } from '../model/units';
  import { dist, perimeter, polygonArea, polylineLength } from '../model/geometry';
  import { mixSpacing } from '../analysis/groups';
  import { hasPosition, isWebNote, kindColor, kindLabel, observationNumbers } from '../model/observations';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const u = $derived(p.web.units);
  const L = (m: number) => fmtLen(m, u);
  const sel = $derived(editor.selection);

  const plant = $derived(editor.selectedPlant);
  const area = $derived(editor.selectedArea);
  const line = $derived(editor.selectedLine);
  const obj = $derived(editor.selectedObject);
  const group = $derived(editor.selectedGroup);
  const obs = $derived(editor.selectedObservation);
  const obsNumber = $derived(obs ? observationNumbers(p.observations).get(obs.id) : undefined);
  const linkedPlant = $derived(obs?.plantInstanceId ? p.plants.find((x) => x.id === obs.plantInstanceId) : undefined);
  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
  const authorName = (a: string | undefined) => (a === 'web' ? 'This planner (web)' : a === 'ios' ? 'iOS app' : a || 'Unknown');
  const fmtValue = (v: number, unit?: string) => (unit === 'm' || unit == null ? L(v) : `${Math.round(v * 100) / 100} ${unit}`);

  // A note just dropped on the plan: put the caret in its text box.
  let noteText: HTMLTextAreaElement | undefined = $state();
  $effect(() => {
    if (obs && editor.focusNoteId === obs.id && noteText) {
      noteText.focus();
      editor.focusNoteId = null;
    }
  });
  const subjectChecks = $derived(sel ? editor.checks.filter((c) => c.subjectIds.includes(sel.id)) : []);

  const totals = $derived.by(() => {
    const byKind = new Map<string, number>();
    for (const a of p.areas) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + polygonArea(a.polygon));
    const fence = p.lines.filter((l) => l.kind === 'fence').reduce((s, l) => s + polylineLength(l.points), 0);
    const wall = p.lines.filter((l) => l.kind === 'retaining_wall').reduce((s, l) => s + polylineLength(l.points), 0);
    const edging = p.lines.filter((l) => l.kind === 'edging').reduce((s, l) => s + polylineLength(l.points), 0);
    const proposed = p.plants.filter((x) => x.status === 'proposed').length;
    return { byKind: [...byKind].sort((a, b) => b[1] - a[1]), fence, wall, edging, proposed };
  });
  const numIn = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const val = (e: Event) => (e.currentTarget as HTMLSelectElement | HTMLInputElement).value;
  const optional = <T extends string>(v: string) => (v ? (v as T) : undefined);
  // Note text saves while typing (one undo step per pause), and immediately when the field loses focus.
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  function saveNoteText(id: string, text: string, now = false) {
    clearTimeout(noteTimer);
    const commit = () => editor.updateObservation(id, { text: text || undefined });
    if (now) commit(); else noteTimer = setTimeout(commit, 500);
  }
</script>

<div class="insp">
  {#if plant}
    {@const pl = editor.cat.plant(plant.plantId)}
    {@const s = sizeAt(plant, pl, p.scenario.year)}
    <h3>{pl ? commonName(pl) : 'Unknown plant'}</h3>
    {#if pl}<p class="sci">{displayScientific(pl)} · <button class="link" onclick={() => (editor.detailPlantId = pl.id)}>Plant facts</button></p>
    {:else}<p class="muted small">“{plant.plantId}” isn't in this catalog version. It is kept as a placeholder ({plant.fallback?.category ?? 'no category'}) and exported unchanged.</p>{/if}
    <dl class="kv">
      <dt>Year {p.scenario.year}</dt><dd>{L(s.height)} tall · {L(s.spread)} wide</dd>
      {#if pl}<dt>Mature</dt><dd>{L(matureHeight(pl))} × {L(matureSpread(pl))}</dd>{/if}
      <dt>This spot</dt><dd>{exposureAt(p, [plant.x, plant.y])} sun · {moistureAt(p, [plant.x, plant.y])} soil</dd>
      <dt>Position</dt><dd>{L(plant.x)}, {L(plant.y)}</dd>
    </dl>
    {#if !editor.readonly}
      <label class="field">Status
        <select value={plant.status} onchange={(e) => { const st = val(e) as Status; editor.updatePlant(plant.id, { status: st, ...(st !== 'proposed' && plant.status === 'proposed' ? { installSize: 'existing', plantedYear: plant.plantedYear || -5 } : {}) }); }}>
          <option value="proposed">Proposed</option><option value="existing">Existing</option><option value="retain">Existing — retain</option><option value="remove">Existing — remove</option>
        </select>
      </label>
      {#if plant.status === 'proposed'}
        <label class="field">Install size
          <select value={plant.installSize} onchange={(e) => { const code = val(e); const d = pl ? installDims(pl, code) : null; editor.updatePlant(plant.id, { installSize: code, ...(d ? { installHeight: d.heightM, installSpread: d.spreadM } : {}) }); }}>
            {#each [...new Set([...(pl?.installSizes.map((x) => x.code) ?? []), ...INSTALL_SIZES.filter((x) => x !== 'existing'), String(plant.installSize)])] as c (c)}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label class="field">Planted (years after project start)
          <input type="number" min="0" max="50" value={plant.plantedYear} onchange={(e) => editor.updatePlant(plant.id, { plantedYear: Math.max(0, Math.round(numIn(e))) })} />
        </label>
      {:else}
        <label class="field">Age in years (planted before project start)
          <input type="number" min="0" max="300" value={-plant.plantedYear} onchange={(e) => editor.updatePlant(plant.id, { plantedYear: -Math.max(0, Math.round(numIn(e))) })} />
        </label>
        <div class="grid2">
          <label class="field">Measured height<LengthInput value={plant.measuredHeight ?? s.height} units={u} label="Measured height" onchange={(v) => editor.updatePlant(plant.id, { measuredHeight: v })} /></label>
          <label class="field">Measured spread<LengthInput value={plant.measuredSpread ?? s.spread} units={u} label="Measured spread" onchange={(v) => editor.updatePlant(plant.id, { measuredSpread: v })} /></label>
        </div>
        <label class="field">Condition
          <select value={plant.condition ?? ''} onchange={(e) => editor.updatePlant(plant.id, { condition: optional(val(e)) as any })}>
            <option value="">—</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="dead">Dead</option>
          </select>
        </label>
      {/if}
      <label class="field">Note<input type="text" value={plant.note ?? ''} onchange={(e) => editor.updatePlant(plant.id, { note: val(e) || undefined })} /></label>
      {#if plant.groupId}<button class="btn small" onclick={() => (editor.selection = { kind: 'group', id: plant.groupId! })}>Edit the whole group</button>{/if}
    {:else}
      <dl class="kv">
        <dt>Status</dt><dd>{plant.status === 'proposed' ? `Proposed · ${plant.installSize} install` : plant.status === 'remove' ? 'Existing — to remove' : plant.status === 'retain' ? 'Existing — retain' : 'Existing'}{plant.condition ? ` · ${plant.condition}` : ''}</dd>
        {#if plant.note}<dt>Note</dt><dd>{plant.note}</dd>{/if}
      </dl>
      {#if plant.groupId}<button class="btn small" onclick={() => (editor.selection = { kind: 'group', id: plant.groupId! })}>Show the whole group</button>{/if}
    {/if}
  {:else if group}
    <h3>{group.kind === 'row' ? 'Row / hedge' : group.kind === 'mass' ? 'Drift' : 'Grid planting'}</h3>
    <p class="muted small">{group.instanceIds.length} plants{editor.readonly ? '' : ' · drag any plant of the group to move it all'}</p>
    {#each group.mix as m, i (m.plantId)}
      {@const pl = editor.cat.plant(m.plantId)}
      <div class="mixrow">
        <span class="nm">{pl ? commonName(pl) : m.plantId}</span>
        <span class="muted small">{p.plants.filter((x) => x.groupId === group.id && x.plantId === m.plantId).length}</span>
        {#if !editor.readonly && group.mix.length > 1}
          <input type="number" min="1" max="20" value={m.ratio} aria-label="Ratio" onchange={(e) => editor.updateGroup(group.id, { mix: group.mix.map((x, j) => (j === i ? { ...x, ratio: Math.max(1, numIn(e) || 1) } : x)) })} />
          <button class="x" aria-label="Remove from mix" onclick={() => editor.updateGroup(group.id, { mix: group.mix.filter((_, j) => j !== i) })}>×</button>
        {/if}
      </div>
    {/each}
    {#if !editor.readonly}
      {#if editor.mix.some((m) => !group.mix.some((g) => g.plantId === m.plantId))}
        <button class="btn small" onclick={() => editor.updateGroup(group.id, { mix: [...group.mix, ...editor.mix.filter((m) => !group.mix.some((g) => g.plantId === m.plantId))] })}>Add the plants you're placing to this mix</button>
      {/if}
      <label class="field">Spacing (on centre)<LengthInput value={group.spacing} units={u} min={0.05} max={30} label="Spacing" onchange={(v) => editor.updateGroup(group.id, { spacing: v })} /></label>
      <div class="row">
        <button class="btn small" onclick={() => editor.updateGroup(group.id, { spacing: mixSpacing(group.mix, editor.cat) })}>Catalog spacing</button>
        {#if group.kind === 'mass'}<button class="btn small" onclick={() => editor.updateGroup(group.id, { seed: (group.seed * 7919 + 13) % 1000003 })}>Reshuffle</button>{/if}
      </div>
      <label class="field">Kind
        <select value={group.kind} onchange={(e) => editor.updateGroup(group.id, { kind: val(e) as any })} disabled={group.kind === 'row'}>
          <option value="mass">Drift (natural scatter)</option><option value="grid">Grid</option>{#if group.kind === 'row'}<option value="row">Row / hedge</option>{/if}
        </select>
      </label>
      <p class="muted small">Seed {group.seed} — the same recipe always gives the same layout.</p>
    {/if}
  {:else if area}
    <h3>{area.name}</h3>
    <dl class="kv">
      <dt>Area</dt><dd>{fmtArea(polygonArea(area.polygon), u)}</dd>
      <dt>Perimeter</dt><dd>{L(perimeter(area.polygon))}</dd>
      {#if editor.cat.material(area.materialId)?.priceUsd}{@const m = editor.cat.material(area.materialId)!}<dt>Estimate</dt><dd>${Math.round(m.priceUsd!.low * polygonArea(area.polygon)).toLocaleString()}–${Math.round(m.priceUsd!.high * polygonArea(area.polygon)).toLocaleString()} <span class="muted">(planning range)</span></dd>{/if}
    </dl>
    {#if !editor.readonly}
      <label class="field">Name<input type="text" value={area.name} onchange={(e) => editor.updateArea(area.id, { name: val(e) })} /></label>
      <div class="grid2">
        <label class="field">Kind<select value={area.kind} onchange={(e) => { const kind = val(e) as any; editor.updateArea(area.id, { kind, materialId: editor.cat.materialsFor(kind)[0]?.id ?? area.materialId }); }}>{#each AREA_KINDS as kd (kd)}<option value={kd}>{kd}</option>{/each}</select></label>
        <label class="field">Material<select value={area.materialId ?? ''} onchange={(e) => editor.updateArea(area.id, { materialId: optional(val(e)) })}><option value="">—</option>{#each editor.cat.materialsFor(area.kind).concat(editor.cat.materials.filter((m) => m.kind === 'surface' && !m.appliesTo.includes(area.kind))) as m (m.id)}<option value={m.id}>{m.name}</option>{/each}</select></label>
        <label class="field">Sun here<select value={area.sun ?? ''} onchange={(e) => editor.updateArea(area.id, { sun: optional<Sun>(val(e)) })}><option value="">Site default ({p.site.sun})</option><option value="full">Full</option><option value="part">Part</option><option value="shade">Shade</option></select></label>
        <label class="field">Moisture here<select value={area.moisture ?? ''} onchange={(e) => editor.updateArea(area.id, { moisture: optional<Moisture>(val(e)) })}><option value="">Site default ({p.site.moisture})</option><option value="dry">Dry</option><option value="medium">Medium</option><option value="wet">Wet</option></select></label>
        <label class="field">Elevation<LengthInput value={area.elevation ?? 0} units={u} min={0} max={10} label="Elevation" onchange={(v) => editor.updateArea(area.id, { elevation: v })} /></label>
      </div>
      <label class="check"><input type="checkbox" checked={!!p.verification.measurements?.[area.id]} onchange={(e) => editor.edit((q) => ({ ...q, verification: { ...q.verification, measurements: { ...q.verification.measurements, [area.id]: (e.currentTarget as HTMLInputElement).checked } } }))} /> Measured on site</label>
      <p class="muted small">Drag corners to reshape · click a midpoint to add a corner · double-click a corner to delete it.</p>
    {/if}
  {:else if line}
    <h3>{line.kind === 'fence' ? 'Fence' : line.kind === 'retaining_wall' ? 'Retaining wall' : 'Edging'}</h3>
    <dl class="kv"><dt>Length</dt><dd>{L(polylineLength(line.points))} · {line.points.length - 1} segment{line.points.length === 2 ? '' : 's'}</dd></dl>
    {#if !editor.readonly}
      <div class="grid2">
        <label class="field">Style<select value={line.style} onchange={(e) => editor.updateLine(line.id, { style: val(e) as any })}>
          {#each line.kind === 'fence' ? ['board', 'picket', 'metal', 'rail'] : line.kind === 'retaining_wall' ? ['stone', 'block'] : ['steel', 'stone'] as s (s)}<option value={s}>{s}</option>{/each}
        </select></label>
        <label class="field">Material<select value={line.materialId ?? ''} onchange={(e) => editor.updateLine(line.id, { materialId: optional(val(e)) })}><option value="">—</option>{#each editor.cat.materialsFor(line.kind) as m (m.id)}<option value={m.id}>{m.name}</option>{/each}</select></label>
        <label class="field">Height<LengthInput value={line.height} units={u} min={0.02} max={6} label="Height" onchange={(v) => editor.updateLine(line.id, { height: v })} /></label>
        <label class="field">Thickness<LengthInput value={line.thickness} units={u} min={0.005} max={2} label="Thickness" onchange={(v) => editor.updateLine(line.id, { thickness: v })} /></label>
      </div>
      {#if line.kind === 'fence'}
        <h4>Gates</h4>
        {#each line.gates as g, gi (g.id)}
          <div class="gate">
            <span class="small">Segment {g.segment + 1}</span>
            <label class="field">Width<LengthInput value={g.width} units={u} min={0.3} max={6} label="Gate width" onchange={(v) => editor.updateLine(line.id, { gates: line.gates.map((x, j) => (j === gi ? { ...x, width: v } : x)) })} /></label>
            <label class="field">From start<LengthInput value={g.offset} units={u} min={0} max={200} label="Gate offset" onchange={(v) => editor.updateLine(line.id, { gates: line.gates.map((x, j) => (j === gi ? { ...x, offset: v } : x)) })} /></label>
            <button class="x" aria-label="Remove gate" onclick={() => editor.updateLine(line.id, { gates: line.gates.filter((_, j) => j !== gi) })}>×</button>
          </div>
        {/each}
        <div class="row">
          {#each line.points.slice(0, -1) as q, i (i)}<button class="btn small" onclick={() => editor.addGate(line.id, i)}>＋ Gate on {i + 1} ({L(dist(q, line.points[i + 1]))})</button>{/each}
        </div>
      {/if}
      <label class="check"><input type="checkbox" checked={!!p.verification.measurements?.[line.id]} onchange={(e) => editor.edit((q) => ({ ...q, verification: { ...q.verification, measurements: { ...q.verification.measurements, [line.id]: (e.currentTarget as HTMLInputElement).checked } } }))} /> Measured on site</label>
    {/if}
  {:else if obj}
    <h3>{OBJECT_PRESETS.find((o) => o.id === obj.catalogId)?.name ?? obj.catalogId}</h3>
    {#if !editor.readonly}
      <label class="field">Type<select value={obj.catalogId} onchange={(e) => { const pre = OBJECT_PRESETS.find((o) => o.id === val(e)); editor.updateObject(obj.id, { catalogId: val(e), ...(pre ? { width: pre.w, depth: pre.d, height: pre.h } : {}) }); }}>
        {#each OBJECT_PRESETS as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
        {#if !OBJECT_PRESETS.some((o) => o.id === obj.catalogId)}<option value={obj.catalogId}>{obj.catalogId}</option>{/if}
      </select></label>
      <div class="grid2">
        <label class="field">Width<LengthInput value={obj.width} units={u} min={0.05} max={50} label="Width" onchange={(v) => editor.updateObject(obj.id, { width: v })} /></label>
        <label class="field">Depth<LengthInput value={obj.depth} units={u} min={0.05} max={50} label="Depth" onchange={(v) => editor.updateObject(obj.id, { depth: v })} /></label>
        <label class="field">Height<LengthInput value={obj.height} units={u} min={0.05} max={20} label="Height" onchange={(v) => editor.updateObject(obj.id, { height: v })} /></label>
        <label class="field">Rotation (°)<input type="number" step="15" value={Math.round(obj.rotation)} onchange={(e) => editor.updateObject(obj.id, { rotation: ((numIn(e) % 360) + 360) % 360 })} /></label>
      </div>
      <label class="field">Status<select value={obj.status} onchange={(e) => editor.updateObject(obj.id, { status: val(e) as Status })}><option value="proposed">Proposed</option><option value="existing">Existing</option><option value="retain">Retain</option><option value="remove">Remove</option></select></label>
      <p class="muted small">R rotates 15° · D duplicates · arrows nudge.</p>
    {/if}
  {:else if obs}
    <h3><span class="kdot" style:background={kindColor(obs)} aria-hidden="true"></span>{kindLabel(obs)}{obsNumber ? ` ${obsNumber}` : ''}{obs.resolved ? ' · resolved' : ''}</h3>
    <dl class="kv">
      <dt>Date</dt><dd>{fmtDate(obs.createdAt)}</dd>
      <dt>By</dt><dd>{authorName(obs.author)}</dd>
      <dt>Position</dt><dd>{hasPosition(obs) ? `${L(obs.x)}, ${L(obs.y)}` : 'Not on the plan'}{obs.lat != null ? ' · GPS tagged' : ''}{obs.headingDeg != null ? ` · facing ${Math.round(obs.headingDeg)}°` : ''}</dd>
      {#if obs.value != null}<dt>Value</dt><dd>{fmtValue(obs.value, obs.unit)}</dd>{/if}
      {#if obs.photoFile}<dt>Photo</dt><dd><code>{obs.photoFile}</code><br /><span class="muted small">The photo stays on the device that took it.</span></dd>{/if}
      {#if obs.plantInstanceId}
        <dt>Plant</dt>
        <dd>
          {#if linkedPlant}
            {@const lp = editor.cat.plant(linkedPlant.plantId)}
            <button class="link" onclick={() => (editor.selection = { kind: 'plant', id: linkedPlant.id })}>{lp ? commonName(lp) : linkedPlant.plantId} — select</button>
          {:else}<span class="muted">Not in this design</span>{/if}
        </dd>
      {/if}
    </dl>
    {#if editor.canEditObservation(obs)}
      <label class="field">Note
        <textarea bind:this={noteText} rows="4" value={obs.text ?? ''} placeholder="What should the team know about this spot?" oninput={(e) => saveNoteText(obs.id, (e.currentTarget as HTMLTextAreaElement).value)} onchange={(e) => saveNoteText(obs.id, (e.currentTarget as HTMLTextAreaElement).value, true)}></textarea>
      </label>
    {:else if obs.text}
      <p class="otext">{obs.text}</p>
    {/if}
    {#if !editor.readonly}
      <label class="check"><input type="checkbox" checked={!!obs.resolved} onchange={(e) => editor.setResolved(obs.id, (e.currentTarget as HTMLInputElement).checked)} /> Resolved</label>
      <p class="muted small">{isWebNote(obs)
        ? (editor.canEditObservation(obs) && hasPosition(obs) ? 'Drag the pin to move it. ' : '') + 'Notes are append-only: once the iOS app has this note it keeps that copy, and only Resolved travels back.'
        : 'Captured in the field. Field notes are append-only — resolve it when it has been dealt with; it cannot be edited or deleted here.'}</p>
    {/if}
  {:else if sel?.kind === 'boundary' && p.site.boundary}
    <h3>Property boundary</h3>
    <dl class="kv"><dt>Area</dt><dd>{fmtArea(polygonArea(p.site.boundary), u)}</dd><dt>Perimeter</dt><dd>{L(perimeter(p.site.boundary))}</dd></dl>
    {#if !editor.readonly}
      <label class="check"><input type="checkbox" checked={p.verification.boundary} onchange={(e) => editor.setBoundaryVerified((e.currentTarget as HTMLInputElement).checked)} /> Verified against a survey / plat</label>
      <p class="muted small">Drag corners to adjust; lengths show along each side.</p>
    {/if}
  {:else}
    <h3>{p.name}</h3>
    <dl class="kv">
      <dt>Plants</dt><dd>{p.plants.length} ({totals.proposed} proposed){p.groups.length ? ` · ${p.groups.length} groups` : ''}</dd>
      {#each totals.byKind as [kd, a] (kd)}<dt class="cap">{kd}</dt><dd>{fmtArea(a, u)}</dd>{/each}
      {#if totals.fence}<dt>Fence</dt><dd>{L(totals.fence)}</dd>{/if}
      {#if totals.wall}<dt>Retaining wall</dt><dd>{L(totals.wall)}</dd>{/if}
      {#if totals.edging}<dt>Edging</dt><dd>{L(totals.edging)}</dd>{/if}
      {#if p.observations.length}<dt>Field notes</dt><dd>{p.observations.filter((o) => !o.resolved).length} open · {p.observations.length} in all</dd>{/if}
      {#if p.site.boundary}<dt>Lot</dt><dd>{fmtArea(polygonArea(p.site.boundary), u)}</dd>{/if}
    </dl>
  {/if}

  {#if sel && sel.kind !== 'boundary' && subjectChecks.length}
    <h4>Checks</h4>
    <ul class="checks">
      {#each subjectChecks as c, i (c.ruleId + i)}
        <li class={c.severity}><strong>{RULE_INFO[c.ruleId].title}</strong> — {c.message}</li>
      {/each}
    </ul>
  {/if}

  {#if sel}
    <div class="row foot">
      {#if !editor.readonly}
        {#if sel.kind === 'plant' || sel.kind === 'object' || sel.kind === 'area'}<button class="btn small" onclick={() => editor.duplicateSelected()}>Duplicate</button>{/if}
        {#if obs}
          {#if editor.canDeleteObservation(obs)}<button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>
          {:else if !obs.resolved}<button class="btn small" onclick={() => editor.removeSelected()} title="Field notes are append-only: resolving replaces deleting">Resolve</button>{/if}
        {:else}
          <button class="btn small danger" onclick={() => editor.removeSelected()}>{sel.kind === 'group' ? 'Delete group' : sel.kind === 'boundary' ? 'Remove boundary' : 'Delete'}</button>
        {/if}
      {/if}
      <button class="btn small" onclick={() => (editor.selection = null)}>Done</button>
    </div>
  {/if}
</div>

<style>
  .insp { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 17px; }
  h4 { margin: 6px 0 0; font-size: 13px; }
  .sci { margin: -4px 0 0; font-style: italic; color: var(--ink-soft); font-size: 12px; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; margin: 0; font-size: 13px; }
  .kv dt { color: var(--ink-soft); }
  .kv dd { margin: 0; }
  .cap { text-transform: capitalize; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .check { font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .small { font-size: 12px; margin: 0; }
  .link { background: none; border: 0; color: var(--accent-ink); font-weight: 600; cursor: pointer; padding: 0; font-size: 12px; font-style: normal; }
  .mixrow { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .mixrow .nm { flex: 1; }
  .mixrow input { width: 54px; padding: 3px 5px; }
  .x { border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--ink-soft); }
  .gate { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 6px; align-items: end; }
  .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .checks li { padding: 6px 8px; border-radius: 8px; background: var(--info-bg); }
  .checks li.error { background: var(--danger-bg); }
  .checks li.warning { background: var(--warn-bg); }
  .foot { margin-top: 6px; }
  .kdot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
  .otext { margin: 0; font-size: 13px; white-space: pre-wrap; background: var(--info-bg); padding: 8px 10px; border-radius: 8px; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; font-weight: 400; color: var(--ink); resize: vertical; }
  code { font-size: 12px; }
</style>
