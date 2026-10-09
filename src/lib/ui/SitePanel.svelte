<script lang="ts">
  import type { Editor } from './editor.svelte';
  import type { LayerId, Moisture, Soil, Sun } from '../model/types';
  import { ALL_ZONES, regionCenter } from '../site/regions';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const site = $derived(p.site);
  const region = $derived(editor.cat.region(site.regionId));
  const zones = $derived([...new Set([...(region?.hardinessZones ?? []), site.hardiness.zone])]);
  const val = (e: Event) => (e.currentTarget as HTMLSelectElement | HTMLInputElement).value;
  const northDeg = $derived(Math.round(((Math.atan2(site.north[0], -site.north[1]) * 180) / Math.PI + 360) % 360));
  const LAYERS: { id: LayerId; name: string }[] = [{ id: 'building', name: 'Building' }, { id: 'hardscape', name: 'Hardscape' }, { id: 'planting', name: 'Planting' }, { id: 'notes', name: 'Field notes' }, { id: 'labels', name: 'Labels' }];

  function setRegion(id: string) {
    const r = editor.cat.region(id);
    if (!r) return;
    const c = regionCenter(id, editor.cat);
    editor.setSite({ regionId: id, hardiness: { system: 'USDA', zone: r.defaultZone }, frost: { ...r.frost }, location: { lat: Math.round(c[0] * 100) / 100, lon: Math.round(c[1] * 100) / 100, precision: 'coarse' } });
  }
  function setNorth(deg: number) {
    const r = (deg * Math.PI) / 180;
    editor.setSite({ north: [Math.round(Math.sin(r) * 1e6) / 1e6, Math.round(-Math.cos(r) * 1e6) / 1e6] });
  }
  const validMmdd = (s: string) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
</script>

