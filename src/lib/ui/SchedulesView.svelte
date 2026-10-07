<script lang="ts">
  import type { Editor } from './editor.svelte';
  import BloomCalendar from './BloomCalendar.svelte';
  import { taskSchedule, plantingYear } from '../analysis/schedule';
  import { monthName } from '../analysis/checks';
  import { fmtLen } from '../model/units';
  import { plantScheduleCsv, taskScheduleCsv } from '../io/csv';
  import { download } from '../io/download';
  import { fileName } from '../io/openplan';

  let { editor, print = false }: { editor: Editor; print?: boolean } = $props();

  let tab = $state<'plants' | 'tasks' | 'bloom'>('plants');
  const p = $derived(editor.project);
  const rows = $derived(editor.schedule);
  const tasks = $derived(taskSchedule(p, editor.cat));
  const total = $derived(rows.reduce((a, r) => a + r.quantity, 0));
  const year = $derived(plantingYear(p));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const fmtDate = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${monthName(m)} ${d}`;
  };
  const frostLabel = (mmdd: string) => fmtDate(`2000-${mmdd}`);

  /** One calendar row per distinct task label, spanning the union of its windows' months. */
  const strips = $derived.by(() => {
    const map = new Map<string, { label: string; spans: { from: number; to: number; alternate: boolean }[] }>();
    for (const t of tasks) {
      const label = t.task.replace(' (alternate window)', '');
      const e = map.get(label) ?? { label, spans: [] as { from: number; to: number; alternate: boolean }[] };
      const from = Number(t.start.slice(5, 7)) + (Number(t.start.slice(0, 4)) - year) * 12;
      const to = Number(t.end.slice(5, 7)) + (Number(t.end.slice(0, 4)) - year) * 12;
      const span = { from: Math.max(1, from), to: Math.min(12, to), alternate: t.alternate };
      if (span.to < span.from) continue;
      if (!e.spans.some((s) => s.from === span.from && s.to === span.to && s.alternate === span.alternate)) e.spans.push(span);
      map.set(label, e);
    }
    return [...map.values()];
  });

  function csv(kind: 'plants' | 'tasks') {
    if (kind === 'plants') download(fileName(p, 'plant-schedule', 'csv'), plantScheduleCsv(p, editor.cat), 'text/csv');
    else download(fileName(p, 'task-schedule', 'csv'), taskScheduleCsv(p, editor.cat), 'text/csv');
  }
</script>

<div class="sched" class:print>
  {#if !print}
    <div class="bar">
      <div class="seg" role="tablist" aria-label="Schedules">
        <button role="tab" aria-selected={tab === 'plants'} class:on={tab === 'plants'} onclick={() => (tab = 'plants')}>Plant schedule</button>
        <button role="tab" aria-selected={tab === 'tasks'} class:on={tab === 'tasks'} onclick={() => (tab = 'tasks')}>Tasks</button>
        <button role="tab" aria-selected={tab === 'bloom'} class:on={tab === 'bloom'} onclick={() => (tab = 'bloom')}>Bloom calendar</button>
      </div>
      <span class="spacer"></span>
      <button class="btn small" onclick={() => csv('plants')}>Plant schedule CSV</button>
      <button class="btn small" onclick={() => csv('tasks')}>Task schedule CSV</button>
    </div>
  {/if}

  {#if print || tab === 'plants'}
    <section>
      {#if print}<h2>Plant schedule</h2>{/if}
      {#if rows.length}
        <div class="scroll">
          <table>
            <thead>
              <tr><th>Code</th><th>Scientific name</th><th>Common name</th><th class="num">Qty</th><th>Size</th><th class="num">Spacing</th><th class="num">Mature H × W</th><th>Native</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {#each rows as r (r.plantId + r.install_size)}
                <tr>
                  <td><strong>{r.code}</strong></td>
                  <td><em>{r.scientific_name}</em></td>
                  <td>{r.common_name}</td>
                  <td class="num">{r.quantity}</td>
                  <td>{r.install_size}</td>
                  <td class="num">{r.spacing_m ? fmtLen(r.spacing_m, p.web.units) : '—'}</td>
                  <td class="num">{r.mature_height_m ? `${fmtLen(r.mature_height_m, p.web.units)} × ${fmtLen(r.mature_spread_m, p.web.units)}` : '—'}</td>
                  <td>{r.native ? '✓' : ''}</td>
                  <td class="muted small">{r.notes}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot><tr><td colspan="3"><strong>Total proposed plants</strong></td><td class="num"><strong>{total}</strong></td><td colspan="5"></td></tr></tfoot>
          </table>
        </div>
      {:else}
        <p class="muted">No proposed plants yet. Existing and retained plants are not listed for purchase.</p>
      {/if}
    </section>
  {/if}

  {#if print || tab === 'tasks'}
    <section>
      {#if print}<h2>Task calendar</h2>{/if}
      <p class="muted small">
        Dates are estimates for planting year {year}, computed from the site's frost dates (last spring frost {frostLabel(p.site.frost.lastSpring)}, first fall frost {frostLabel(p.site.frost.firstFall)}).
        Rules are draft editorial guidance; confirm with local extension advice.
      </p>
      {#if tasks.length}
        <div class="scroll">
          <div class="cal" role="img" aria-label="Task calendar, January to December">
            <div class="cal-row head"><span class="lab"></span>{#each months as m}<span class="m">{monthName(m)}</span>{/each}</div>
            {#each strips as s (s.label)}
              <div class="cal-row">
                <span class="lab">{s.label}</span>
                <span class="track">
                  {#each s.spans as sp}
                    <span class="span" class:alt={sp.alternate} style="left:{((sp.from - 1) / 12) * 100}%; width:{((sp.to - sp.from + 1) / 12) * 100}%" title="{s.label}{sp.alternate ? ' (alternate window)' : ''}: {monthName(sp.from)}–{monthName(sp.to)}"></span>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
          <table>
            <thead><tr><th>When</th><th>Task</th><th>Plant</th><th class="num">Qty</th><th>Repeats</th><th>Confidence</th></tr></thead>
            <tbody>
              {#each tasks as t, i (i)}
                <tr>
                  <td class="nowrap">{fmtDate(t.start)} – {fmtDate(t.end)}</td>
                  <td>{t.task}{#if t.constraints}<div class="muted small">{t.constraints}</div>{/if}</td>
                  <td>{t.plant} <em class="muted small">{t.scientific_name}</em></td>
                  <td class="num">{t.quantity}</td>
                  <td>{t.recurrence.replace(/-/g, ' ')}</td>
                  <td><span class="badge" class:draft={t.confidence === 'low'} class:info={t.confidence === 'medium'}>{t.confidence}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">Tasks appear once proposed plants are placed.</p>
      {/if}
    </section>
  {/if}

  {#if print || tab === 'bloom'}
    <section>
      {#if print}<h2>Bloom calendar</h2>{/if}
      <BloomCalendar project={p} cat={editor.cat} />
    </section>
  {/if}
</div>

<style>
  .sched { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  section { min-height: 0; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  .scroll { overflow: auto; max-height: 60dvh; }
  .print .scroll { max-height: none; overflow: visible; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th { text-align: left; font-weight: 600; color: var(--ink-soft); font-size: 11.5px; border-bottom: 1px solid var(--border); padding: 5px 6px; position: sticky; top: 0; background: var(--panel); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--grid); vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .small { font-size: 11.5px; }
  p.small { margin: 0; }
  .cal { display: flex; flex-direction: column; gap: 3px; min-width: 560px; margin-top: 6px; }
  .cal-row { display: grid; grid-template-columns: 200px 1fr; align-items: center; font-size: 11.5px; }
  .cal-row.head { grid-template-columns: 200px repeat(12, 1fr); color: var(--ink-soft); font-weight: 600; }
  .m { text-align: center; border-left: 1px solid var(--grid); }
  .lab { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
  .track { position: relative; height: 14px; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 12 - 1px), var(--grid) calc(100% / 12 - 1px), var(--grid) calc(100% / 12)); border-radius: 3px; }
  .span { position: absolute; top: 2px; bottom: 2px; background: var(--accent); border-radius: 3px; opacity: .85; }
  .span.alt { background: transparent; border: 1.5px dashed var(--accent); }
  @media print { .span { -webkit-print-color-adjust: exact; print-color-adjust: exact; } th { position: static; } }
</style>
