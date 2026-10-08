// "Render this view": a hi-res still of the current 3D camera with detailed plants, textured ground,
// grass on lawns, a physical sky lit from the site's sun position, soft shadows and ambient occlusion.
// Loaded on demand (dynamic import from the 3D view) so the editor bundle stays small.
//
// Faithful to the design: every plant is drawn at the editor's position, rotation and size — the same
// seeded jitter, growth model (sizeAt) and season look (seasonLook) as scene/build.ts — only with a
// detailed model instead of a primitive. Plants marked "remove" are left out (the render shows the
// proposed garden).
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Catalog } from '../catalog/catalog';
import type { Area, Project, Polygon } from '../model/types';
import { buildArea, buildBuilding, buildGround, buildLine, buildSiteObject, disposeGroup, siteBounds } from '../scene/build';
import { seasonLook, sizeAt } from '../analysis/growth';
import { rng } from '../analysis/groups';
import { sunDirection } from '../analysis/sun';
import { regionCenter } from '../site/regions';
import { VARIANTS, archetypeFor, aspectClass, plantModel, type PlantModel } from './plantModels';
import { barkTexture, leafAtlas, surfaceTexture } from './textures';

export interface RenderOptions {
  /** Output width in pixels; height follows the camera's aspect ratio. */
  width: number;
  aspect: number;
  onProgress?: (step: string) => void;
}

export interface RenderResult {
  blob: Blob;
  width: number;
  height: number;
  /** True when the scenario hour is at night and a mid-morning sun was used instead. */
  daylightSubstituted: boolean;
}

const DEFAULT_CROWN: Record<string, string> = {
  tree: 'round', conifer: 'pyramidal', palm: 'fan', shrub: 'round', perennial: 'upright', grass: 'fountain', groundcover: 'mound', vine: 'upright', succulent: 'rosette'
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- plants

type Part = keyof PlantModel;

export function buildDetailedPlants(p: Project, cat: Catalog): THREE.Group {
  const group = new THREE.Group();
  group.name = 'render-plants';
  const month = p.scenario.month, year = p.scenario.year;
  type Item = { m: THREE.Matrix4; c: THREE.Color };
  const buckets = new Map<string, { model: PlantModel; part: Part; items: Item[] }>();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (const inst of p.plants) {
    if (inst.status === 'remove') continue;
    const plant = cat.plant(inst.plantId);
    const size = sizeAt(inst, plant, year);
    // Same draw order as scene/build.ts buildPlants, so position, rotation and size match the editor.
    const r = rng((inst.seed ?? 1) >>> 0);
    const rot = r() * Math.PI * 2;
    const jit = 0.92 + r() * 0.16;
    const look = plant ? seasonLook(plant, month, p.site.frost) : null;
    let form: string, crown: string;
    if (plant) {
      form = plant.form;
      crown = plant.representation?.crown ?? DEFAULT_CROWN[plant.form] ?? 'round';
    } else {
      const c = inst.fallback?.category ?? '';
      form = c.startsWith('tree') ? 'tree' : 'shrub';
      crown = c.includes('pine') || c.includes('cone') ? 'pyramidal' : form === 'tree' ? 'round' : 'mound';
    }
    let h = Math.max(0.05, size.height * jit);
    let w = Math.max(0.05, size.spread * jit);
    if (look?.dormant) { h *= 0.35; w *= 0.8; }
    const arch = archetypeFor(form, crown);
    const variant = ((inst.seed ?? 1) >>> 3) % VARIANTS;
    const aspect = aspectClass(h, w);
    const model = plantModel(arch, variant, aspect);
    q.setFromAxisAngle(up, rot);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(inst.x, 0, inst.y), q, new THREE.Vector3(w, h, w));

    const foliage = new THREE.Color(look ? look.foliage : '#6f7f62');
    const herbaceous = form === 'perennial' || form === 'grass' || form === 'groundcover' || form === 'vine' || form === 'succulent';
    const wood = herbaceous ? foliage.clone().multiplyScalar(0.75) : new THREE.Color(form === 'palm' ? '#8b7656' : '#5e4a3a');
    const add = (part: Part, c: THREE.Color) => {
      if (!model[part]) return;
      const key = `${arch}#${variant}@${aspect}:${part}`;
      const b = buckets.get(key) ?? buckets.set(key, { model, part, items: [] }).get(key)!;
      b.items.push({ m, c });
    };
    add('wood', wood);
    if (!look?.leafOff) {
      add('leaves', foliage);
      add('solid', foliage);
      if (look?.bloom) add('flowers', new THREE.Color(look.bloom));
    }
  }

  const atlas = leafAtlas();
  const mats: Record<Part, THREE.Material> = {
    wood: new THREE.MeshStandardMaterial({ map: barkTexture(), vertexColors: true, roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 }),
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 }),
    flowers: new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.6 })
  };
  for (const { model, part, items } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(model[part]!, mats[part], items.length);
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- ground

function inPolygon(poly: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SURFACE: Partial<Record<Area['kind'], 'grass' | 'mulch' | 'soil' | 'gravel'>> = {
  lawn: 'grass', bed: 'mulch', mulch: 'mulch', gravel: 'gravel', path: 'gravel', patio: 'soil', driveway: 'soil'
};

/** The editor's area meshes, with tileable 1 m textures (area UVs are in metres). */
function texturedArea(a: Area, cat: Catalog): THREE.Object3D | null {
  const o = buildArea(a, cat);
  if (!o) return null;
  const kind = SURFACE[a.kind];
  if (kind) o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'color' in m && !m.transparent) {
      m.map = surfaceTexture(kind, `#${m.color.getHexString()}`);
      m.color.set('#ffffff');
      m.needsUpdate = true;
    }
  });
  return o;
}

