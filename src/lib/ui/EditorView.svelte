<script lang="ts">
  import { onMount } from 'svelte';
  import type { Project } from '../model/types';
  import { uid } from '../model/types';
  import { Editor, TOOL_KEYS, type PlacementTool, type ViewMode } from './editor.svelte';
  import PlanView from './PlanView.svelte';
  import Viewer3D from './Viewer3D.svelte';
  import CatalogPanel from './CatalogPanel.svelte';
  import DrawPanel from './DrawPanel.svelte';
  import SitePanel from './SitePanel.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import Inspector from './Inspector.svelte';
  import ChecksPanel from './ChecksPanel.svelte';
  import TimeBar from './TimeBar.svelte';
  import PlantDetail from './PlantDetail.svelte';
  import SchedulesView from './SchedulesView.svelte';
  import HelpMenu from './HelpMenu.svelte';
  import AlternativesPanel from './AlternativesPanel.svelte';
  import Logo from './Logo.svelte';
  import { download, dataUrlToBlob } from '../io/download';
  import { fileName, toOpenPlan } from '../io/openplan';
  import { plantScheduleCsv, taskScheduleCsv } from '../io/csv';
  import { iosImportUrl, shareUrl, transferJson } from '../io/transfer';
  import { sendToOpenPlan, OPENPLAN_EDITOR } from '../io/handoff';
  import { saveProject } from '../io/storage';
  import { track } from '../analytics';

  /** `arm`: plants to place on open (deep link from a plant page or tool), already validated by the router. */
  let { project, readonly = false, arm = null }: { project: Project; readonly?: boolean; arm?: { plantIds: string[]; tool?: PlacementTool } | null } = $props();

  /** Links longer than this rarely survive messaging apps and cannot be QR codes; email usually copes. */
  const LONG_LINK = 8000;

  // svelte-ignore state_referenced_locally
  const editor = new Editor(project, { readonly });
  // svelte-ignore state_referenced_locally
  let left = $state<'site' | 'draw' | 'plants' | 'notes'>(project.plants.length || project.areas.length ? 'plants' : 'site');
  let showChecks = $state(false);
  let showSchedules = $state(false);
  let showAlternatives = $state(false);
  let showExport = $state(false);
  let sheet = $state<'left' | 'right' | null>(null);
  let viewer: Viewer3D | undefined = $state();
  let plan: PlanView | undefined = $state();
  let narrow = $state(false);
  let shareFallback = $state('');
  let iosLink = $state('');
  let shareLong = $state(false);
  let openplanState = $state<{ status: 'sending' | 'error'; message?: string } | null>(null);
  let showMore = $state(false);
  let helpOpen = $state(false);
  let exportMenu: HTMLDivElement | undefined = $state();

  const p = $derived(editor.project);
  const emptySite = $derived(!editor.readonly && !p.site.boundary && !p.areas.length && !p.plants.length && !p.objects.length && !editor.hint('start'));
  const errors = $derived(editor.checks.filter((w) => w.severity === 'error').length);
  const warns = $derived(editor.checks.filter((w) => w.severity === 'warning').length);
  const proposed = $derived(p.plants.filter((x) => x.status === 'proposed').length);
  const openNotes = $derived(p.observations.filter((o) => !o.resolved).length);
  // A note just dropped on a phone: bring up the Inspector so its text box can take the caret.
  $effect(() => { if (editor.focusNoteId && narrow) sheet = 'right'; });
  const views: { id: ViewMode; name: string }[] = [{ id: '2d', name: '2D' }, { id: '3d', name: '3D' }, { id: 'split', name: 'Split' }];

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]') || e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); return; }
    if (mod || e.altKey) return;
    if (editor.detailPlantId && e.key === 'Escape') { editor.detailPlantId = null; return; }
    if (e.key === '[' || e.key === ']') { const m = p.scenario.month + (e.key === ']' ? 1 : -1); editor.setScenario({ month: ((m - 1 + 12) % 12) + 1 }); return; }
    if (['1', '2', '3'].includes(e.key) && !(narrow && e.key === '3')) { editor.view = (['2d', '3d', 'split'] as const)[Number(e.key) - 1]; return; }
    if (editor.readonly) return;
    const tool = TOOL_KEYS[e.key.toLowerCase()];
    if (tool && !e.shiftKey) {
      if (['plant', 'row', 'mass', 'grid'].includes(tool) && !editor.mix.length) { left = 'plants'; editor.notify('Pick a plant first'); }
      editor.tool = tool;
      if (tool === 'area' || tool === 'line' || tool === 'object') left = 'draw';
      if (tool === 'note') left = 'notes';
      return;
    }
    if (e.key === 'Escape') {
      if (showExport) { showExport = false; return; }
      if (editor.tool !== 'select') editor.tool = 'select'; else editor.selection = null;
      return;
    }
    // Selection shortcuts only act in the Select tool; while drawing, PlanView owns Backspace/Delete.
    if (editor.tool !== 'select' || !editor.selection) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editor.removeSelected(); }
    else if (e.key.toLowerCase() === 'd') editor.duplicateSelected();
    else if (e.key.toLowerCase() === 'r') editor.rotateSelected(e.shiftKey ? -15 : 15);
    else if (e.key.startsWith('Arrow') && plan) {
      e.preventDefault();
      const f = e.shiftKey ? 10 : 1;
      plan.nudge(e.key === 'ArrowLeft' ? -f : e.key === 'ArrowRight' ? f : 0, e.key === 'ArrowUp' ? -f : e.key === 'ArrowDown' ? f : 0);
    }
  }

  onMount(() => {
    const mq = matchMedia('(max-width: 860px)');
    const set = () => { narrow = mq.matches; if (narrow && editor.view === 'split') editor.view = readonly ? '3d' : '2d'; };
    set();
    mq.addEventListener('change', set);
    // beforeunload is unreliable on phones; visibilitychange and pagehide are the dependable save points.
    const flush = () => { void editor.flush(); };
    const onHidden = () => { if (document.hidden) flush(); };
    addEventListener('beforeunload', flush);
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    const outside = (e: PointerEvent) => { if (showExport && exportMenu && !exportMenu.contains(e.target as Node)) showExport = false; };
    addEventListener('pointerdown', outside);
    if (arm && !readonly && arm.plantIds.length) {
      left = 'plants';
      if (narrow) sheet = 'left';
      editor.arm(arm.plantIds, arm.tool);
    }
    return () => {
      mq.removeEventListener('change', set);
      removeEventListener('beforeunload', flush);
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      removeEventListener('pointerdown', outside);
      flush();
    };
  });

  async function ensure3d() {
    if (!viewer) { editor.view = 'split'; await new Promise((r) => setTimeout(r, 500)); }
    return viewer;
  }
  async function ensure2d() {
    if (!plan) { editor.view = 'split'; await new Promise((r) => setTimeout(r, 300)); }
    return plan;
  }

  async function exportAs(kind: 'json' | 'plants' | 'tasks' | 'png' | 'plan' | 'glb' | 'print' | 'project') {
    showExport = false;
    track('export', { kind });
    // Notes that leave this browser become append-only (they can be resolved, no longer deleted).
    if (kind === 'json' || kind === 'project') editor.sealNotes();
    if (kind === 'json') download(fileName(p, 'openplan3d', 'json'), JSON.stringify(toOpenPlan(p, editor.cat), null, 2), 'application/json');
    if (kind === 'project') download(fileName(p, 'openlandscape3d', 'json'), JSON.stringify(p, null, 2), 'application/json');
    if (kind === 'plants') download(fileName(p, 'plant-schedule', 'csv'), plantScheduleCsv(p, editor.cat), 'text/csv');
    if (kind === 'tasks') download(fileName(p, 'task-schedule', 'csv'), taskScheduleCsv(p, editor.cat), 'text/csv');
    if (kind === 'png') { const v = await ensure3d(); if (v) download(fileName(p, '3d', 'png'), await dataUrlToBlob(v.screenshot())); }
    if (kind === 'plan') { const v = await ensure2d(); if (v) download(fileName(p, 'plan', 'png'), await v.toPng()); }
    if (kind === 'glb') { const v = await ensure3d(); if (v) download(fileName(p, 'model', 'glb'), await v.exportGlb()); }
    if (kind === 'print') {
      // Open the tab inside the click so popup blockers allow it, then point it at the sheet once saved.
      const win = window.open('about:blank', '_blank');
      await editor.flush();
      if (win) win.location.href = `${location.pathname}#/print/${p.id}`; else window.open(`#/print/${p.id}`, '_blank');
    }
  }

  async function share() {
    showMore = false;
    editor.sealNotes();
    const url = await shareUrl(p, editor.cat);
    track('share', { long: url.length > LONG_LINK });
    // Long links get the explanation and the alternatives instead of a cheerful "copied".
    if (url.length > LONG_LINK) { shareLong = true; shareFallback = url; return; }
    shareLong = false;
    try {
      if (navigator.share) await navigator.share({ title: p.name, url });
      else { await navigator.clipboard.writeText(url); editor.notify('View-only link copied. The design travels inside the link; your precise location does not.'); }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // share sheet dismissed
      shareFallback = url;
    }
  }
  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); editor.notify('Link copied'); } catch { /* the field below stays selectable */ }
  }

  async function sendToIos() {
    showExport = false;
    showMore = false;
    editor.sealNotes();
    await editor.flush();
    iosLink = await iosImportUrl(p, editor.cat);
  }

  async function openInOpenPlan() {
    showExport = false;
    editor.sealNotes();
    openplanState = { status: 'sending' };
    const win = window.open('about:blank', '_blank');
    try {
      const link = await sendToOpenPlan(toOpenPlan(p, editor.cat, { embedWebProject: false }));
      if (win) win.location.href = link; else window.open(link, '_blank');
      openplanState = null;
      editor.notify('Opened in OpenPlan3D');
    } catch (e) {
      win?.close();
      openplanState = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  async function makeCopy() {
    const copy: Project = { ...JSON.parse(JSON.stringify(p)) as Project, id: uid(), name: `${p.name} (copy)`, updatedAt: new Date().toISOString() };
    await saveProject(copy);
    location.hash = `#/p/${copy.id}`;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="editor" class:readonly>
  <header class="top">
    <a class="home" href="#/" title="All sites" aria-label="All sites"><Logo size={26} /></a>
    {#if readonly}
      <strong class="title">{p.name}</strong>
      <span class="badge">View only</span>
    {:else}
      <input class="title" value={p.name} aria-label="Site name" onchange={(e) => editor.rename((e.currentTarget as HTMLInputElement).value || 'My garden')} />
      {#if editor.saveState === 'error'}
        <button class="save error" onclick={() => editor.flush()} title="The last change could not be written to this browser's storage">Not saved — retry</button>
      {:else}
        <span class="save {editor.saveState}" title="Sites are saved in this browser automatically" role="status">
          <span class="dot" aria-hidden="true"></span><span class="savetext">{editor.saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
          <span class="sr-only">{editor.saveState === 'saving' ? 'Saving' : 'Saved in this browser'}</span>
        </span>
      {/if}
      <div class="group">
        <button class="icon" onclick={() => editor.undo()} disabled={!editor.undoCount} title="Undo (⌘Z)" aria-label="Undo">↶</button>
        <button class="icon" onclick={() => editor.redo()} disabled={!editor.redoCount} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
      </div>
    {/if}
    <div class="seg views" role="tablist" aria-label="View">
      {#each views.filter((v) => !(narrow && v.id === 'split')) as v (v.id)}
        <button role="tab" class:on={editor.view === v.id} aria-selected={editor.view === v.id} onclick={() => (editor.view = v.id)}>{v.name}</button>
      {/each}
    </div>
    <div class="spacer"></div>
    <button class="btn checks" class:bad={errors} class:meh={!errors && warns} onclick={() => (showChecks = !showChecks)} aria-expanded={showChecks} title="Design checks">
      {errors ? `⛔ ${errors}` : warns ? `⚠️ ${warns}` : '✓'} <span class="hide-sm">Checks</span>
    </button>
    <button class="btn hide-sm" onclick={() => (showSchedules = true)}>Schedules</button>
    <button class="btn hide-sm" onclick={() => (showAlternatives = true)}>Design options{p.alternatives.length ? ` · ${p.alternatives.length}` : ''}</button>
    {#if readonly}
      <button class="btn primary" onclick={makeCopy}>Make an editable copy</button>
    {:else}
      <div class="menu hide-sm" bind:this={exportMenu}>
        <button class="btn" onclick={() => (showExport = !showExport)} aria-expanded={showExport} aria-controls="export-list">Export ▾</button>
        {#if showExport}
          <div class="dropdown" id="export-list">
            <span class="dh">Documents</span>
            <button onclick={() => exportAs('print')}>Print / PDF — plan, schedules, calendars, checks</button>
            <button onclick={() => exportAs('plants')}>Plant schedule (CSV)</button>
            <button onclick={() => exportAs('tasks')}>Task schedule (CSV)</button>
            <span class="dh">Images &amp; 3D</span>
            <button onclick={() => exportAs('plan')}>Plan image (PNG)</button>
            <button onclick={() => exportAs('png')}>3D image (PNG)</button>
            <button onclick={() => exportAs('glb')}>3D model (GLB)</button>
            <span class="dh">Files</span>
            <button onclick={() => exportAs('project')}>OpenLandscape3D project file</button>
            <button onclick={() => exportAs('json')}>OpenPlan3D JSON</button>
            <span class="dh">Send to</span>
            <button onclick={openInOpenPlan}>Open in OpenPlan3D</button>
            <button onclick={sendToIos}>Open in the iOS app</button>
          </div>
        {/if}
      </div>
      <button class="btn primary" onclick={share}>Share</button>
    {/if}
    <HelpMenu {readonly} bind:open={helpOpen} />
  </header>

  <div class="body">
    {#if !readonly}
      <aside class="left" class:open={sheet === 'left'} aria-label="Tools">
        <div class="seg tabs" role="tablist">
          <button role="tab" aria-selected={left === 'site'} class:on={left === 'site'} onclick={() => (left = 'site')}>Site</button>
          <button role="tab" aria-selected={left === 'draw'} class:on={left === 'draw'} onclick={() => (left = 'draw')}>Draw</button>
          <button role="tab" aria-selected={left === 'plants'} class:on={left === 'plants'} onclick={() => (left = 'plants')}>Plants</button>
          <button role="tab" aria-selected={left === 'notes'} class:on={left === 'notes'} onclick={() => (left = 'notes')} title="Field notes{openNotes ? ` — ${openNotes} open` : ''}">Notes{#if openNotes}<span class="count" aria-label="{openNotes} open">{openNotes}</span>{/if}</button>
        </div>
        <div class="panel">
          {#if left === 'plants'}<CatalogPanel {editor} />{:else if left === 'draw'}<DrawPanel {editor} />{:else if left === 'notes'}<NotesPanel {editor} onpick={() => { if (narrow) sheet = 'right'; }} />{:else}<SitePanel {editor} />{/if}
        </div>
      </aside>
    {/if}

    <main class="canvas view-{editor.view}">
      {#if editor.view === '2d' || editor.view === 'split'}
        <div class="pane"><PlanView bind:this={plan} {editor} /></div>
      {/if}
      {#if editor.view === '3d' || editor.view === 'split'}
        <div class="pane"><Viewer3D bind:this={viewer} {editor} compact={editor.view === 'split'} /></div>
      {/if}
      {#if showChecks}
        <div class="drawer"><ChecksPanel {editor} onclose={() => (showChecks = false)} /></div>
      {/if}
      {#if emptySite}
        <div class="starter" role="note" aria-label="Getting started">
          <button onclick={() => { editor.tool = 'boundary'; left = 'draw'; if (narrow) sheet = null; if (editor.view === '3d') editor.view = '2d'; }}><b>1</b> Draw the property boundary <kbd>B</kbd></button>
          <button onclick={() => { left = 'draw'; if (narrow) sheet = 'left'; }}><b>2</b> Add lawn, beds and a patio</button>
          <button onclick={() => { left = 'plants'; if (narrow) sheet = 'left'; }}><b>3</b> Pick plants, then plant a hedge or drift</button>
          <button class="x" aria-label="Hide these steps" onclick={() => editor.setHint('start', true)}>×</button>
        </div>
      {/if}
    </main>

    {#if !readonly}
      <aside class="right" class:open={sheet === 'right'} aria-label="Inspector">
        <Inspector {editor} />
      </aside>
    {:else if !narrow}
      <!-- View-only links: click any plant to see what it is. -->
      <aside class="right" aria-label="Details">
        <Inspector {editor} />
      </aside>
    {/if}
  </div>

  <footer class="bar">
    <TimeBar {editor} />
    <div class="stats">
      <span><strong>{proposed}</strong> plants{p.plants.length !== proposed ? ` (+${p.plants.length - proposed} existing)` : ''}</span>
      <span class="hide-sm">{editor.schedule.length} species</span>
      <span class="powered hide-sm">Powered by OpenPlan3D</span>
      {#if narrow}
        {#if !readonly}<button class="btn small" onclick={() => (sheet = sheet === 'left' ? null : 'left')}>＋ Add</button>{/if}
        <button class="btn small" class:primary={!!editor.selection} onclick={() => (sheet = sheet === 'right' ? null : 'right')}>{editor.selection ? 'Edit selected' : 'Site'}</button>
        <button class="btn small" onclick={() => (showMore = true)} aria-haspopup="dialog">More</button>
      {/if}
    </div>
  </footer>

  {#if sheet}<button class="scrim" aria-label="Close panel" onclick={() => (sheet = null)}></button>{/if}

  {#if readonly && narrow && sheet === 'right'}
    <aside class="right open sheetonly" aria-label="Inspector"><Inspector {editor} /></aside>
  {/if}

  {#if showMore}
    <div class="modal-bg bottom" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showMore = false; }}>
      <div class="modal more" role="dialog" aria-modal="true" aria-label="More">
        <div class="mhead"><h3>More</h3><button class="btn" onclick={() => (showMore = false)}>Close</button></div>
        <button class="btn" onclick={() => { showMore = false; showAlternatives = true; }}>Design options{p.alternatives.length ? ` · ${p.alternatives.length}` : ''}</button>
        <button class="btn" onclick={() => { showMore = false; showChecks = true; }}>Design checks</button>
        <button class="btn" onclick={() => { showMore = false; showSchedules = true; }}>Schedules</button>
        {#if !readonly}
          <span class="dh">Export</span>
          <button class="btn" onclick={() => { showMore = false; void exportAs('print'); }}>Print / PDF</button>
          <button class="btn" onclick={() => { showMore = false; void exportAs('plants'); }}>Plant schedule (CSV)</button>
          <button class="btn" onclick={() => { showMore = false; void exportAs('plan'); }}>Plan image (PNG)</button>
          <button class="btn" onclick={() => { showMore = false; void exportAs('project'); }}>OpenLandscape3D project file</button>
          <button class="btn" onclick={sendToIos}>Open in the iOS app</button>
          <button class="btn" onclick={() => { showMore = false; void openInOpenPlan(); }}>Open in OpenPlan3D</button>
        {/if}
        <button class="btn" onclick={() => { showMore = false; helpOpen = true; }}>Help</button>
      </div>
    </div>
  {/if}

  {#if editor.detailPlantId}
    <PlantDetail {editor} plantId={editor.detailPlantId} onclose={() => (editor.detailPlantId = null)} />
  {/if}

  {#if showSchedules}
    <div class="modal-bg" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showSchedules = false; }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Schedules">
        <div class="mhead">
          <h3>Schedules</h3>
          <div class="group">
            {#if !readonly}<button class="btn" onclick={() => exportAs('print')}>Print / PDF</button>{/if}
            <button class="btn" onclick={() => (showSchedules = false)}>Close</button>
          </div>
        </div>
        <SchedulesView {editor} />
      </div>
    </div>
  {/if}

  {#if showAlternatives}<AlternativesPanel {editor} onclose={() => (showAlternatives = false)} />{/if}

  {#if iosLink}
    <div class="modal-bg" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) iosLink = ''; }}>
      <div class="modal share" role="dialog" aria-modal="true" aria-label="Open in the iOS app">
        <h3>Open in OpenLandscape3D for iOS</h3>
        <p class="muted small">On an iPhone or iPad with the app installed, tap the button. On a computer, copy the link to your phone or AirDrop the file and open it with OpenLandscape3D.</p>
        {#if iosLink.length > LONG_LINK}
          <p class="small warnline">This link is {iosLink.length.toLocaleString()} characters long. If a messaging app cuts it off, AirDrop the file instead.</p>
        {/if}
        <a class="btn primary big" href={iosLink}>Open in the app</a>
        <div class="group">
          <button class="btn" onclick={async () => { try { await navigator.clipboard.writeText(iosLink); editor.notify('App link copied'); } catch { shareFallback = iosLink; } }}>Copy app link</button>
          <button class="btn" onclick={() => download(fileName(p, 'openplan3d', 'json'), JSON.stringify(transferJson(p, editor.cat), null, 2), 'application/json')}>Download file for AirDrop</button>
        </div>
        <p class="muted small">Plants, groups, areas, fences, objects, field notes and options travel to the app; notes you add here arrive signed “web”. The app merges field notes by id and never deletes one, so resolve a note rather than delete it. Your precise location and the GPS points of field notes stay here; photos stay on the device that took them. Web-only settings come back unchanged.</p>
        <div class="mhead"><span></span><button class="btn" onclick={() => (iosLink = '')}>Done</button></div>
      </div>
    </div>
  {/if}

  {#if openplanState}
    <div class="modal-bg" role="presentation">
      <div class="modal share" role="dialog" aria-modal="true" aria-label="Open in OpenPlan3D">
        <h3>Open in OpenPlan3D</h3>
        {#if openplanState.status === 'sending'}
          <p class="muted">Sending the site to OpenPlan3D…</p>
        {:else}
          <p>{openplanState.message}</p>
          <p class="muted small">You can still open it: download the OpenPlan3D JSON, then in OpenPlan3D choose <em>Import JSON</em>. Plants, fences, patios and site objects arrive as OpenPlan3D catalog items; lawns, beds and paths stay in this app for now.</p>
          <div class="group">
            <button class="btn primary" onclick={() => { exportAs('json'); window.open(OPENPLAN_EDITOR, '_blank'); openplanState = null; }}>Download JSON & open OpenPlan3D</button>
            <button class="btn" onclick={() => (openplanState = null)}>Close</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if shareFallback}
    <div class="modal-bg" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) shareFallback = ''; }}>
      <div class="modal share" role="dialog" aria-modal="true" aria-label="Share link">
        <h3>Share this design</h3>
        <p class="muted small">Anyone with this link can view the site in 2D and 3D and make their own copy. The design travels inside the link — nothing is uploaded, and your precise location is left out.</p>
        {#if shareLong}
          <p class="small warnline">This link is {shareFallback.length.toLocaleString()} characters long because the whole design travels inside it. Email usually carries it; messaging apps and QR codes often cut it off. For anything else, send the project file.</p>
        {/if}
        <input type="text" readonly value={shareFallback} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} aria-label="Share link" />
        <div class="mhead">
          <div class="group">
            <button class="btn primary" onclick={() => copyLink(shareFallback)}>Copy link</button>
            {#if shareLong && !readonly}
              <button class="btn" onclick={() => { shareFallback = ''; void exportAs('project'); }}>Download project file</button>
              <button class="btn" onclick={() => { shareFallback = ''; void sendToIos(); }}>Open in the iOS app</button>
            {/if}
          </div>
          <button class="btn" onclick={() => (shareFallback = '')}>Done</button>
        </div>
      </div>
    </div>
  {/if}

  {#if editor.toast}
    <div class="toast" role="status">
      <strong>{editor.toast.text}</strong>
      {#if !readonly && editor.undoCount}<button class="link" onclick={() => { editor.undo(); editor.toast = null; }}>Undo</button>{/if}
    </div>
  {/if}
</div>

<style>
  .editor { display: grid; grid-template-rows: auto 1fr auto; height: 100dvh; background: var(--bg); }
  .top { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); min-width: 0; }
  .home { display: flex; align-items: center; text-decoration: none; }
  .title { font-weight: 700; font-size: 15px; border: 1px solid transparent; background: transparent; padding: 4px 6px; border-radius: 6px; min-width: 60px; max-width: 240px; font-family: var(--serif); }
  input.title:hover, input.title:focus { border-color: var(--border); background: var(--bg); }
  .save { font-size: 12px; color: var(--ok); white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
  .save .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  button.save { border: 1px solid var(--danger); background: var(--danger-bg); color: var(--danger); border-radius: 8px; padding: 3px 8px; cursor: pointer; font-weight: 700; }
  .dh { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-soft); padding: 8px 10px 2px; }
  .warnline { background: var(--warn-bg); color: var(--warn-ink); border-radius: 8px; padding: 8px 10px; margin: 0; }
  .starter { position: absolute; left: 0; right: 0; margin-inline: auto; width: max-content; bottom: 64px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center; background: rgba(255,255,255,.96); border: 1px solid var(--border); border-radius: 12px; padding: 6px; box-shadow: var(--shadow); z-index: 4; max-width: calc(100% - 24px); }
  .starter button { border: 1px solid var(--border); background: var(--panel); border-radius: 9px; padding: 6px 10px; font-size: 12.5px; cursor: pointer; color: var(--ink); display: inline-flex; gap: 6px; align-items: center; }
  .starter button:hover { border-color: var(--accent); }
  .starter b { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 11px; }
  .starter kbd { font-size: 10px; border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
  .starter .x { border: 0; background: none; font-size: 16px; color: var(--ink-soft); padding: 4px 8px; }
  .modal.more { width: min(420px, 100%); gap: 8px; }
  .modal.more .btn { justify-content: flex-start; padding: 10px 12px; font-size: 14px; }
  .modal-bg.bottom { place-items: end center; }
  .save.saving { color: var(--ink-soft); }
  .save.error { color: var(--danger); font-weight: 700; }
  .group { display: flex; gap: 4px; flex-wrap: wrap; }
  .icon { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); font-size: 16px; cursor: pointer; color: inherit; }
  .icon:disabled { opacity: .35; cursor: default; }
  .views { margin-left: 8px; }
  .spacer { flex: 1; }
  .checks.bad { border-color: var(--danger); color: var(--danger); }
  .checks.meh { border-color: var(--warn); }
  .menu { position: relative; }
  .dropdown { position: absolute; right: 0; top: calc(100% + 6px); background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); padding: 6px; z-index: 30; display: flex; flex-direction: column; min-width: 290px; }
  .dropdown button { text-align: left; background: none; border: 0; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; color: inherit; }
  .dropdown button:hover, .dropdown button:focus-visible { background: var(--accent-bg); }

  .body { display: grid; grid-template-columns: 320px 1fr 290px; min-height: 0; }
  .readonly .body { grid-template-columns: 1fr 290px; }
  aside { background: var(--panel); min-height: 0; overflow: auto; padding: 12px; }
  .left { border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
  .left .tabs { width: 100%; }
  .left .tabs button { flex: 1; padding-left: 4px; padding-right: 4px; }
  .left .tabs .count { display: inline-block; margin-left: 4px; min-width: 16px; padding: 0 4px; border-radius: 8px; background: #3b6fb6; color: #fff; font-size: 10px; line-height: 16px; box-sizing: border-box; }
  .panel { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .right { border-left: 1px solid var(--border); }
  .canvas { position: relative; display: grid; min-height: 0; min-width: 0; }
  .canvas.view-split { grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
  .pane { position: relative; min-height: 0; min-width: 0; }
  .drawer { position: absolute; top: 12px; right: 12px; width: min(380px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 12px; z-index: 5; }

  .bar { display: flex; align-items: center; gap: 16px; padding: 8px 14px; background: var(--panel); border-top: 1px solid var(--border); font-size: 13px; flex-wrap: wrap; }
  .bar :global(.time) { flex: 1; }
  .stats { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .powered { color: var(--ink-soft); font-size: 11px; }
  .link { background: none; border: 0; cursor: pointer; color: inherit; font-size: 13px; padding: 0; }

  .modal-bg { position: fixed; inset: 0; background: rgba(15, 25, 20, .45); display: grid; place-items: center; z-index: 50; padding: 16px; }
  .modal { background: var(--panel); border-radius: 14px; width: min(1040px, 100%); max-height: 90dvh; overflow: auto; display: flex; flex-direction: column; padding: 16px; gap: 6px; box-shadow: var(--shadow); }
  .modal.share { width: min(560px, 100%); gap: 10px; }
  .mhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .mhead h3 { margin: 0; }
  .small { font-size: 12px; margin: 0 0 6px; }

  .toast { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); background: #1f2b24; color: white; padding: 10px 14px; border-radius: 10px; box-shadow: var(--shadow); z-index: 60; font-size: 13px; max-width: min(520px, calc(100vw - 32px)); display: flex; gap: 12px; align-items: center; }
  .toast .link { color: #a7e3bd; font-weight: 700; }
  .scrim { display: none; }
  .sheetonly { display: none; }

  @media (max-width: 1180px) {
    .body { grid-template-columns: 290px 1fr 250px; }
  }
  @media (max-width: 860px) {
    .body, .readonly .body { grid-template-columns: 1fr; }
    .hide-sm { display: none; }
    .title { max-width: 120px; }
    .savetext { display: none; }
    .views { margin-left: 0; }
    aside.left, aside.right { position: fixed; left: 0; right: 0; bottom: 0; height: 62dvh; z-index: 40; border-radius: 16px 16px 0 0; box-shadow: var(--shadow); transform: translateY(105%); transition: transform .22s ease; border: 0; }
    aside.open { transform: none; }
    .sheetonly { display: block; }
    .scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.25); z-index: 35; border: 0; }
    .top { flex-wrap: wrap; row-gap: 6px; }
    .bar { gap: 8px; }
  }
</style>
