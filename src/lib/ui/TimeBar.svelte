<script lang="ts">
  import type { Editor } from './editor.svelte';
  import { monthName } from '../analysis/checks';
  import { solarPosition, dayLength } from '../analysis/sun';
  import { regionCenter } from '../site/regions';

  let { editor }: { editor: Editor } = $props();
  const sc = $derived(editor.project.scenario);
  const lat = $derived(editor.project.site.location?.lat ?? regionCenter(editor.project.site.regionId, editor.cat)[0]);
  const sun = $derived(solarPosition(lat, sc.month, sc.hour));
  const day = $derived(dayLength(lat, sc.month));
  const PRESETS = [0, 1, 3, 5, 10, 20];
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = (az: number) => DIRS[Math.round(((az * 180) / Math.PI) / 45) % 8];
  const hourLabel = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); const ap = hh >= 12 ? 'pm' : 'am'; return `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${ap}`; };
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<div class="time" role="group" aria-label="Season, growth and time of day">
  <label class="ctl month">
    <span class="lbl">Month <strong>{monthName(sc.month)}</strong></span>
    <input type="range" min="1" max="12" step="1" value={sc.month} oninput={(e) => editor.setScenario({ month: num(e) })} aria-valuetext={monthName(sc.month)} />
  </label>
  <div class="ctl years">
    <span class="lbl">Years after planting <strong>{sc.year}</strong></span>
    <div class="row">
      <div class="seg small" role="radiogroup" aria-label="Years after planting">
        {#each PRESETS as y (y)}<button role="radio" aria-checked={sc.year === y} class:on={sc.year === y} onclick={() => editor.setScenario({ year: y })}>{y}</button>{/each}
      </div>
      <input type="range" min="0" max="30" step="1" value={sc.year} oninput={(e) => editor.setScenario({ year: num(e) })} aria-label="Years after planting" />
    </div>
  </div>
  <label class="ctl hour">
    <span class="lbl">Time <strong>{hourLabel(sc.hour)}</strong> <span class="muted">{sun.altitude > 0 ? `sun ${Math.round((sun.altitude * 180) / Math.PI)}° ${compass(sun.azimuth)}` : 'sun down'}</span></span>
    <input type="range" min={Math.max(0, Math.floor(day.rise * 2) / 2 - 0.5)} max={Math.min(24, Math.ceil(day.set * 2) / 2 + 0.5)} step="0.5" value={sc.hour} oninput={(e) => editor.setScenario({ hour: num(e) })} aria-valuetext={hourLabel(sc.hour)} />
  </label>
  <label class="ghost"><input type="checkbox" checked={editor.ghost} onchange={(e) => editor.setGhost((e.currentTarget as HTMLInputElement).checked)} /> Mature canopy</label>
</div>

<style>
  .time { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; }
  .ctl { display: flex; flex-direction: column; gap: 2px; font-size: 12px; min-width: 150px; }
  .ctl input[type='range'] { width: 100%; accent-color: var(--accent); }
  .month { flex: 1 1 160px; }
  .years { flex: 2 1 280px; }
  .years .row { flex-wrap: nowrap; }
  .years input { flex: 1; min-width: 80px; }
  .hour { flex: 1 1 200px; }
  .lbl { color: var(--ink-soft); white-space: nowrap; }
  .lbl strong { color: var(--ink); }
  .ghost { font-size: 12px; display: flex; gap: 5px; align-items: center; white-space: nowrap; }
</style>
