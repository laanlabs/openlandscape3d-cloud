<script lang="ts">
  // Every field observation (notes, photos, issues, measurements, existing-plant inventory), including
  // ones captured without a plan position, in date order. Clicking one selects it for the Inspector.
  import type { Editor } from './editor.svelte';
  import type { Observation } from '../model/types';
  import { hasPosition, kindColor, kindLabel, observationNumbers, sortObservations } from '../model/observations';
  import { fmtLen } from '../model/units';

  let { editor, onpick }: { editor: Editor; onpick?: () => void } = $props();
  const p = $derived(editor.project);

  let openOnly = $state(false);
  const numbers = $derived(observationNumbers(p.observations));
  const all = $derived(sortObservations(p.observations));
  const shown = $derived(openOnly ? all.filter((o) => !o.resolved) : all);
  const open = $derived(all.filter((o) => !o.resolved).length);

  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' }); };
  function summary(o: Observation) {
    const bits: string[] = [];
    if (o.text?.trim()) bits.push(o.text.trim());
    if (o.value != null) bits.push(o.unit === 'm' || o.unit == null ? fmtLen(o.value, p.web.units) : `${o.value} ${o.unit}`);
    if (o.photoFile && !bits.length) bits.push(o.photoFile);
    if (o.plantInstanceId && !bits.length) bits.push('Linked plant');
    return bits.join(' · ') || (o.author === 'web' ? 'Empty note' : '—');
  }
  function pick(o: Observation) {
    editor.tool = 'select';
    editor.selection = { kind: 'observation', id: o.id };
    if (!editor.layer('notes') && hasPosition(o)) editor.setLayer('notes', true);
    onpick?.();
  }
</script>

<div class="notes">
  <div class="row">
    <button class="btn small" class:primary={editor.tool === 'note'} aria-pressed={editor.tool === 'note'} onclick={() => (editor.tool = editor.tool === 'note' ? 'select' : 'note')} disabled={editor.readonly}>＋ Add a note (N)</button>
    <label class="check"><input type="checkbox" bind:checked={openOnly} /> Unresolved only</label>
  </div>
  <p class="muted small">{p.observations.length ? `${open} open · ${p.observations.length} in all.` : 'No field notes yet.'} Notes, photos, issues, measurements and existing plants captured in the iOS app show here and as pins on the plan.</p>

  {#if shown.length}
    <ul>
      {#each shown as o (o.id)}
        {@const sel = editor.selection?.kind === 'observation' && editor.selection.id === o.id}
        <li>
          <button class="item" class:sel class:resolved={o.resolved} onclick={() => pick(o)} aria-current={sel ? 'true' : undefined}>
            <span class="num" style:background={kindColor(o)}>{numbers.get(o.id)}</span>
            <span class="body">
              <span class="head"><strong>{kindLabel(o)}</strong> <span class="muted">{fmtDate(o.createdAt)} · {o.author === 'web' ? 'web' : o.author || '—'}{hasPosition(o) ? '' : ' · no position'}{o.resolved ? ' · resolved' : ''}</span></span>
              <span class="txt">{summary(o)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if p.observations.length}
    <p class="muted small">Everything is resolved.</p>
  {/if}
</div>

<style>
  .notes { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
  .check { font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .small { font-size: 12px; margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .item { width: 100%; display: flex; gap: 8px; align-items: flex-start; text-align: left; border: 1px solid var(--border); background: var(--panel); border-radius: 9px; padding: 7px 8px; cursor: pointer; font-size: 12px; }
  .item:hover { border-color: var(--accent); }
  .item.sel { border-color: var(--accent); background: var(--accent-bg); }
  .num { flex: none; min-width: 20px; height: 20px; border-radius: 10px; color: #fff; font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; box-sizing: border-box; }
  .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .head { display: flex; gap: 6px; flex-wrap: wrap; }
  .txt { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; white-space: pre-wrap; }
  .resolved .txt { text-decoration: line-through; color: var(--ink-soft); }
</style>
