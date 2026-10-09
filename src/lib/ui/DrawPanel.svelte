<script lang="ts">
  import type { Editor } from './editor.svelte';
  import { OBJECT_PRESETS } from './editor.svelte';
  import { AREA_KINDS, type AreaKind, type LineKind, type LineStyle } from '../model/types';

  let { editor }: { editor: Editor } = $props();

  const AREA_LABEL: Record<AreaKind, string> = { lawn: 'Lawn', bed: 'Planting bed', mulch: 'Mulch', gravel: 'Gravel', patio: 'Patio', path: 'Path', deck: 'Deck', driveway: 'Driveway', water: 'Pool / pond' };
  const AREA_COLOR: Record<AreaKind, string> = { lawn: '#9cc47a', bed: '#7a5a3c', mulch: '#6b4a32', gravel: '#c9bfa8', patio: '#a3a9ad', path: '#c2b59b', deck: '#9c7a5c', driveway: '#6c6f72', water: '#7cc0dc' };
  const LINES: { kind: LineKind; style: LineStyle; name: string }[] = [
    { kind: 'fence', style: 'board', name: 'Board fence' }, { kind: 'fence', style: 'picket', name: 'Picket fence' },
    { kind: 'fence', style: 'metal', name: 'Metal fence' }, { kind: 'fence', style: 'rail', name: 'Rail fence' },
    { kind: 'retaining_wall', style: 'block', name: 'Retaining wall' }, { kind: 'edging', style: 'steel', name: 'Edging' }
  ];

  function area(kind: AreaKind) { editor.areaKind = kind; editor.tool = 'area'; }
  function line(kind: LineKind, style: LineStyle) { editor.lineKind = kind; editor.lineStyle = style; editor.tool = 'line'; }
  function object(id: string) { editor.objectId = id; editor.tool = 'object'; }
</script>

<div class="draw">
  <div class="row">
    <button class="btn small" class:primary={editor.tool === 'select'} onclick={() => (editor.tool = 'select')} aria-pressed={editor.tool === 'select'}>Select (V)</button>
    <button class="btn small" class:primary={editor.tool === 'boundary'} onclick={() => (editor.tool = 'boundary')} aria-pressed={editor.tool === 'boundary'}>Property boundary (B)</button>
  </div>

  <section>
    <h4>Areas <span class="muted">(A)</span></h4>
    <div class="tiles">
      {#each AREA_KINDS as k (k)}
        <button class="tile" class:on={editor.tool === 'area' && editor.areaKind === k} aria-pressed={editor.tool === 'area' && editor.areaKind === k} onclick={() => area(k)}>
          <span class="sw" style:background={AREA_COLOR[k]}></span>{AREA_LABEL[k]}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h4>Lines <span class="muted">(L)</span></h4>
    <div class="tiles">
      {#each LINES as l (l.name)}
        <button class="tile" class:on={editor.tool === 'line' && editor.lineKind === l.kind && (l.kind !== 'fence' || editor.lineStyle === l.style)} onclick={() => line(l.kind, l.style)}>
          <span class="ln {l.kind} {l.style}"></span>{l.name}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h4>Site objects <span class="muted">(O)</span></h4>
    <div class="tiles">
      {#each OBJECT_PRESETS as o (o.id)}
        <button class="tile" class:on={editor.tool === 'object' && editor.objectId === o.id} onclick={() => object(o.id)}>{o.name}</button>
      {/each}
    </div>
  </section>

  <section>
    <h4>Annotate <span class="muted">(N)</span></h4>
    <div class="tiles">
      <button class="tile" class:on={editor.tool === 'note'} aria-pressed={editor.tool === 'note'} onclick={() => (editor.tool = 'note')}><span class="pin" aria-hidden="true"></span>Note</button>
    </div>
    <p class="muted small">Click the plan to pin a note for the team; it travels to the iOS app with the site.</p>
  </section>

  <p class="muted small">Click to add corners; click the first corner, double-click or press Enter to finish. Hold Shift for 45° lines and Alt to place without snapping. Select a shape to drag its corners.</p>
</div>

<style>
  .draw { display: flex; flex-direction: column; gap: 12px; }
  section { display: flex; flex-direction: column; gap: 6px; }
  h4 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .tile { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border); background: var(--panel); border-radius: 9px; padding: 7px 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; }
  .tile:hover { border-color: var(--accent); }
  .tile.on { border-color: var(--accent); background: var(--accent-bg); }
  .sw { width: 16px; height: 16px; border-radius: 4px; flex: none; }
  .ln { width: 18px; height: 0; border-top: 3px solid #7a5532; flex: none; }
  .ln.picket { border-top-style: dotted; }
  .ln.rail { border-top-style: dashed; }
  .ln.metal { border-top-color: #444; }
  .ln.retaining_wall { border-top: 6px solid #7d7468; }
  .ln.edging { border-top: 2px solid #5b4a3f; }
  .small { font-size: 12px; margin: 0; }
  .pin { width: 12px; height: 12px; border-radius: 50%; background: #3b6fb6; border: 2px solid #fff; box-shadow: 0 0 0 1px #3b6fb6; flex: none; }
</style>
