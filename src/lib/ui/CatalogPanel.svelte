<script lang="ts">
  import type { Editor, Tool } from './editor.svelte';
  import { FORMS, commonName, displayScientific, isDraft, isNativeTo, matureHeight, matureSpread, policiesFor, zoneNumber, type Form, type Plant } from '../catalog/catalog';
  import { fmtLen } from '../model/units';
  import { monthName } from '../analysis/checks';
  import type { Status } from '../model/types';

  let { editor }: { editor: Editor } = $props();

  let q = $state('');
  let forms = $state<Form[]>([]);
  let sun = $state<'' | 'full' | 'part' | 'shade'>('');
  let moisture = $state<'' | 'dry' | 'medium' | 'wet'>('');
  let nativeOnly = $state(false);
  let hardyOnly = $state(true);
  let bloomMonth = $state(0);
  let color = $state('');
  let maxHeight = $state(0);
  let maintenance = $state('');
  let deer = $state('');
  let wildlife = $state('');
  let showFilters = $state(false);

  const p = $derived(editor.project);
  const region = $derived(editor.cat.region(p.site.regionId));
  const zone = $derived(zoneNumber(p.site.hardiness.zone));
  const colors = $derived([...new Set(editor.cat.plants.map((x) => x.bloom?.colorName).filter(Boolean) as string[])].sort());
  const wildlifeOpts = $derived([...new Set(editor.cat.plants.flatMap((x) => x.wildlife ?? []))].sort());

  const restricted = (pl: Plant) => policiesFor(pl, region, p.site.regionId).some((x) => ['invasive', 'noxious', 'prohibited'].includes(x.status));
  const hardy = (pl: Plant) => zone >= pl.hardiness.min && zone <= pl.hardiness.max;

  const results = $derived.by(() => {
    const t = q.trim().toLowerCase();
    return editor.cat.plants.filter((pl) => {
      if (t && ![pl.scientificName, pl.cultivar ?? '', pl.family, ...pl.commonNames.map((n) => n.name), ...(pl.tags ?? [])].some((s) => s.toLowerCase().includes(t))) return false;
      if (forms.length && !forms.includes(pl.form)) return false;
      if (sun && !pl.sun.includes(sun)) return false;
      if (moisture && !pl.moisture.includes(moisture)) return false;
      if (nativeOnly && !isNativeTo(pl, p.site.regionId)) return false;
      if (hardyOnly && !hardy(pl)) return false;
      if (bloomMonth && !pl.bloom?.months.includes(bloomMonth)) return false;
      if (color && pl.bloom?.colorName !== color) return false;
      if (maxHeight && matureHeight(pl) > maxHeight) return false;
      if (maintenance && pl.maintenance !== maintenance) return false;
      if (deer && !(deer === 'high' ? pl.deerResistance === 'high' : pl.deerResistance === 'high' || pl.deerResistance === 'medium')) return false;
      if (wildlife && !pl.wildlife?.includes(wildlife)) return false;
      return true;
    }).sort((a, b) => Number(restricted(a)) - Number(restricted(b)) || Number(isNativeTo(b, p.site.regionId)) - Number(isNativeTo(a, p.site.regionId)) || commonName(a).localeCompare(commonName(b)));
  });

  const activeFilters = $derived([forms.length, sun, moisture, nativeOnly, !hardyOnly, bloomMonth, color, maxHeight, maintenance, deer, wildlife].filter(Boolean).length);

  function place(pl: Plant, tool: Tool = 'plant') {
    editor.mix = [{ plantId: pl.id, ratio: 1 }];
    editor.tool = tool;
  }
  function addToMix(pl: Plant) {
    if (editor.mix.some((m) => m.plantId === pl.id)) return;
    editor.mix = [...editor.mix, { plantId: pl.id, ratio: 1 }];
    if (editor.tool === 'select' || editor.tool === 'plant') editor.tool = 'mass';
  }
  function clearFilters() {
    forms = []; sun = ''; moisture = ''; nativeOnly = false; hardyOnly = true; bloomMonth = 0; color = ''; maxHeight = 0; maintenance = ''; deer = ''; wildlife = '';
  }
  const toggleForm = (f: Form) => (forms = forms.includes(f) ? forms.filter((x) => x !== f) : [...forms, f]);
  const placing = $derived(['plant', 'row', 'mass', 'grid'].includes(editor.tool));
  const modes: { id: Tool; name: string; hint: string }[] = [
    { id: 'plant', name: 'Single', hint: 'Click to place one plant (P)' },
    { id: 'row', name: 'Row / hedge', hint: 'Draw a line; plants at catalog spacing (H)' },
    { id: 'mass', name: 'Drift', hint: 'Draw an area; natural scatter of the mix (M)' },
    { id: 'grid', name: 'Grid', hint: 'Draw an area; plants on a square grid (G)' }
  ];