/** Instanced grass tufts on every lawn, coloured from the lawn material. */
function lawnGrass(p: Project, cat: Catalog): THREE.Object3D | null {
  const lawns = p.areas.filter((a) => a.kind === 'lawn' && a.polygon.length >= 3);
  if (!lawns.length) return null;
  const blades: number[] = [], col: number[] = [];
  const r0 = rng(99);
  for (let b = 0; b < 9; b++) {
    const a = (b / 9) * Math.PI * 2 + r0(), lean = 0.012 + r0() * 0.02, h = 0.05 + r0() * 0.05, w = 0.004;
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz * w, sz = dx * w;
    const ox = dx * 0.012, oz = dz * 0.012;
    blades.push(ox - sx, 0, oz - sz, ox + sx, 0, oz + sz, ox + dx * lean, h, oz + dz * lean);
    col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.05, 1.05, 1.05);
  }
  const tuft = new THREE.BufferGeometry();
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  tuft.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tuft.computeVertexNormals();
  const DENSITY = 140, CAP = 160_000;
  const area = lawns.reduce((s, l) => s + Math.abs(polyArea(l.polygon)), 0);
  const per = Math.min(DENSITY, CAP / Math.max(1, area));
  const mats: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const l of lawns) {
    const base = new THREE.Color(cat.material(l.materialId)?.color ?? '#7fae5a');
    const r = rng(hashStr(l.id));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of l.polygon) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const n = Math.round(Math.abs(polyArea(l.polygon)) * per);
    let tries = 0;
    for (let k = 0; k < n && tries < n * 4; tries++) {
      const x = minX + r() * (maxX - minX), y = minY + r() * (maxY - minY);
      if (!inPolygon(l.polygon, x, y)) continue;
      const s = 0.8 + r() * 0.5;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (l.elevation ?? 0) + 0.004, y), q, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s)));
      colors.push(base.clone().multiplyScalar(0.8 + r() * 0.35));
      k++;
    }
  }
  const mesh = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), mats.length);
  mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, colors[i]); });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}

function polyArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return s / 2;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- scene + render

