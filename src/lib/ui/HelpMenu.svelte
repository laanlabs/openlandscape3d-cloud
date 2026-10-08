<script lang="ts">
  // Help button for the editor toolbar: keyboard shortcuts in a popover.
  // Opens with the button or "?", closes on Esc, an outside click or the button again.
  let { readonly = false }: { readonly?: boolean } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = mac ? '⌘' : 'Ctrl';

  type Row = { keys: string[]; label: string };
  const groups: { title: string; rows: Row[]; edit: boolean }[] = [
    { title: 'Tools', edit: true, rows: [
      { keys: ['V'], label: 'Select' }, { keys: ['B'], label: 'Boundary' }, { keys: ['A'], label: 'Area' },
      { keys: ['L'], label: 'Line' }, { keys: ['O'], label: 'Object' }, { keys: ['P'], label: 'Plant' },
      { keys: ['H'], label: 'Hedge / row' }, { keys: ['M'], label: 'Drift' }, { keys: ['G'], label: 'Grid' }
    ] },
    { title: 'Editing', edit: true, rows: [
      { keys: ['Enter'], label: 'Finish shape' }, { keys: ['Esc'], label: 'Cancel / deselect' }, { keys: ['⌫'], label: 'Delete' },
      { keys: [`${cmd}Z`], label: 'Undo' }, { keys: [mac ? '⇧⌘Z' : 'Ctrl Y'], label: 'Redo' },
      { keys: ['D'], label: 'Duplicate' }, { keys: ['R'], label: 'Rotate' }
    ] },
    { title: 'View', edit: false, rows: [
      { keys: ['[', ']'], label: 'Previous / next month' }, { keys: ['1'], label: '2D plan' }, { keys: ['2'], label: '3D view' },
      { keys: ['3'], label: 'Split view' }, { keys: ['?'], label: 'This help' }
    ] }
  ];
  const shown = $derived(groups.filter((g) => !readonly || !g.edit));

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open = !open; return; }
    // Capture phase: close the help before the editor treats Esc as "cancel tool".
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open = false; }
  }

  function onPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerdown={onPointer} />

<div class="help" bind:this={root}>
  <button class="btn" class:on={open} onclick={() => (open = !open)} aria-expanded={open} aria-haspopup="dialog" title="Help and keyboard shortcuts (?)">
    <span aria-hidden="true">?</span><span class="hide-sm">Help</span>
  </button>
  {#if open}
    <div class="panel" role="dialog" aria-label="Keyboard shortcuts">
      <h3>Keyboard shortcuts</h3>
      {#each shown as g (g.title)}
        <h4>{g.title}</h4>
        <dl>
          {#each g.rows as r (r.label)}
            <dt>{#each r.keys as k, i (k)}{#if i}<span class="sep"> </span>{/if}<kbd>{k}</kbd>{/each}</dt>
            <dd>{r.label}</dd>
          {/each}
        </dl>
      {/each}
    </div>
  {/if}
</div>

<style>
  .help { position: relative; }
  .btn.on { border-color: var(--accent); }
  .panel { position: absolute; right: 0; top: calc(100% + 6px); background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); padding: 12px 14px; z-index: 30; width: 300px; max-height: calc(100vh - 90px); overflow: auto; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
  dl { display: grid; grid-template-columns: 64px 1fr; gap: 4px 12px; margin: 0; font-size: 13px; align-items: center; }
  dt { white-space: nowrap; }
  dd { margin: 0; color: var(--ink); }
  kbd { font-family: inherit; font-size: 11px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: var(--bg); color: var(--ink); }
</style>
