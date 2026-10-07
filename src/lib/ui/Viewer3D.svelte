<script lang="ts">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { onMount } from 'svelte';
  import type { Editor } from './editor.svelte';
  import { SOFT_AREAS, buildArea, buildBoundary, buildBuilding, buildGround, buildLine, buildPlants, buildSiteObject, disposeGroup, siteBounds } from '../scene/build';
  import { sunDirection } from '../analysis/sun';
  import { regionCenter } from '../site/regions';

  let { editor, compact = false }: { editor: Editor; compact?: boolean } = $props();

  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let sun: THREE.DirectionalLight;
  let hemi: THREE.HemisphereLight;
  let raf = 0;
  let fitted = false;
  let autoFit = true;
  let shadowsOn = $state(true);

  const groundGroup = new THREE.Group();
  const softGroup = new THREE.Group();
  const hardGroup = new THREE.Group();
  const lineGroup = new THREE.Group();
  const objectGroup = new THREE.Group();
  const buildingGroup = new THREE.Group();
  const plantGroup = new THREE.Group();
  let pickables: THREE.InstancedMesh[] = [];
  const hashes = { ground: '', areas: '', lines: '', objects: '', building: '', plants: '' };

  export function screenshot(): string {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  export async function exportGlb(): Promise<Blob> {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const root = new THREE.Group();
    root.name = editor.project.name;
    for (const g of [softGroup, hardGroup, lineGroup, objectGroup, buildingGroup, plantGroup]) {
      const c = g.clone(true);
      c.traverse((o) => { if (o.name === 'ghost-rings' || o.name === 'selection-rings') o.visible = false; });
      root.add(c);
    }
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
  }

  function bounds() {
    const b = siteBounds(editor.project);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[1] + b.max[1]) / 2;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 6);
    return { cx, cz, size };
  }

  export function fit(view: 'iso' | 'top' | 'eye' = 'iso') {
    if (!camera) return;
    const { cx, cz, size } = bounds();
    const k = Math.max(1, 1.1 / Math.max(0.3, camera.aspect));
    const s = size * k;
    if (view === 'top') { controls.target.set(cx, 0, cz); camera.position.set(cx, s * 1.45, cz + 0.001); }
    else if (view === 'eye') { controls.target.set(cx, 1.2, cz); camera.position.set(cx, 1.65, cz + size * 0.75); }
    else { controls.target.set(cx, 0.5, cz); camera.position.set(cx + s * 0.55, s * 0.7, cz + s * 0.9); }
    controls.update();
  }

  // ---------- scene sync ----------

  function syncStatic() {
    const p = editor.project;
    const sel = editor.selection;
    const hGround = JSON.stringify(p.site.boundary ?? null);
    if (hGround !== hashes.ground) {
      hashes.ground = hGround;
      disposeGroup(groundGroup);
      const { size } = bounds();
      groundGroup.add(buildGround(Math.max(200, size * 4)));
      const b = buildBoundary(p.site.boundary);
      if (b) groundGroup.add(b);
    }
    const hAreas = JSON.stringify(p.areas);
    if (hAreas !== hashes.areas) {
      hashes.areas = hAreas;
      disposeGroup(softGroup);
      disposeGroup(hardGroup);
      for (const a of p.areas) {
        const o = buildArea(a, editor.cat);
        if (o) (SOFT_AREAS.has(a.kind) ? softGroup : hardGroup).add(o);
      }
    }
    const hLines = JSON.stringify(p.lines);
    if (hLines !== hashes.lines) {
      hashes.lines = hLines;
      disposeGroup(lineGroup);
      for (const l of p.lines) lineGroup.add(buildLine(l, editor.cat));
    }
    const hObjects = JSON.stringify([p.objects, sel?.kind === 'object' ? sel.id : null]);
    if (hObjects !== hashes.objects) {
      hashes.objects = hObjects;
      disposeGroup(objectGroup);
      for (const o of p.objects) objectGroup.add(buildSiteObject(o, sel?.kind === 'object' && sel.id === o.id));
    }
    const hBuilding = JSON.stringify([p.building?.walls ?? null, p.building?.objects ?? null]);
    if (hBuilding !== hashes.building) {
      hashes.building = hBuilding;
      disposeGroup(buildingGroup);
      buildingGroup.add(buildBuilding(p.building));
    }
  }

  function syncPlants() {
    const p = editor.project;
    const selected = editor.selectedIds;
    const h = JSON.stringify([p.plants, p.scenario.month, p.scenario.year, p.site.frost, [...selected], editor.ghost]);
    if (h === hashes.plants) return;
    hashes.plants = h;
    disposeGroup(plantGroup);
    const built = buildPlants(p, editor.cat, { selected, ghost: editor.ghost });
    plantGroup.add(built.group);
    pickables = built.pickables;
  }

  function syncLayers() {
    const hard = editor.layer('hardscape'), plant = editor.layer('planting');
    hardGroup.visible = hard;
    lineGroup.visible = hard;
    objectGroup.visible = hard;
    softGroup.visible = plant;
    plantGroup.visible = plant;
    buildingGroup.visible = editor.layer('building');
  }

  const DAY = new THREE.Color('#cfe2ee'), DUSK = new THREE.Color('#ecc9a6'), NIGHT = new THREE.Color('#1c2636');

  function syncSun() {
    const p = editor.project;
    const lat = p.site.location?.lat ?? regionCenter(p.site.regionId, editor.cat)[0];
    const dir = sunDirection(lat, p.scenario.month, p.scenario.hour, p.site.north ?? [0, -1]);
    const alt = Math.asin(Math.max(-1, Math.min(1, dir[1])));
    const { cx, cz, size } = bounds();
    const reach = size * 0.75 + 4;
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    const sky = scene.background as THREE.Color;
    if (alt <= 0) {
      sun.intensity = 0;
      sun.castShadow = false;
      hemi.intensity = 0.35;
      hemi.color.set('#8fa3c7');
      sky.copy(NIGHT);
      return;
    }
    const t = Math.min(1, alt / (25 * Math.PI / 180));
    sun.position.set(cx + dir[0] * reach * 2, dir[1] * reach * 2, cz + dir[2] * reach * 2);
    sun.intensity = 0.6 + 1.9 * t;
    sun.color.set('#ffd2a1').lerp(new THREE.Color('#fff6e8'), t);
    sun.castShadow = shadowsOn;
    const cam = sun.shadow.camera;
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
    cam.near = 0.5; cam.far = reach * 5;
    cam.updateProjectionMatrix();
    hemi.intensity = 0.55 + 0.35 * t;
    hemi.color.set('#ffffff');
    sky.copy(DUSK).lerp(DAY, t);
  }

  $effect(() => {
    // track dependencies
    editor.project; editor.selection; shadowsOn;
    if (!renderer) return;
    syncStatic();
    syncPlants();
    syncLayers();
    syncSun();
    if (!fitted) { fit(); fitted = true; }
  });

  // ---------- picking ----------

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;

  function onDown(e: PointerEvent) { downAt = { x: e.clientX, y: e.clientY }; }

  function onUp(e: PointerEvent) {
    const click = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4;
    downAt = null;
    if (!click) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [];
    if (plantGroup.visible) targets.push(...pickables);
    if (objectGroup.visible) targets.push(objectGroup);
    const hit = raycaster.intersectObjects(targets, true)[0];
    if (hit) {
      const ids = hit.object.userData.plantIds as string[] | undefined;
      if (ids && hit.instanceId != null && ids[hit.instanceId]) { editor.selection = { kind: 'plant', id: ids[hit.instanceId] }; return; }
      const oid = hit.object.userData.objectId as string | undefined;
      if (oid) { editor.selection = { kind: 'object', id: oid }; return; }
    }
    if (!editor.readonly) editor.selection = null;
  }

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#cfe2ee');

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1500);
    controls = new OrbitControls(camera, renderer.domElement);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.enableDamping = !reduced;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 0.5;
    controls.maxDistance = 400;
    controls.addEventListener('start', () => (autoFit = false));

    hemi = new THREE.HemisphereLight('#ffffff', '#8c8a6e', 0.8);
    sun = new THREE.DirectionalLight('#fff6e8', 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(hemi, sun, sun.target, groundGroup, softGroup, hardGroup, lineGroup, buildingGroup, objectGroup, plantGroup);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (autoFit) fit(); // keep the whole site framed until the user moves the camera
    });
    ro.observe(host);

    syncStatic();
    syncPlants();
    syncLayers();
    syncSun();
    fit();
    fitted = true;

    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const g of [groundGroup, softGroup, hardGroup, lineGroup, objectGroup, buildingGroup, plantGroup]) disposeGroup(g);
      renderer.dispose();
      renderer.domElement.remove();
    };
  });
</script>

<div class="viewer" bind:this={host} onpointerdown={onDown} onpointerup={onUp} role="application" aria-label="3D view">
  <div class="tools" class:compact onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} role="toolbar" aria-label="3D view controls" tabindex="-1">
    <button class="chip" onclick={() => fit('iso')} title="Reset view">⟲ View</button>
    <button class="chip" onclick={() => fit('top')} title="Top view">Top</button>
    <button class="chip" onclick={() => fit('eye')} title="Eye level">Eye level</button>
    <button class="chip" class:on={shadowsOn} aria-pressed={shadowsOn} onclick={() => (shadowsOn = !shadowsOn)} title="Sun shadows for the scenario month and hour">Shadows</button>
  </div>
</div>

<style>
  .viewer { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #cfe2ee; }
  .viewer :global(canvas) { display: block; width: 100%; height: 100%; }
  .tools { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 6px; flex-wrap: wrap; }
  .tools.compact { bottom: 8px; left: 8px; }
</style>
