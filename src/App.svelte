<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './lib/ui/Home.svelte';
  import EditorView from './lib/ui/EditorView.svelte';
  import PrintView from './lib/ui/PrintView.svelte';
  import ImportView from './lib/ui/ImportView.svelte';
  import type { Project } from './lib/model/types';
  import { loadProject } from './lib/io/storage';
  import { decodePayload } from './lib/io/transfer';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from './lib/io/openplan';
  import { catalog } from './lib/catalog/catalog';

  type Route =
    | { name: 'home' }
    | { name: 'editor' | 'print'; project: Project }
    | { name: 'view'; project: Project }
    | { name: 'import'; version: string; payload: string }
    | { name: 'loading' }
    | { name: 'missing'; message: string };

  let route = $state<Route>({ name: 'loading' });
  let key = $state(0);

  async function resolve() {
    const h = location.hash.replace(/^#\/?/, '');
    const [head, ...rest] = h.split('/');
    const arg = rest.join('/');
    try {
      if (head === 'p' || head === 'print') {
        const project = await loadProject(arg);
        route = project ? { name: head === 'p' ? 'editor' : 'print', project } : { name: 'missing', message: 'This site is not in this browser. Projects are stored locally — open it on the device where you made it, or import its JSON file.' };
      } else if (head === 'import' && rest.length >= 2) {
        route = { name: 'import', version: rest[0], payload: rest.slice(1).join('/') };
      } else if (head === 'view' && rest.length >= 2) {
        if (rest[0] !== 'v1') throw new Error('unsupported');
        const j = await decodePayload(rest.slice(1).join('/'));
        if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('not a site');
        route = { name: 'view', project: fromOpenPlan(j as Record<string, unknown>, catalog) };
      } else {
        route = { name: 'home' };
      }
    } catch {
      route = { name: 'missing', message: 'This share link is incomplete or damaged.' };
    }
    key++;
    document.title = 'project' in route ? `${route.project.name} — OpenLandscape3D` : 'OpenLandscape3D — free 3D landscape and garden planner';
  }

  onMount(() => {
    resolve();
    addEventListener('hashchange', resolve);
    return () => removeEventListener('hashchange', resolve);
  });
</script>

{#key key}
  {#if route.name === 'home'}
    <Home />
  {:else if route.name === 'editor'}
    <EditorView project={route.project} />
  {:else if route.name === 'view'}
    <EditorView project={route.project} readonly />
  {:else if route.name === 'import'}
    <ImportView version={route.version} payload={route.payload} />
  {:else if route.name === 'print'}
    <PrintView project={route.project} />
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

<style>
  .missing { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  .loading { text-align: center; margin-top: 30vh; }
</style>
