<script lang="ts">
  import type { Editor } from './editor.svelte';
  import { commonName, displayScientific, isDraft, isNativeTo, matureHeight, matureSpread, policiesFor, zoneNumber } from '../catalog/catalog';
  import { fmtLen } from '../model/units';
  import { monthName } from '../analysis/checks';
  import { GROWTH_K, grow } from '../analysis/growth';
  import { installDims } from '../catalog/catalog';

  let { editor, plantId, onclose }: { editor: Editor; plantId: string; onclose: () => void } = $props();

  const pl = $derived(editor.cat.plant(plantId));
  const p = $derived(editor.project);
  const region = $derived(editor.cat.region(p.site.regionId));
  const zone = $derived(zoneNumber(p.site.hardiness.zone));
  const pol = $derived(pl ? policiesFor(pl, region, p.site.regionId) : []);
  const growth = $derived.by(() => {
    if (!pl) return [];
    const d = installDims(pl);
    return [0, 1, 3, 5, 10, 20].map((t) => ({ t, h: grow(d.heightM, matureHeight(pl), GROWTH_K[pl.growthRate], t), w: grow(d.spreadM, matureSpread(pl), GROWTH_K[pl.growthRate], t) }));
  });
  const L = (m: number) => fmtLen(m, editor.units, true);
  const range = (r: [number, number]) => `${L(r[0])}–${L(r[1])}`;
</script>

