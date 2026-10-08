<script lang="ts">
  // "Render this view": hi-res still of the current 3D camera (render/renderView.ts, loaded on demand).
  import type * as THREE from 'three';
  import type { Editor } from './editor.svelte';
  import { download } from '../io/download';

  let { editor, camera, onclose }: { editor: Editor; camera: THREE.PerspectiveCamera; onclose: () => void } = $props();

  const SIZES = [
    { label: 'HD', width: 1920 },
    { label: '4K', width: 3840 }
  ];
  let width = $state(3840);
  let busy = $state(false);
  let step = $state('');
  let error = $state('');
  let url = $state('');
  let blob: Blob | null = null;
  let note = $state('');
  let dims = $state('');

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  async function render() {
    busy = true;
    error = '';
    if (url) URL.revokeObjectURL(url);
    url = '';
    try {
      const { renderView } = await import('../render/renderView');
      const s = editor.project.scenario;
      const result = await renderView(editor.project, editor.cat, camera, { width, aspect: camera.aspect, onProgress: (t) => (step = t) });
      blob = result.blob;
      url = URL.createObjectURL(result.blob);
      dims = `${result.width} × ${result.height}`;
      note = `${MONTHS[(s.month - 1 + 12) % 12]}, year ${s.year}` + (result.daylightSubstituted ? ' · night hour, shown in morning light' : ` · ${String(s.hour).padStart(2, '0')}:00 sun`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      step = '';
    }
  }

  function save() {
    if (!blob) return;
    const name = (editor.project.name || 'garden').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'garden';
    download(`${name}-render-${dims.replace(' × ', 'x')}.png`, blob);
  }

  $effect(() => () => { if (url) URL.revokeObjectURL(url); });
</script>

<div class="backdrop" role="presentation" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="render-title">
    <header>
      <h2 id="render-title">Render this view</h2>
      <button class="close" onclick={onclose} aria-label="Close">✕</button>
    </header>

    {#if url}
      <img src={url} alt="Rendered view of {editor.project.name}" />
      <p class="meta">{dims} · {note}</p>
    {:else}
      <p class="lead">A high-resolution image from this camera angle, with detailed trees, shrubs, flowers and grass. Plants are drawn at the size and season of the current year and month.</p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <footer>
      <div class="sizes" role="radiogroup" aria-label="Image size">
        {#each SIZES as s}
          <button class="chip" class:on={width === s.width} role="radio" aria-checked={width === s.width} disabled={busy} onclick={() => (width = s.width)}>{s.label}</button>
        {/each}
      </div>
      <span class="grow"></span>
      {#if busy}<span class="step" aria-live="polite">{step}…</span>{/if}
      {#if url && !busy}<button class="btn" onclick={save}>Download PNG</button>{/if}
      <button class="btn primary" onclick={render} disabled={busy}>{url ? 'Render again' : 'Render'}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(15, 25, 20, 0.45); display: grid; place-items: center; z-index: 100; padding: 16px; }
  .dialog { background: var(--panel, #fff); color: var(--ink, #1d2a24); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); width: min(900px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 1.05rem; }
  .close { border: none; background: none; font-size: 1.1rem; cursor: pointer; color: inherit; }
  .lead, .meta { margin: 0; font-size: 0.9rem; opacity: 0.85; }
  /* Keep the footer (size, Download) on screen whatever the image's aspect ratio. */
  img { width: 100%; height: auto; max-height: calc(100vh - 230px); object-fit: contain; border-radius: 8px; display: block; background: #e8ece4; }
  .error { color: #b3261e; margin: 0; font-size: 0.9rem; }
  footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sizes { display: flex; gap: 6px; }
  .grow { flex: 1; }
  .step { font-size: 0.85rem; opacity: 0.8; }
</style>
