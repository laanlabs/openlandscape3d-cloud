<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './lib/ui/Home.svelte';
  import ConsentBanner from './lib/ui/ConsentBanner.svelte';
  import { trackScreen, type Screen } from './lib/analytics';
  import type { Project } from './lib/model/types';
  import type { PlacementTool } from './lib/ui/editor.svelte';
  import { findSampleCopies, loadProject, saveProject } from './lib/io/storage';
  import { decodePayload } from './lib/io/transfer';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from './lib/io/openplan';
  import { armQuery, newSiteOptions, parseArm, parseRoute } from './lib/io/routes';
  import { catalog } from './lib/catalog/catalog';
  import { sampleCopy } from './lib/site/samples';
  import { newProject } from './lib/site/templates';
  import { ALL_ZONES } from './lib/site/regions';

  // The editor (with three.js), print sheet and import page load on demand, so Home stays light.
  const loadEditor = () => import('./lib/ui/EditorView.svelte');
  const loadPrint = () => import('./lib/ui/PrintView.svelte');
  const loadImport = () => import('./lib/ui/ImportView.svelte');

  type Arm = { plantIds: string[]; tool?: PlacementTool } | null;
  type Route =
    | { name: 'home' }
    | { name: 'editor'; project: Project; arm: Arm }
    | { name: 'print'; project: Project }
    | { name: 'view'; project: Project }
    | { name: 'import'; version: string; payload: string }
    | { name: 'loading' }
    | { name: 'missing'; message: string };

  let route = $state<Route>({ name: 'loading' });
  let key = $state(0);
  let homeNotice = $state('');
  let seq = 0;

  const STORAGE_MESSAGE = "This browser can't open its saved sites right now (a private window or blocked storage can cause this). Nothing was deleted.";

  async function resolve() {
    const mine = ++seq;
    const { head, rest, query } = parseRoute(location.hash);
    const arg = decodeURIComponent(rest.join('/'));
    const set = (r: Route) => { if (mine === seq) route = r; };
    try {
      if (head === 'p' || head === 'print') {
        let project: Project | undefined;
        try { project = await loadProject(arg); } catch { return finish(mine, { name: 'missing', message: STORAGE_MESSAGE }); }
        if (!project) return finish(mine, { name: 'missing', message: 'This site is not in this browser. Projects are stored locally — open it on the device where you made it, or import its JSON file.' });
        if (head === 'print') return finish(mine, { name: 'print', project });
        const arm = parseArm(query);
        // Arm once: drop the query so a reload does not re-arm placement.
        if (query.toString()) history.replaceState(null, '', `#/p/${project.id}`);
        return finish(mine, { name: 'editor', project, arm });
      }
      if (head === 'new') {
        const p = newProject(newSiteOptions(query, catalog, ALL_ZONES), catalog);
        await saveProject(p);
        location.replace(`#/p/${p.id}${armQuery(parseArm(query))}`);
        return;
      }
      if (head === 'sample') {
        const arm = armQuery(parseArm(query));
        // Reuse the visitor's untouched copy rather than piling up duplicates; an edited copy stays theirs.
        const copies = await findSampleCopies(arg).catch(() => []);
        const pristine = copies.find((c) => c.createdAt && c.createdAt === c.updatedAt);
        if (pristine) { location.replace(`#/p/${pristine.id}${arm}`); return; }
        const p = sampleCopy(arg, catalog);
        if (p) {
          await saveProject(p);
          location.replace(`#/p/${p.id}${arm}`);
          return;
        }
        homeNotice = `There's no sample garden called “${arg}”. Pick one of the samples below.`;
        history.replaceState(null, '', '#/');
        return finish(mine, { name: 'home' });
      }
      if (head === 'import' && rest.length >= 2) return finish(mine, { name: 'import', version: rest[0], payload: rest.slice(1).join('/') });
      if (head === 'view' && rest.length >= 2) {
        try {
          if (rest[0] !== 'v1') throw new Error('unsupported');
          const j = await decodePayload(rest.slice(1).join('/'));
          if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('not a site');
          return finish(mine, { name: 'view', project: fromOpenPlan(j as Record<string, unknown>, catalog) });
        } catch (e) {
          const tooLarge = e instanceof Error && /too large/i.test(e.message);
          return finish(mine, { name: 'missing', message: tooLarge ? 'This link is too large to open.' : 'This share link is incomplete or damaged.' });
        }
      }
      if (route.name !== 'home') homeNotice = '';
      finish(mine, { name: 'home' });
    } catch {
      set({ name: 'missing', message: STORAGE_MESSAGE });
      if (mine === seq) key++;
    }
  }

  function finish(mine: number, r: Route) {
    if (mine !== seq) return; // a newer navigation won
    route = r;
    key++;
    const screens: Record<string, Screen> = { home: 'home', editor: 'editor', view: 'view', print: 'print', import: 'import', missing: 'missing' };
    if (screens[r.name]) trackScreen(screens[r.name]);
    document.title = 'project' in r ? `${r.project.name} — OpenLandscape3D` : 'OpenLandscape3D — free 3D landscape and garden planner';
  }

  function downloadProject(p: Project) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
    a.download = `${p.name.replace(/[^\w-]+/g, '-') || 'site'}-openlandscape3d.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  onMount(() => {
    resolve();
    addEventListener('hashchange', resolve);
    return () => removeEventListener('hashchange', resolve);
  });
</script>

{#snippet failedSnippet(project: Project | undefined)}
  <div class="missing">
    <h2>This site could not be opened</h2>
    <p>Something in it is damaged or unexpected. Your other sites are not affected.</p>
    <div class="acts">
      <a class="btn primary" href="#/">Back to your sites</a>
      {#if project}<button class="btn" onclick={() => downloadProject(project)}>Download project file</button>{/if}
    </div>
  </div>
{/snippet}

{#key key}
  {#if route.name === 'home'}
    <Home notice={homeNotice} />
  {:else if route.name === 'editor' || route.name === 'view'}
    {@const r = route}
    <svelte:boundary>
      {#await loadEditor()}
        <p class="loading muted">Loading the planner…</p>
      {:then { default: EditorView }}
        <EditorView project={r.project} readonly={r.name === 'view'} arm={r.name === 'editor' ? r.arm : null} />
      {/await}
      {#snippet failed()}{@render failedSnippet(r.project)}{/snippet}
    </svelte:boundary>
  {:else if route.name === 'import'}
    {@const r = route}
    {#await loadImport()}
      <p class="loading muted">Loading…</p>
    {:then { default: ImportView }}
      <ImportView version={r.version} payload={r.payload} />
    {/await}
  {:else if route.name === 'print'}
    {@const r = route}
    <svelte:boundary>
      {#await loadPrint()}
        <p class="loading muted">Loading the print sheet…</p>
      {:then { default: PrintView }}
        <PrintView project={r.project} />
      {/await}
      {#snippet failed()}{@render failedSnippet(r.project)}{/snippet}
    </svelte:boundary>
  {:else if route.name === 'missing'}
    <div class="missing">
      <h2>Site not found</h2>
      <p>{route.message}</p>
      <a class="btn primary" href="#/">Go to your sites</a>
    </div>
  {:else}
    <p class="loading muted">Loading…</p>
  {/if}
{/key}

{#if route.name !== 'print'}<ConsentBanner />{/if}

<style>
  .missing { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  .acts { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .loading { text-align: center; margin-top: 30vh; }
</style>
