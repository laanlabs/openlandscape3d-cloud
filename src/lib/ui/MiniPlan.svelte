<script lang="ts">
  import type { Project, Vec2 } from '../model/types';
  import { catalog } from '../catalog/catalog';
  import { bbox, rectCorners, wallSegments } from '../model/geometry';
  import { sizeAt } from '../analysis/growth';

  let { project, height = 160 }: { project: Project; height?: number } = $props();

  const KIND_COLOR: Record<string, string> = {
    lawn: '#9cc47a', bed: '#7a5a3e', mulch: '#7a5a3e', gravel: '#c9bfa9', patio: '#a3acb3',
    path: '#c2b8a3', deck: '#9c7a5c', driveway: '#7b7e80', water: '#7cc0dc'
  };

  const walls = $derived(wallSegments(project.building));
  const plants = $derived(
    project.plants.map((i) => {
      const pl = catalog.plant(i.plantId);
      const s = sizeAt(i, pl, project.scenario?.year ?? 5);
      return { id: i.id, x: i.x, y: i.y, r: Math.max(0.15, s.spread / 2), color: pl?.foliageColor ?? '#6b8f5a', status: i.status };
    })
  );
  const view = $derived.by(() => {
    const pts: Vec2[] = [];
    if (project.site.boundary) pts.push(...project.site.boundary);
    for (const a of project.areas) pts.push(...a.polygon);
    for (const l of project.lines) pts.push(...l.points);
    for (const w of walls) pts.push(w.a, w.b);
    for (const p of plants) pts.push([p.x - p.r, p.y - p.r], [p.x + p.r, p.y + p.r]);
    for (const o of project.objects) pts.push([o.x, o.y]);
    if (!pts.length) return { x: -5, y: -5, w: 10, h: 10 };
    const b = bbox(pts);
    const w = Math.max(2, b.max[0] - b.min[0]), h = Math.max(2, b.max[1] - b.min[1]);
    const pad = Math.max(w, h) * 0.06;
    return { x: b.min[0] - pad, y: b.min[1] - pad, w: w + pad * 2, h: h + pad * 2 };
  });
  const k = $derived(Math.max(view.w, view.h) / 200);
  const pts = (q: Vec2[]) => q.map((a) => `${a[0].toFixed(2)},${a[1].toFixed(2)}`).join(' ');
</script>

<svg viewBox="{view.x} {view.y} {view.w} {view.h}" style="height:{height}px" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan of {project.name}">
  {#if project.site.boundary}
    <polygon points={pts(project.site.boundary)} fill="#f7f4ea" stroke="var(--boundary)" stroke-width={k * 1.4} stroke-dasharray="{k * 5} {k * 3}" />
  {/if}
  {#each project.areas as a (a.id)}
    <polygon points={pts(a.polygon)} fill={catalog.material(a.materialId)?.color ?? KIND_COLOR[a.kind] ?? '#ccc'} fill-opacity=".75" stroke="rgba(0,0,0,.15)" stroke-width={k * 0.6} />
  {/each}
  {#each project.lines as l (l.id)}
    <polyline points={pts(l.points)} fill="none" stroke={l.kind === 'fence' ? '#8a6a48' : l.kind === 'retaining_wall' ? '#7d756b' : '#4a3d33'} stroke-width={k * (l.kind === 'edging' ? 0.8 : 1.6)} />
  {/each}
  {#each walls as w (w.id)}
    <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="var(--building)" stroke-width={Math.max(w.thickness, k * 2)} stroke-linecap="square" />
  {/each}
  {#each project.objects as o (o.id)}
    <polygon points={pts(rectCorners(o.x, o.y, o.width, o.depth, o.rotation))} fill="#b9a68c" stroke="#5c4f40" stroke-width={k * 0.5} />
  {/each}
  {#each plants as p (p.id)}
    <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} fill-opacity={p.status === 'remove' ? 0.25 : 0.8} stroke="rgba(20,40,25,.5)" stroke-width={k * 0.4} />
  {/each}
</svg>

<style>
  svg { width: 100%; display: block; }
</style>