</script>

<div class="cat">
  {#if editor.mix.length}
    <section class="mix" aria-label="Plants to place">
      <div class="mixhead">
        <strong>Placing</strong>
        <button class="link" onclick={() => { editor.mix = []; editor.tool = 'select'; }}>Clear</button>
      </div>
      {#each editor.mix as m, i (m.plantId)}
        {@const pl = editor.cat.plant(m.plantId)}
        <div class="mixrow">
          <span class="dot" style:background={pl?.bloom?.color ?? pl?.foliageColor ?? '#999'}></span>
          <span class="nm">{pl ? commonName(pl) : m.plantId}</span>
          {#if editor.mix.length > 1}
            <label class="ratio"><span class="sr-only">Ratio for {pl ? commonName(pl) : m.plantId}</span>
              <input type="number" min="1" max="20" value={m.ratio} oninput={(e) => (editor.mix = editor.mix.map((x, j) => (j === i ? { ...x, ratio: Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1) } : x)))} />
            </label>
          {/if}
          <button class="x" aria-label="Remove from mix" onclick={() => (editor.mix = editor.mix.filter((_, j) => j !== i))}>×</button>
        </div>
      {/each}
      <div class="seg modes" role="radiogroup" aria-label="Placement mode">
        {#each modes as md (md.id)}
          <button role="radio" aria-checked={editor.tool === md.id} class:on={editor.tool === md.id} title={md.hint} onclick={() => (editor.tool = md.id)}>{md.name}</button>
        {/each}
      </div>
      <label class="field status">As
        <select value={editor.placeStatus} onchange={(e) => (editor.placeStatus = (e.currentTarget as HTMLSelectElement).value as Status)}>
          <option value="proposed">Proposed (new planting)</option>
          <option value="existing">Existing</option>
          <option value="retain">Existing — retain</option>
          <option value="remove">Existing — remove</option>
        </select>
      </label>
      {#if placing}<p class="muted small">{modes.find((x) => x.id === editor.tool)?.hint}. Esc to stop.</p>{/if}
    </section>
  {/if}

  <div class="search">
    <input type="search" placeholder="Search plants, families, tags…" bind:value={q} aria-label="Search plants" />
    <button class="btn small" class:primary={activeFilters > 0} onclick={() => (showFilters = !showFilters)} aria-expanded={showFilters}>Filters{activeFilters ? ` · ${activeFilters}` : ''}</button>
  </div>

  {#if showFilters}
    <section class="filters" aria-label="Plant filters">
      <div class="chips" role="group" aria-label="Form">
        {#each FORMS as f (f)}<button class="chip" class:on={forms.includes(f)} aria-pressed={forms.includes(f)} onclick={() => toggleForm(f)}>{f}</button>{/each}
      </div>
      <div class="grid2">
        <label class="field">Sun<select bind:value={sun}><option value="">Any</option><option value="full">Full sun</option><option value="part">Part sun</option><option value="shade">Shade</option></select></label>
        <label class="field">Soil moisture<select bind:value={moisture}><option value="">Any</option><option value="dry">Dry</option><option value="medium">Medium</option><option value="wet">Wet</option></select></label>
        <label class="field">Blooms in<select bind:value={bloomMonth}><option value={0}>Any month</option>{#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}<option value={m}>{monthName(m)}</option>{/each}</select></label>
        <label class="field">Flower colour<select bind:value={color}><option value="">Any</option>{#each colors as c (c)}<option value={c}>{c}</option>{/each}</select></label>
        <label class="field">Mature height<select bind:value={maxHeight}><option value={0}>Any</option><option value={0.5}>≤ {fmtLen(0.5, editor.units)}</option><option value={1}>≤ {fmtLen(1, editor.units)}</option><option value={2}>≤ {fmtLen(2, editor.units)}</option><option value={5}>≤ {fmtLen(5, editor.units)}</option><option value={10}>≤ {fmtLen(10, editor.units)}</option></select></label>
        <label class="field">Maintenance<select bind:value={maintenance}><option value="">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label class="field">Deer resistance<select bind:value={deer}><option value="">Any</option><option value="medium">Medium or high</option><option value="high">High</option></select></label>
        <label class="field">Wildlife<select bind:value={wildlife}><option value="">Any</option>{#each wildlifeOpts as w (w)}<option value={w}>{w}</option>{/each}</select></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={nativeOnly} /> Native to {region?.name ?? 'this region'}</label>
      <label class="check"><input type="checkbox" bind:checked={hardyOnly} /> Hardy in zone {p.site.hardiness.zone}</label>
      <button class="link" onclick={clearFilters}>Reset filters</button>
    </section>
  {/if}

  <p class="count muted" role="status">{results.length} of {editor.cat.plants.length} plants{editor.cat.fixture ? ' · sample catalog' : ''}</p>
  <ul class="list">
    {#each results as pl (pl.id)}
      {@const bad = restricted(pl)}
      <li class:bad>
        <button class="item" onclick={() => (editor.detailPlantId = pl.id)} aria-label="{commonName(pl)} details">
          <span class="sw" style:background={pl.foliageColor}>{#if pl.bloom}<i style:background={pl.bloom.color}></i>{/if}</span>
          <span class="txt">
            <span class="nm">{commonName(pl)}</span>
            <span class="sci">{displayScientific(pl)}</span>
            <span class="meta">{pl.form} · {fmtLen(matureHeight(pl), editor.units, true)} × {fmtLen(matureSpread(pl), editor.units, true)} · {pl.sun.join('/')}</span>
            <span class="badges">
              {#if isNativeTo(pl, p.site.regionId)}<span class="badge">native</span>{/if}
              {#if bad}<span class="badge bad">invasive here</span>{/if}
              {#if !hardy(pl)}<span class="badge bad">zone {pl.hardiness.min}–{pl.hardiness.max}</span>{/if}
              {#if isDraft(pl)}<span class="badge draft">draft</span>{/if}
            </span>
          </span>
        </button>
        {#if !editor.readonly}
          <div class="acts">
            <button class="btn small" onclick={() => place(pl)} title="Place single plants">Place</button>
            <button class="btn small" onclick={() => addToMix(pl)} title="Add to a hedge, drift or grid mix" aria-label="Add {commonName(pl)} to mix">＋ Mix</button>
          </div>
        {/if}
      </li>
    {:else}
      <li class="empty muted">No plants match. Try fewer filters.</li>
    {/each}
  </ul>
</div>

<style>
  .cat { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .search { display: flex; gap: 6px; }
  .search input { flex: 1; }
  .filters { display: flex; flex-direction: column; gap: 8px; background: var(--bg); border-radius: 10px; padding: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .check { font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .link { background: none; border: 0; color: var(--accent-ink); font-weight: 600; cursor: pointer; padding: 0; font-size: 12px; align-self: flex-start; }
  .count { font-size: 12px; margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .list li { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 10px; padding: 6px; background: var(--panel); }
  .list li.bad { background: #fdf6f5; }
  .item { flex: 1; display: flex; gap: 8px; align-items: flex-start; background: none; border: 0; text-align: left; cursor: pointer; padding: 0; min-width: 0; }
  .sw { width: 30px; height: 30px; border-radius: 50%; flex: none; position: relative; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
  .sw i { position: absolute; width: 12px; height: 12px; border-radius: 50%; right: -2px; bottom: -2px; border: 2px solid #fff; }
  .txt { display: flex; flex-direction: column; min-width: 0; }
  .nm { font-weight: 600; font-size: 13px; }
  .sci { font-style: italic; font-size: 12px; color: var(--ink-soft); }
  .meta { font-size: 11px; color: var(--ink-soft); }
  .badges { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 2px; }
  .acts { display: flex; flex-direction: column; gap: 3px; }
  .empty { justify-content: center; font-size: 13px; }
  .mix { background: var(--accent-bg); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .mixhead { display: flex; justify-content: space-between; align-items: center; }
  .mixrow { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .mixrow .nm { flex: 1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .ratio input { width: 52px; padding: 3px 5px; }
  .x { border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--ink-soft); }
  .modes { width: 100%; }
  .modes button { flex: 1; padding: 5px 4px; font-size: 12px; }
  .status { flex-direction: row; align-items: center; gap: 6px; }
  .status select { flex: 1; padding: 4px 6px; }
  .small { font-size: 12px; margin: 0; }
</style>
