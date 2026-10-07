<script lang="ts">
  import type { Project } from '../model/types';
  import { Editor } from './editor.svelte';
  import PlanView from './PlanView.svelte';
  import SchedulesView from './SchedulesView.svelte';
  import Logo from './Logo.svelte';
  import { RULE_INFO } from '../analysis/checks';
  import { plantingYear } from '../analysis/schedule';

  let { project }: { project: Project } = $props();
  // svelte-ignore state_referenced_locally
  const editor = new Editor(project, { readonly: true });
  const p = editor.project;
  const region = editor.cat.region(p.site.regionId);
  const proposed = p.plants.filter((i) => i.status === 'proposed').length;
  const sevLabel = { error: 'Error', warning: 'Warning', info: 'Info' } as const;
</script>

<div class="print">
  <header>
    <Logo word />
    <div class="meta">
      <h1>{p.name}</h1>
      <span>{new Date().toLocaleDateString()} · {region?.name ?? p.site.regionId} · USDA zone {p.site.hardiness.zone} · frost {p.site.frost.lastSpring} / {p.site.frost.firstFall} (MM-DD) · planting year {plantingYear(p)}</span>
      <span>{proposed} proposed plants · {p.areas.length} areas · {p.lines.length} fences &amp; walls · {p.web.units === 'imperial' ? 'imperial' : 'metric'} units</span>
    </div>
    <button class="btn primary noprint" onclick={() => window.print()}>Print / save as PDF</button>
  </header>

  <section class="page">
    <h2>Site plan</h2>
    <div class="plan"><PlanView {editor} print /></div>
    <p class="note">North arrow as drawn on the plan. Plant symbols show the size at year {p.scenario.year} after planting; dashed rings (when shown) are mature spread.</p>
  </section>

  <section class="page">
    <SchedulesView {editor} print />
  </section>

  <section>
    <h2>Design checks</h2>
    {#if editor.checks.length}
      <ul class="checks">
        {#each editor.checks as c, i (i)}
          <li>
            <span class="badge" class:bad={c.severity === 'error'} class:draft={c.severity === 'warning'} class:info={c.severity === 'info'}>{sevLabel[c.severity]}</span>
            <strong>{RULE_INFO[c.ruleId].title}</strong> <span class="muted">{c.ruleId}</span> — {c.message}
            {#if c.overridden}<em class="muted"> (overridden from {c.overridden.originalSeverity})</em>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p>No issues found.</p>
    {/if}
    <p class="note">Plant facts are draft, unreviewed editorial data. Sizes are scenarios, not predictions. Verify boundaries and utilities before digging. Generated with OpenLandscape3D (MIT) — Powered by OpenPlan3D.</p>
  </section>
</div>

<style>
  .print { max-width: 1050px; margin: 0 auto; padding: 24px; background: white; color: #111; display: flex; flex-direction: column; gap: 22px; }
  header { display: flex; gap: 20px; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; }
  .meta { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  h1 { margin: 0; font-size: 22px; }
  h2 { font-size: 15px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .05em; }
  .plan { height: 600px; border: 1px solid #ccc; position: relative; }
  .plan :global(.tools), .plan :global(.legend) { display: none; }
  .checks { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
  .note { font-size: 11px; color: #555; }
  @media print {
    .noprint { display: none; }
    .print { padding: 0; }
    .page { break-after: page; }
  }
</style>
