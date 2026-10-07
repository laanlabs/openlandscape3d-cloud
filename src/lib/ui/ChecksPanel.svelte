<script lang="ts">
  import type { Editor } from './editor.svelte';
  import { RULE_INFO, type CheckResult } from '../analysis/checks';

  let { editor, onclose, print = false }: { editor: Editor; onclose?: () => void; print?: boolean } = $props();

  let open = $state<string | null>(null);
  let note = $state('');
  const key = (c: CheckResult) => `${c.ruleId}|${c.subjectIds.join(',')}`;
  const counts = $derived({
    error: editor.checks.filter((c) => c.severity === 'error').length,
    warning: editor.checks.filter((c) => c.severity === 'warning').length,
    info: editor.checks.filter((c) => c.severity === 'info').length
  });
  const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;
  const RANK = { error: 0, warning: 1, info: 2 } as const;
  // Contract order within each severity, most serious first.
  const shown = $derived([...editor.checks].sort((a, b) => RANK[a.severity] - RANK[b.severity]));

  function accept(c: CheckResult) {
    if (!note.trim()) return;
    editor.setOverride(c.ruleId, c.subjectIds[0] ?? '', note.trim());
    note = '';
    open = null;
  }
</script>

<section class="checks" aria-label="Design checks">
  <header>
    <h3>Design checks</h3>
    <span class="muted small">{counts.error} errors · {counts.warning} warnings · {counts.info} notes</span>
    {#if onclose}<button class="close" onclick={onclose} aria-label="Close checks">×</button>{/if}
  </header>
  {#if !editor.checks.length}
    <p class="ok">✓ No issues found. Checks cover hardiness, invasive status, sun, moisture, spacing at maturity, building clearance, boundary and bloom gaps.</p>
  {/if}
  <ul>
    {#each shown as c (key(c))}
      {@const k = key(c)}
      <li class={c.severity}>
        <div class="top">
          <span aria-hidden="true">{ICON[c.severity]}</span>
          <div class="body">
            <strong>{RULE_INFO[c.ruleId].title}</strong> <code>{c.ruleId}</code>
            <p>{c.message}</p>
            {#if c.overridden}<p class="ov">Accepted: “{c.overridden.note}” (was {c.overridden.originalSeverity})</p>{/if}
          </div>
        </div>
        {#if !print}
          <div class="acts">
            {#if c.subjectIds.length || c.ruleId === 'OL-UNVERIFIED'}<button class="link" onclick={() => editor.selectSubject(c.subjectIds[0])}>{c.subjectIds.length ? 'Show' : 'Show boundary'}</button>{/if}
            <button class="link" onclick={() => (open = open === k ? null : k)} aria-expanded={open === k}>Why?</button>
            {#if !editor.readonly}
              {#if c.overridden}
                <button class="link" onclick={() => editor.setOverride(c.ruleId, c.subjectIds[0] ?? '', null)}>Remove override</button>
              {:else}
                <button class="link" onclick={() => { open = open === `${k}#o` ? null : `${k}#o`; note = ''; }}>Accept with note…</button>
              {/if}
            {/if}
          </div>
          {#if open === k}<p class="why">{RULE_INFO[c.ruleId].explain}</p>{/if}
          {#if open === `${k}#o`}
            <form class="ovform" onsubmit={(e) => { e.preventDefault(); accept(c); }}>
              <label class="sr-only" for="note-{k}">Override note</label>
              <input id="note-{k}" type="text" placeholder="e.g. Client accepts the risk" bind:value={note} />
              <button class="btn small primary" disabled={!note.trim()}>Accept</button>
            </form>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  <p class="muted small">Checks use the catalog's draft facts and your site settings. They are advice, not guarantees; inferred conditions are never treated as observed.</p>
</section>

<style>
  .checks { display: flex; flex-direction: column; gap: 8px; }
  header { display: flex; align-items: baseline; gap: 8px; }
  header h3 { margin: 0; font-size: 16px; }
  header .small { flex: 1; }
  .close { border: 0; background: none; font-size: 20px; cursor: pointer; color: var(--ink-soft); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { border-radius: 10px; padding: 8px 10px; background: var(--info-bg); font-size: 13px; }
  li.error { background: var(--danger-bg); }
  li.warning { background: var(--warn-bg); }
  .top { display: flex; gap: 8px; }
  .body p { margin: 2px 0 0; }
  code { font-size: 10px; color: var(--ink-soft); }
  .ov { color: var(--info-ink); font-style: italic; }
  .acts { display: flex; gap: 12px; margin: 6px 0 0 24px; flex-wrap: wrap; }
  .link { background: none; border: 0; color: var(--accent-ink); font-weight: 600; cursor: pointer; padding: 0; font-size: 12px; }
  .why { margin: 6px 0 0 24px; font-size: 12px; color: var(--ink-soft); }
  .ovform { display: flex; gap: 6px; margin: 6px 0 0 24px; }
  .ovform input { flex: 1; }
  .ok { color: var(--ok); margin: 0; font-size: 13px; }
  .small { font-size: 12px; margin: 0; }
</style>
