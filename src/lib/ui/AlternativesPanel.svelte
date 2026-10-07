<script lang="ts">
  import type { Editor } from './editor.svelte';
  import type { DesignSnapshot, Project } from '../model/types';
  import { snapshotOf } from '../model/types';
  import MiniPlan from './MiniPlan.svelte';
  import { runChecks } from '../analysis/checks';
  import { isNativeTo } from '../catalog/catalog';
  import { polygonArea } from '../model/geometry';
  import { fmtArea } from '../model/units';

  let { editor, onclose }: { editor: Editor; onclose: () => void } = $props();
  let name = $state('');
  const p = $derived(editor.project);

  function stats(s: DesignSnapshot) {
    const proj: Project = { ...p, ...s };
    const proposed = s.plants.filter((x) => x.status === 'proposed');
    const species = new Set(proposed.map((x) => x.plantId));
    const natives = proposed.filter((x) => { const pl = editor.cat.plant(x.plantId); return pl && isNativeTo(pl, p.site.regionId); }).length;
    const area = (kinds: string[]) => s.areas.filter((a) => kinds.includes(a.kind)).reduce((t, a) => t + polygonArea(a.polygon), 0);
    const checks = runChecks(proj, editor.cat);
    return {
      proj,
      plants: proposed.length,
      species: species.size,
      native: proposed.length ? Math.round((natives / proposed.length) * 100) : 0,
      lawn: area(['lawn']),
      beds: area(['bed', 'mulch']),
      hard: area(['patio', 'path', 'deck', 'driveway', 'gravel']),
      errors: checks.filter((c) => c.severity === 'error').length,
      warnings: checks.filter((c) => c.severity === 'warning').length
    };
  }
  const current = $derived(stats(snapshotOf(p)));
  const options = $derived(p.alternatives.map((a) => ({ a, s: stats(a.snapshot) })));
  const u = $derived(p.web.units);
</script>

<div class="bg" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="alt-title">
    <div class="head">
      <h3 id="alt-title">Design options</h3>
      <button class="btn" onclick={onclose}>Close</button>
    </div>
    <p class="muted small">Save the current design as a named option, keep working, and compare or restore any option later. Options travel with the project file and to the iOS app.</p>
    {#if !editor.readonly}
      <form class="row" onsubmit={(e) => { e.preventDefault(); editor.saveAlternative(name.trim()); name = ''; }}>
        <label class="sr-only" for="alt-name">Option name</label>
        <input id="alt-name" type="text" placeholder="Option {String.fromCharCode(65 + p.alternatives.length)} — e.g. Meadow front yard" bind:value={name} />
        <button class="btn primary">Save current design</button>
      </form>
    {/if}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th></th><th>Plants</th><th>Species</th><th>Native</th><th>Lawn</th><th>Beds</th><th>Hardscape</th><th>Checks</th><th></th></tr>
        </thead>
        <tbody>
          <tr class="cur">
            <td><MiniPlan project={current.proj} height={60} /><strong>Current design</strong></td>
            <td>{current.plants}</td><td>{current.species}</td><td>{current.native}%</td>
            <td>{fmtArea(current.lawn, u)}</td><td>{fmtArea(current.beds, u)}</td><td>{fmtArea(current.hard, u)}</td>
            <td>{current.errors} ⛔ · {current.warnings} ⚠️</td><td></td>
          </tr>
          {#each options as { a, s } (a.id)}
            <tr>
              <td>
                <MiniPlan project={s.proj} height={60} />
                {#if editor.readonly}<strong>{a.name}</strong>{:else}<input class="nm" type="text" value={a.name} aria-label="Option name" onchange={(e) => editor.renameAlternative(a.id, (e.currentTarget as HTMLInputElement).value)} />{/if}
                <span class="muted small">{new Date(a.createdAt).toLocaleDateString()}</span>
              </td>
              <td>{s.plants}</td><td>{s.species}</td><td>{s.native}%</td>
              <td>{fmtArea(s.lawn, u)}</td><td>{fmtArea(s.beds, u)}</td><td>{fmtArea(s.hard, u)}</td>
              <td>{s.errors} ⛔ · {s.warnings} ⚠️</td>
              <td class="acts">
                {#if !editor.readonly}
                  <button class="btn small" onclick={() => { editor.restoreAlternative(a.id); onclose(); }}>Restore</button>
                  <button class="btn small danger" onclick={() => { if (confirm(`Delete “${a.name}”?`)) editor.deleteAlternative(a.id); }}>Delete</button>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="9" class="muted">No saved options yet.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  .bg { position: fixed; inset: 0; background: rgba(15, 25, 20, .4); display: grid; place-items: center; z-index: 50; padding: 16px; }
  .modal { background: var(--panel); border-radius: 14px; width: min(1040px, 100%); max-height: 90dvh; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow); }
  .head { display: flex; justify-content: space-between; align-items: center; }
  h3 { margin: 0; }
  form input { flex: 1; min-width: 200px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; white-space: nowrap; }
  td:first-child { display: flex; align-items: center; gap: 8px; min-width: 240px; }
  td:first-child :global(svg) { width: 90px; flex: none; }
  tr.cur { background: var(--accent-bg); }
  .nm { width: 160px; padding: 4px 6px; }
  .acts { display: flex; gap: 4px; }
  .small { font-size: 12px; margin: 0; }
</style>
