<script lang="ts">
  import { onMount } from 'svelte';
  import Logo from './Logo.svelte';
  import MiniPlan from './MiniPlan.svelte';
  import type { Project } from '../model/types';
  import { uid } from '../model/types';
  import { catalog } from '../catalog/catalog';
  import { TEMPLATES, newProject, type TemplateId } from '../site/templates';
  import { ALL_ZONES, STATE_CENTERS, regionForState } from '../site/regions';
  import { fmtLen, parseLen, type Units } from '../model/units';
  import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../io/storage';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from '../io/openplan';

  // ---- new site ----
  let name = $state('My garden');
  let units = $state<Units>('imperial');
  let regionId = $state(catalog.regions[0]?.id ?? 'us-northeast');
  let stateCode = $state('');
  const region = $derived(catalog.region(regionId));
  let zone = $state(catalog.regions[0]?.defaultZone ?? '6b');
  let template = $state<TemplateId>('backyard');
  let widthText = $state('');
  let depthText = $state('');
  let createError = $state('');

  const states = $derived(
    catalog.regions.flatMap((r) => r.states.map((s) => ({ code: s, name: STATE_CENTERS[s]?.[2] ?? s, region: r.name }))).sort((a, b) => a.name.localeCompare(b.name))
  );
  const otherZones = $derived(ALL_ZONES.filter((z) => !(region?.hardinessZones ?? []).includes(z)));

  function pickState(code: string) {
    stateCode = code;
    const r = code ? regionForState(code) : undefined;
    if (r) { regionId = r.id; zone = r.defaultZone; }
  }
  function pickRegion(id: string) {
    regionId = id;
    stateCode = '';
    zone = catalog.region(id)?.defaultZone ?? zone;
  }
  $effect(() => {
    // Default lot size in the chosen units.
    widthText = units === 'imperial' ? '66' : '20';
    depthText = units === 'imperial' ? '100' : '30';
  });

  async function create() {
    createError = '';
    let width: number | undefined, depth: number | undefined;
    if (template === 'rect') {
      width = parseLen(widthText, units) ?? undefined;
      depth = parseLen(depthText, units) ?? undefined;
      if (!width || !depth || width < 2 || depth < 2 || width > 2000 || depth > 2000) { createError = 'Enter a lot width and depth between 2 m and 2 km (e.g. 20, 66′ or 18.5m).'; return; }
    }
    const p = newProject({ name: name.trim() || 'My garden', units, regionId, zone, state: stateCode || undefined, template, width, depth }, catalog);
    await saveProject(p);
    location.hash = `#/p/${p.id}`;
  }

  // ---- import ----
  let importError = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  async function onFile(e: Event) {
    importError = '';
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('This file is not an OpenPlan3D or OpenLandscape3D plan.');
      let p: Project = fromOpenPlan(j, catalog, f.name.replace(/(-openplan3d)?\.json$/i, '').replace(/[-_]+/g, ' ') || 'Imported site');
      const existing = await loadProject(p.id);
      if (existing) {
        const replace = confirm(`“${existing.name}” is already in this browser.\n\nOK — replace it with the file\nCancel — keep both`);
        if (!replace) p = { ...p, id: uid(), name: `${p.name} (imported)` };
      }
      await saveProject({ ...p, updatedAt: new Date().toISOString() });
      location.hash = `#/p/${p.id}`;
    } catch (err) {
      importError = err instanceof SyntaxError ? 'The file is not valid JSON.' : err instanceof Error ? err.message : String(err);
    }
  }

  // ---- library ----
  let sites = $state<ProjectSummary[] | null>(null);
  let thumbs = $state<Record<string, Project>>({});

  async function refresh() {
    sites = await listProjects();
    const out: Record<string, Project> = {};
    for (const s of sites) { const p = await loadProject(s.id); if (p) out[s.id] = p; }
    thumbs = out;
  }
  async function remove(s: ProjectSummary) {
    if (!confirm(`Delete “${s.name}” from this browser? This can't be undone.`)) return;
    await deleteProject(s.id);
    await refresh();
  }
  async function duplicate(s: ProjectSummary) {
    const p = await loadProject(s.id);
    if (!p) return;
    const now = new Date().toISOString();
    await saveProject({ ...JSON.parse(JSON.stringify(p)), id: uid(), name: `${p.name} (copy)`, createdAt: now, updatedAt: now });
    await refresh();
  }
  onMount(() => { refresh().catch(() => (sites = [])); });

  const regionName = (id: string) => catalog.region(id)?.name ?? id;
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<div class="home">
  <header class="hero">
    <Logo word size={34} />
    <p class="tag">Design the landscape today. See how it lives tomorrow.</p>
    <p class="muted sub">A free, open-source garden planner: regional plants, hedges and drifts, seasons and growth over the years, sun and shade, design checks, plant and task schedules. <span class="powered">Powered by OpenPlan3D</span></p>
  </header>

  {#if catalog.fixture}
    <p class="notice" role="note">Using the built-in sample catalog ({catalog.plants.length} plants) — run <code>npm run catalog</code> when the full catalog is published.</p>
  {/if}

  <div class="grid">
    <section class="card" aria-labelledby="new-h">
      <h2 id="new-h">New site</h2>
      <label class="field">Name <input type="text" bind:value={name} /></label>
      <div class="row2">
        <div class="field">
          <span id="units-l">Units</span>
          <div class="seg" role="radiogroup" aria-labelledby="units-l">
            <button role="radio" aria-checked={units === 'imperial'} class:on={units === 'imperial'} onclick={() => (units = 'imperial')}>Feet</button>
            <button role="radio" aria-checked={units === 'metric'} class:on={units === 'metric'} onclick={() => (units = 'metric')}>Metres</button>
          </div>
        </div>
        <label class="field">State
          <select value={stateCode} onchange={(e) => pickState((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">— choose —</option>
            {#each states as s (s.code)}<option value={s.code}>{s.name} ({s.region})</option>{/each}
          </select>
        </label>
      </div>
      <div class="row2">
        <label class="field">Region
          <select value={regionId} onchange={(e) => pickRegion((e.currentTarget as HTMLSelectElement).value)}>
            {#each catalog.regions as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
          </select>
        </label>
        <label class="field">USDA zone
          <select bind:value={zone}>
            <optgroup label="Typical for {region?.name ?? 'region'}">
              {#each region?.hardinessZones ?? [] as z}<option value={z}>{z}{z === region?.defaultZone ? ' (default)' : ''}</option>{/each}
            </optgroup>
            <optgroup label="Other zones">
              {#each otherZones as z}<option value={z}>{z}</option>{/each}
            </optgroup>
          </select>
        </label>
      </div>
      {#if region}
        <p class="muted small">{region.summary ?? ''} Frost dates: last spring {region.frost.lastSpring}, first fall {region.frost.firstFall} (MM-DD) — you can adjust them in the site panel.</p>
      {/if}

      <fieldset class="templates">
        <legend>Start from</legend>
        {#each TEMPLATES as t (t.id)}
          <label class="tpl" class:on={template === t.id}>
            <input type="radio" name="template" value={t.id} bind:group={template} class="sr-only" />
            <strong>{t.name}</strong>
            <span class="muted">{t.blurb}</span>
          </label>
        {/each}
      </fieldset>
      {#if template === 'rect'}
        <div class="row2">
          <label class="field">Lot width ({units === 'imperial' ? 'ft' : 'm'}) <input type="text" inputmode="decimal" bind:value={widthText} /></label>
          <label class="field">Lot depth ({units === 'imperial' ? 'ft' : 'm'}) <input type="text" inputmode="decimal" bind:value={depthText} /></label>
        </div>
        {#if parseLen(widthText, units) && parseLen(depthText, units)}
          <p class="muted small">{fmtLen(parseLen(widthText, units)!, units)} × {fmtLen(parseLen(depthText, units)!, units)}</p>
        {/if}
      {/if}
      {#if createError}<p class="err" role="alert">{createError}</p>{/if}
      <button class="btn primary big" onclick={create}>Create site</button>
    </section>

    <section class="card" aria-labelledby="imp-h">
      <h2 id="imp-h">Import</h2>
      <p class="muted">Open an <strong>OpenPlan3D JSON</strong> — your house walls become a footprint to plant around — or an <strong>OpenLandscape3D</strong> file from the iOS app or another browser.</p>
      <input bind:this={fileInput} id="import-file" type="file" accept=".json,application/json" class="sr-only" onchange={onFile} />
      <button class="btn" onclick={() => fileInput?.click()}>Choose a .json file…</button>
      {#if importError}<p class="err" role="alert">{importError}</p>{/if}
      <p class="muted small">Links sent from the iOS app open here directly and ask before replacing anything.</p>
    </section>
  </div>

  <section class="library" aria-labelledby="lib-h">
    <h2 id="lib-h">Your sites</h2>
    {#if sites === null}
      <p class="muted">Loading…</p>
    {:else if !sites.length}
      <p class="muted empty">No sites yet. Create one above — it's saved in this browser as you work.</p>
    {:else}
      <ul class="cards">
        {#each sites as s (s.id)}
          <li class="site">
            <a class="open" href="#/p/{s.id}" aria-label="Open {s.name}">
              <div class="thumb">{#if thumbs[s.id]}<MiniPlan project={thumbs[s.id]} height={130} />{/if}</div>
              <strong>{s.name}</strong>
              <span class="muted small">{s.plants} plants · {regionName(s.regionId)} · {when(s.updatedAt)}</span>
            </a>
            <div class="acts">
              <button class="btn small" onclick={() => duplicate(s)}>Duplicate</button>
              <button class="btn small danger" onclick={() => remove(s)}>Delete</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <footer class="muted small">
    <p>Sites are saved in this browser. Nothing is uploaded unless you share or export.</p>
    <p>Plant data is a draft, unreviewed pass — check with your local extension office. Sizes and seasons are scenarios, not predictions.</p>
    <p>MIT licensed open source · Powered by OpenPlan3D</p>
  </footer>
</div>

<style>
  .home { max-width: 1080px; margin: 0 auto; padding: 28px 16px 40px; display: flex; flex-direction: column; gap: 20px; }
  .hero { display: flex; flex-direction: column; gap: 6px; }
  .tag { font-family: var(--serif); font-size: 26px; margin: 8px 0 0; color: var(--accent-ink); }
  .sub { margin: 0; max-width: 720px; }
  .powered { font-weight: 600; color: var(--ink); white-space: nowrap; }
  .notice { margin: 0; background: var(--info-bg); color: var(--info-ink); border-radius: 10px; padding: 8px 12px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; align-items: start; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  h2 { margin: 0; font-size: 20px; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink-soft); }
  .templates { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .templates legend { font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-bottom: 4px; padding: 0; }
  .tpl { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; font-size: 13px; background: var(--panel); }
  .tpl:hover { border-color: var(--accent); }
  .tpl.on { border-color: var(--accent); background: var(--accent-bg); box-shadow: inset 0 0 0 1px var(--accent); }
  .tpl:focus-within { outline: 2px solid color-mix(in srgb, var(--accent) 65%, transparent); outline-offset: 1px; }
  .tpl .muted { font-size: 12px; }
  .small { font-size: 12px; margin: 0; }
  .err { color: var(--danger); margin: 0; }
  .big { align-self: flex-start; }
  .library h2 { margin-bottom: 10px; }
  .cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .site { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .site:hover { border-color: var(--accent); }
  .open { text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 4px; }
  .thumb { background: var(--bg-plan); border-radius: 10px; height: 130px; overflow: hidden; }
  .acts { display: flex; gap: 6px; }
  .empty { background: var(--panel); border: 1px dashed var(--border); border-radius: 12px; padding: 20px; text-align: center; }
  footer { border-top: 1px solid var(--border); padding-top: 12px; }
  footer p { margin: 2px 0; }
  code { background: var(--bg); padding: 1px 4px; border-radius: 4px; }
  @media (max-width: 760px) {
    .grid, .row2, .templates { grid-template-columns: 1fr; }
    .tag { font-size: 21px; }
  }
</style>