<div class="site">
  <section>
    <h4>Region & climate</h4>
    <label class="field">Region
      <select value={site.regionId} onchange={(e) => setRegion(val(e))} disabled={editor.readonly}>
        {#each editor.cat.regions as r (r.id)}<option value={r.id}>{r.name} ({r.states.join(', ')})</option>{/each}
      </select>
    </label>
    <div class="grid2">
      <label class="field">USDA zone
        <select value={site.hardiness.zone} onchange={(e) => editor.setSite({ hardiness: { system: 'USDA', zone: val(e) } })} disabled={editor.readonly}>
          {#each zones as z (z)}<option value={z}>{z}</option>{/each}
          <optgroup label="Other zones">{#each ALL_ZONES.filter((z) => !zones.includes(z)) as z (z)}<option value={z}>{z}</option>{/each}</optgroup>
        </select>
      </label>
      <label class="field">Planting year
        <input type="number" min="2000" max="2100" value={p.web.plantingYear ?? new Date(p.createdAt).getFullYear()} onchange={(e) => editor.setWeb({ plantingYear: Number(val(e)) })} disabled={editor.readonly} />
      </label>
      <label class="field">Last spring frost
        <input type="text" value={site.frost.lastSpring} placeholder="MM-DD" onchange={(e) => { const v = val(e); if (validMmdd(v)) editor.setSite({ frost: { ...site.frost, lastSpring: v } }); }} disabled={editor.readonly} />
      </label>
      <label class="field">First fall frost
        <input type="text" value={site.frost.firstFall} placeholder="MM-DD" onchange={(e) => { const v = val(e); if (validMmdd(v)) editor.setSite({ frost: { ...site.frost, firstFall: v } }); }} disabled={editor.readonly} />
      </label>
    </div>
    {#if region}<p class="muted small">{region.summary ?? region.climate} Frost defaults: {region.frost.lastSpring} / {region.frost.firstFall}. <button class="link" onclick={() => editor.setSite({ frost: { ...region.frost } })} disabled={editor.readonly}>Reset</button></p>{/if}
  </section>

  <section>
    <h4>Site defaults</h4>
    <p class="muted small">Override per area in its inspector (e.g. a shady bed under a tree).</p>
    <div class="grid3">
      <label class="field">Sun<select value={site.sun} onchange={(e) => editor.setSite({ sun: val(e) as Sun })} disabled={editor.readonly}><option value="full">Full</option><option value="part">Part</option><option value="shade">Shade</option></select></label>
      <label class="field">Moisture<select value={site.moisture} onchange={(e) => editor.setSite({ moisture: val(e) as Moisture })} disabled={editor.readonly}><option value="dry">Dry</option><option value="medium">Medium</option><option value="wet">Wet</option></select></label>
      <label class="field">Soil<select value={site.soil} onchange={(e) => editor.setSite({ soil: val(e) as Soil })} disabled={editor.readonly}><option value="sand">Sand</option><option value="loam">Loam</option><option value="clay">Clay</option></select></label>
    </div>
  </section>

  <section>
    <h4>Location & north</h4>
    <div class="grid2">
      <label class="field">Latitude
        <input type="number" step="0.01" min="-90" max="90" value={site.location?.lat ?? ''} onchange={(e) => editor.setSite({ location: { lat: Number(val(e)), lon: site.location?.lon ?? 0, precision: 'precise' } })} disabled={editor.readonly} />
      </label>
      <label class="field">Longitude
        <input type="number" step="0.01" min="-180" max="180" value={site.location?.lon ?? ''} onchange={(e) => editor.setSite({ location: { lat: site.location?.lat ?? 0, lon: Number(val(e)), precision: 'precise' } })} disabled={editor.readonly} />
      </label>
    </div>
    <p class="muted small">{site.location?.precision === 'precise' ? 'Precise location — kept in this browser and in exported files, never in links.' : 'Approximate (region centre), used only for the sun position.'}</p>
    <label class="field">North (degrees clockwise from up) — {northDeg}°
      <input type="range" min="0" max="359" step="1" value={northDeg} oninput={(e) => setNorth(Number(val(e)))} disabled={editor.readonly} />
    </label>
  </section>

  <section>
    <h4>Boundary</h4>
    {#if site.boundary}
      <div class="row">
        <button class="btn small" onclick={() => (editor.selection = { kind: 'boundary', id: 'boundary' })}>Edit boundary</button>
        <label class="check"><input type="checkbox" checked={p.verification.boundary} onchange={(e) => editor.setBoundaryVerified((e.currentTarget as HTMLInputElement).checked)} disabled={editor.readonly} /> Verified</label>
      </div>
    {:else}
      <button class="btn small" onclick={() => (editor.tool = 'boundary')} disabled={editor.readonly}>Draw the property boundary (B)</button>
    {/if}
  </section>

  <section>
    <h4>View</h4>
    <div class="layers" role="group" aria-label="Layers">
      {#each LAYERS as l (l.id)}<button class="chip" class:on={editor.layer(l.id)} aria-pressed={editor.layer(l.id)} onclick={() => editor.setLayer(l.id, !editor.layer(l.id))}>{l.name}</button>{/each}
    </div>
    <div class="row">
      <div class="seg small" role="radiogroup" aria-label="Units">
        <button role="radio" aria-checked={p.web.units === 'metric'} class:on={p.web.units === 'metric'} onclick={() => editor.setWeb({ units: 'metric' })}>Metric</button>
        <button role="radio" aria-checked={p.web.units === 'imperial'} class:on={p.web.units === 'imperial'} onclick={() => editor.setWeb({ units: 'imperial' })}>Imperial</button>
      </div>
      <label class="check"><input type="checkbox" bind:checked={editor.snap} /> Snap to grid & corners</label>
    </div>
  </section>
</div>

<style>
  .site { display: flex; flex-direction: column; gap: 14px; }
  section { display: flex; flex-direction: column; gap: 6px; }
  h4 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .small { font-size: 12px; margin: 0; }
  .check { font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .layers { display: flex; gap: 4px; flex-wrap: wrap; }
  .link { background: none; border: 0; color: var(--accent-ink); font-weight: 600; cursor: pointer; padding: 0; font-size: 12px; }
</style>