<div class="bg" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }} onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pd-title">
    {#if pl}
      <header>
        <span class="sw" style:background={pl.foliageColor}>{#if pl.bloom}<i style:background={pl.bloom.color}></i>{/if}</span>
        <div>
          <h2 id="pd-title">{commonName(pl)}</h2>
          <p class="sci">{displayScientific(pl)}{pl.authorship ? ` ${pl.authorship}` : ''} · {pl.family}</p>
          <div class="badges">
            {#if isDraft(pl)}<span class="badge draft" title="Pass-1 editorial data; not yet signed off by a regional reviewer">draft — unreviewed</span>{:else}<span class="badge">reviewed</span>{/if}
            {#if isNativeTo(pl, p.site.regionId)}<span class="badge">native to {region?.name}</span>{/if}
            {#each pol as x (x.jurisdiction + x.status)}<span class="badge bad">{x.status} · {x.jurisdiction}</span>{/each}
            {#if zone < pl.hardiness.min || zone > pl.hardiness.max}<span class="badge bad">not hardy in zone {p.site.hardiness.zone}</span>{/if}
          </div>
        </div>
        <button class="close" onclick={onclose} aria-label="Close">×</button>
      </header>
      {#if pl.summary}<p class="summary">{pl.summary}</p>{/if}
      <dl class="facts">
        <dt>Form</dt><dd>{pl.form}, {pl.leaf}{pl.representation?.crown ? `, ${pl.representation.crown} crown` : ''}</dd>
        <dt>Mature size</dt><dd>{range(pl.mature.heightM)} tall × {range(pl.mature.spreadM)} wide · {pl.growthRate} growth{pl.yearsToMaturity ? `, ~${pl.yearsToMaturity} yr to maturity` : ''}</dd>
        <dt>Hardiness</dt><dd>USDA zones {pl.hardiness.min}–{pl.hardiness.max}</dd>
        <dt>Sun</dt><dd>{pl.sun.join(', ')}</dd>
        <dt>Soil moisture</dt><dd>{pl.moisture.join(', ')}{pl.soil?.length ? ` · ${pl.soil.join(', ')}` : ''}{pl.ph ? ` · pH ${pl.ph[0]}–${pl.ph[1]}` : ''}</dd>
        <dt>Bloom</dt><dd>{pl.bloom ? `${pl.bloom.months.map(monthName).join(', ')} · ${pl.bloom.colorName ?? ''}` : 'Not grown for flowers'}</dd>
        <dt>Fall colour</dt><dd>{#if pl.fallColor}<span class="chipc" style:background={pl.fallColor}></span>{:else}—{/if}</dd>
        <dt>Water use</dt><dd>{pl.waterUse ?? '—'} · maintenance {pl.maintenance ?? '—'} · deer resistance {pl.deerResistance ?? '—'}</dd>
        <dt>Wildlife</dt><dd>{pl.wildlife?.length ? pl.wildlife.join(', ') : '—'}</dd>
        <dt>Spacing</dt><dd>{L(pl.spacingM)} on centre · default install {pl.defaultInstallSize}</dd>
        <dt>Native range</dt><dd>{pl.nativeRange ?? '—'}</dd>
        {#if pl.tags?.length}<dt>Tags</dt><dd>{pl.tags.join(', ')}</dd>{/if}
      </dl>
      <div class="months" aria-label="Bloom months">
        {#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
          <span class:on={pl.bloom?.months.includes(m)} style:background={pl.bloom?.months.includes(m) ? pl.bloom.color : undefined} title={monthName(m)}>{monthName(m)[0]}</span>
        {/each}
      </div>
      <h3>Growth scenario</h3>
      <table class="growth">
        <thead><tr><th>Years</th>{#each growth as g (g.t)}<th>{g.t}</th>{/each}</tr></thead>
        <tbody>
          <tr><th>Height</th>{#each growth as g (g.t)}<td>{L(g.h)}</td>{/each}</tr>
          <tr><th>Spread</th>{#each growth as g (g.t)}<td>{L(g.w)}</td>{/each}</tr>
        </tbody>
      </table>
      <p class="muted small">Scenario from install size {pl.defaultInstallSize} toward the mature midpoint — not a prediction.</p>
      {#if pl.designNotes?.length}<h3>Design notes</h3><ul>{#each pl.designNotes as n, i (i)}<li>{n}</li>{/each}</ul>{/if}
      {#if pl.provenance?.length}
        <h3>Sources</h3>
        <ul class="prov">
          {#each pl.provenance as pv, i (i)}<li><code>{pv.sourceId}</code> · {pv.fields === '*' ? 'all fields' : pv.fields.join(', ')} · {pv.method ?? ''} · {pv.reviewStatus} · confidence {pv.confidence}{pv.retrieved ? ` · ${pv.retrieved}` : ''}</li>{/each}
        </ul>
      {/if}
      {#if !editor.readonly}
        <div class="row actions">
          <button class="btn primary" onclick={() => { editor.mix = [{ plantId: pl.id, ratio: 1 }]; editor.tool = 'plant'; onclose(); }}>Place</button>
          <button class="btn" onclick={() => { editor.mix = [{ plantId: pl.id, ratio: 1 }]; editor.tool = 'row'; onclose(); }}>Plant a row / hedge</button>
          <button class="btn" onclick={() => { if (!editor.mix.some((m) => m.plantId === pl.id)) editor.mix = [...editor.mix, { plantId: pl.id, ratio: 1 }]; editor.tool = 'mass'; onclose(); }}>Add to drift mix</button>
        </div>
      {/if}
    {:else}
      <p>Unknown plant <code>{plantId}</code>. It isn't in this catalog version ({editor.cat.version}); it is kept as a placeholder and exported unchanged.</p>
      <button class="btn" onclick={onclose}>Close</button>
    {/if}
  </div>
</div>

<style>
  .bg { position: fixed; inset: 0; background: rgba(15, 25, 20, .4); display: grid; place-items: center; z-index: 55; padding: 16px; }
  .sheet { background: var(--panel); border-radius: 16px; width: min(640px, 100%); max-height: 90dvh; overflow: auto; padding: 18px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; }
  header { display: flex; gap: 12px; align-items: flex-start; }
  header > div { flex: 1; }
  h2 { margin: 0; font-size: 22px; }
  h3 { margin: 8px 0 0; font-size: 15px; }
  .sci { margin: 2px 0 6px; font-style: italic; color: var(--ink-soft); }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .sw { width: 46px; height: 46px; border-radius: 50%; flex: none; position: relative; }
  .sw i { position: absolute; width: 18px; height: 18px; border-radius: 50%; right: -3px; bottom: -3px; border: 3px solid #fff; }
  .close { border: 0; background: none; font-size: 24px; cursor: pointer; color: var(--ink-soft); }
  .summary { margin: 0; font-size: 14px; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
  .facts dt { color: var(--ink-soft); font-weight: 600; }
  .facts dd { margin: 0; }
  .chipc { display: inline-block; width: 28px; height: 12px; border-radius: 4px; vertical-align: middle; }
  .months { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; }
  .months span { text-align: center; font-size: 11px; padding: 3px 0; border-radius: 4px; background: var(--bg); color: var(--ink-soft); }
  .months span.on { color: #fff; font-weight: 700; text-shadow: 0 0 2px rgba(0,0,0,.5); }
  .growth { border-collapse: collapse; font-size: 12px; }
  .growth th, .growth td { padding: 3px 6px; border-bottom: 1px solid var(--border); text-align: right; }
  .growth th:first-child { text-align: left; }
  .prov { font-size: 12px; color: var(--ink-soft); padding-left: 18px; }
  .small { font-size: 12px; margin: 0; }
  .actions { margin-top: 6px; }
</style>
