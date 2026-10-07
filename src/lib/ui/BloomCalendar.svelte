<script lang="ts">
  import type { Project } from '../model/types';
  import type { Catalog } from '../catalog/catalog';
  import { bloomCalendar } from '../analysis/schedule';
  import { monthName } from '../analysis/checks';

  let { project, cat }: { project: Project; cat: Catalog } = $props();

  const rows = $derived(bloomCalendar(project, cat));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const totals = $derived(months.map((m) => rows.filter((r) => r.months.includes(m)).reduce((a, r) => a + r.count, 0)));
  const gap = (m: number, i: number) => m >= 4 && m <= 10 && totals[i] === 0;
</script>

{#if rows.length}
  <div class="wrap">
    <table class="bloom">
      <caption class="sr-only">Bloom calendar: which planted species flower in each month</caption>
      <thead>
        <tr>
          <th scope="col" class="name">Plant</th>
          {#each months as m, i}<th scope="col" class:gap={gap(m, i)}>{monthName(m)}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.plantId)}
          <tr aria-label="{r.name}: flowers in {r.months.map(monthName).join(', ')}">
            <th scope="row" class="name">{r.name} <span class="muted">×{r.count}</span></th>
            {#each months as m, i}
              <td class:gap={gap(m, i)}>
                {#if r.months.includes(m)}<span class="cell" style="background:{r.color}" title="{r.name} in bloom in {monthName(m)}"></span>{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" class="name">Plants in bloom</th>
          {#each months as m, i}<td class="total" class:gap={gap(m, i)}>{totals[i] || '–'}</td>{/each}
        </tr>
      </tfoot>
    </table>
    <p class="legend muted">Cells use each plant's real flower colour. Tinted columns are April–October months with nothing in flower.</p>
  </div>
{:else}
  <p class="muted">No flowering plants placed yet.</p>
{/if}

<style>
  .wrap { overflow-x: auto; }
  .bloom { border-collapse: collapse; width: 100%; font-size: 12px; min-width: 560px; }
  th, td { padding: 3px 2px; text-align: center; border-bottom: 1px solid var(--grid); }
  thead th { font-weight: 600; color: var(--ink-soft); font-size: 11px; }
  .name { text-align: left; font-weight: 500; white-space: nowrap; padding-right: 10px; width: 1%; }
  .cell { display: block; height: 14px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, .12); }
  .gap { background: var(--warn-bg); }
  .total { font-weight: 600; color: var(--ink); }
  tfoot th, tfoot td { border-top: 1px solid var(--border); border-bottom: 0; }
  .legend { font-size: 11px; margin: 6px 0 0; }
  @media print { .gap { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .cell { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
