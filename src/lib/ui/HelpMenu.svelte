<script lang="ts">
  // Help button for the editor toolbar: getting-started steps, keyboard shortcuts and links, in a popover.
  // Opens with the button, "?" or `open` (bound by the parent's More sheet on phones); closes on Esc,
  // an outside click, the × or the button again. Below 860 px the popover becomes a bottom sheet.
  let { readonly = false, open = $bindable(false) }: { readonly?: boolean; open?: boolean } = $props();

  let root: HTMLDivElement;

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = mac ? '⌘' : 'Ctrl';
  const alt = mac ? '⌥' : 'Alt';

  type Row = { keys: string[]; label: string };
  const groups: { title: string; rows: Row[]; edit: boolean }[] = [
    { title: 'Tools', edit: true, rows: [
      { keys: ['V'], label: 'Select' }, { keys: ['B'], label: 'Boundary' }, { keys: ['A'], label: 'Area' },
      { keys: ['L'], label: 'Line' }, { keys: ['O'], label: 'Object' }, { keys: ['P'], label: 'Plant' },
      { keys: ['H'], label: 'Hedge / row' }, { keys: ['M'], label: 'Drift' }, { keys: ['G'], label: 'Grid' }, { keys: ['N'], label: 'Note' }
    ] },
    { title: 'Drawing', edit: true, rows: [
      { keys: ['Enter'], label: 'Finish the shape' }, { keys: ['⌫'], label: 'Remove the last point' },
      { keys: ['Esc'], label: 'Cancel the shape · then back to Select · then deselect' },
      { keys: ['⇧'], label: 'Lock to 45°' }, { keys: [alt], label: 'Place without snapping' },
      { keys: ['Double-click'], label: 'Delete a corner of the selected shape' }
    ] },
    { title: 'Selection', edit: true, rows: [
      { keys: ['⌫'], label: 'Delete' }, { keys: ['D'], label: 'Duplicate' },
      { keys: ['R'], label: 'Rotate 15°' }, { keys: ['⇧R'], label: 'Rotate −15°' },
      { keys: ['↑↓←→'], label: 'Nudge one grid step' }, { keys: ['⇧ + arrows'], label: 'Nudge ten steps' },
      { keys: [`${cmd}Z`], label: 'Undo' }, { keys: [mac ? '⇧⌘Z' : 'Ctrl Y'], label: 'Redo' }
    ] },
    { title: 'View', edit: false, rows: [
      { keys: ['[', ']'], label: 'Previous / next month' }, { keys: ['1'], label: '2D plan' }, { keys: ['2'], label: '3D view' },
      { keys: ['3'], label: 'Split view' }, { keys: ['Wheel'], label: 'Zoom the plan' }, { keys: ['Ctrl + wheel'], label: 'Zoom faster' },
      { keys: ['Drag'], label: 'Pan' }, { keys: ['?'], label: 'This help' }
    ] }
  ];
  const shown = $derived(groups.filter((g) => !readonly || !g.edit));

  const starts: { step: string; how: string }[] = [
    { step: 'Draw a boundary', how: 'press B and click the corners; Enter closes it.' },
    { step: 'Plant a hedge', how: 'pick a plant, choose Row / hedge, draw a line.' },
    { step: 'Compare options', how: 'Design options › Save as option, then restore any later.' },
    { step: 'Share or print', how: 'Share for a view-only link; Export › Print / PDF.' }
  ];

  const links: { name: string; href: string }[] = [
    { name: 'Guides', href: 'https://openlandscape3d.com/guides' },
    { name: 'Plant library', href: 'https://openlandscape3d.com/plants' },
    { name: 'File format', href: 'https://openlandscape3d.com/docs/export-format' },
    { name: 'Support', href: 'https://openlandscape3d.com/support' },
    { name: 'iPhone, iPad & Mac app', href: 'https://openlandscape3d.com/app' },
    { name: 'Source', href: 'https://github.com/laanlabs' }
  ];

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
    <div class="panel" role="dialog" aria-label="Help">
      <div class="head">
        <h3>Help</h3>
        <button class="close" onclick={() => (open = false)} aria-label="Close help">×</button>
      </div>

      {#if !readonly}
        <h4>Getting started</h4>
        <ol class="starts">
          {#each starts as s (s.step)}<li><strong>{s.step}:</strong> {s.how}</li>{/each}
        </ol>
      {/if}

      <h4>Keyboard shortcuts</h4>
      {#each shown as g (g.title)}
        <h5>{g.title}</h5>
        <dl>
          {#each g.rows as r (g.title + r.label)}
            <dt>{#each r.keys as k, i (k)}{#if i}<span class="sep"> </span>{/if}<kbd>{k}</kbd>{/each}</dt>
            <dd>{r.label}</dd>
          {/each}
        </dl>
      {/each}

      <h4>More</h4>
      <ul class="links">
        {#each links as l (l.href)}<li><a href={l.href} target="_blank" rel="noopener">{l.name}</a></li>{/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .help { position: relative; }
  .btn.on { border-color: var(--accent); }
  .panel { position: absolute; right: 0; top: calc(100% + 6px); background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); padding: 12px 14px; z-index: 30; width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 90px); overflow: auto; text-align: left; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 0; font-size: 15px; }
  h4 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
  h5 { margin: 8px 0 3px; font-size: 12px; color: var(--ink); font-weight: 600; }
  .close { border: 0; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: var(--ink-soft); padding: 0 2px; }
  .starts { margin: 0; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 13px; align-items: center; }
  dt { white-space: nowrap; }
  dd { margin: 0; color: var(--ink); }
  kbd { font-family: inherit; font-size: 11px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: var(--bg); color: var(--ink); }
  .links { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
  .links a { color: var(--accent-ink); font-weight: 600; text-decoration: none; }
  .links a:hover { text-decoration: underline; }

  @media (max-width: 860px) {
    /* The More sheet in the footer opens the help; the header stays uncluttered. */
    .help > .btn { display: none; }
    .panel { position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-width: none; max-height: 70dvh; border-radius: 16px 16px 0 0; z-index: 45; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