export async function renderView(p: Project, cat: Catalog, viewCamera: THREE.PerspectiveCamera, opts: RenderOptions): Promise<RenderResult> {
  const progress = opts.onProgress ?? (() => {});
  const W = Math.round(opts.width), H = Math.round(opts.width / opts.aspect);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const maxRb = renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE) as number;
  if (W > maxRb || H > maxRb) {
    renderer.dispose();
    throw new Error(`This device can render up to ${maxRb} px wide. Choose a smaller size.`);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoftShadowMap was removed; shadow.radius softens PCF
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const scene = new THREE.Scene();
  const disposables: THREE.Object3D[] = [];
  try {
    progress('Building the garden');
    await nextFrame();
    const b = siteBounds(p);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[1] + b.max[1]) / 2;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 6);

    const groundRadius = Math.max(200, size * 4);
    const ground = buildGround(groundRadius);
    const groundMat = ground.material as THREE.MeshStandardMaterial;
    // Circle UVs span 0…1 across the diameter: repeat so one tile is about a metre.
    const meadow = surfaceTexture('meadow', '#9aa877').clone();
    meadow.repeat.set(groundRadius * 2, groundRadius * 2);
    meadow.needsUpdate = true;
    groundMat.map = meadow;
    groundMat.color.set('#ffffff');
    const site = new THREE.Group();
    site.add(ground);
    for (const a of p.areas) { const o = texturedArea(a, cat); if (o) site.add(o); }
    for (const l of p.lines) site.add(buildLine(l, cat));
    for (const o of p.objects) site.add(buildSiteObject(o, false));
    site.add(buildBuilding(p.building));
    const grass = lawnGrass(p, cat);
    if (grass) site.add(grass);
    scene.add(site);
    disposables.push(site);

    progress('Growing the plants');
    await nextFrame();
    const plants = buildDetailedPlants(p, cat);
    scene.add(plants);
    disposables.push(plants);

    progress('Lighting the scene');
    await nextFrame();
    const lat = p.site.location?.lat ?? regionCenter(p.site.regionId, cat)[0];
    let dir = sunDirection(lat, p.scenario.month, p.scenario.hour, p.site.north ?? [0, -1]);
    let daylightSubstituted = false;
    if (dir[1] < Math.sin((8 * Math.PI) / 180)) {
      dir = sunDirection(lat, p.scenario.month, 10, p.site.north ?? [0, -1]);
      daylightSubstituted = true;
    }
    const sunVec = new THREE.Vector3(dir[0], Math.max(0.14, dir[1]), dir[2]).normalize();

    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunVec);
    scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(4000);
    for (const k of Object.keys(u)) (skyCopy.material.uniforms as Record<string, { value: unknown }>)[k].value = (u as Record<string, { value: unknown }>)[k].value;
    skyScene.add(skyCopy);
    const env = pmrem.fromScene(skyScene, 0.02).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.22;

    const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
    const reach = size * 0.75 + 6;
    sun.position.set(cx + sunVec.x * reach * 2, sunVec.y * reach * 2, cz + sunVec.z * reach * 2);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const maxTex = renderer.capabilities.maxTextureSize;
    sun.shadow.mapSize.set(Math.min(8192, maxTex), Math.min(8192, maxTex));
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    const sc = sun.shadow.camera;
    sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach; sc.near = 0.5; sc.far = reach * 6;
    sc.updateProjectionMatrix();
    scene.add(sun, sun.target);

    const camera = new THREE.PerspectiveCamera(viewCamera.fov, W / H, viewCamera.near, Math.max(viewCamera.far, 5000));
    camera.position.copy(viewCamera.position);
    camera.quaternion.copy(viewCamera.quaternion);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    progress('Rendering');
    await nextFrame();
    const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, W, H);
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    composer.render();

    progress('Saving');
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), 'image/png'));
    composer.dispose();
    target.dispose();
    env.dispose();
    pmrem.dispose();
    return { blob, width: W, height: H, daylightSubstituted };
  } finally {
    for (const g of disposables) disposeGroup(g);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
