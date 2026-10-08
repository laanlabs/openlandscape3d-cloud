// Procedural textures for the hi-res render, drawn on canvases at runtime (no image assets).
// Leaf and flower textures are white/grey with alpha so instance colours (foliage, bloom) tint them.
import * as THREE from 'three';
import { rng } from '../analysis/groups';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

let atlas: THREE.CanvasTexture | null = null;

/** 2×2 atlas: broadleaf cluster (top-left), needle twig (top-right), palm frond (bottom-left), flower cluster (bottom-right). */
export function leafAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const S = 1024, H = S / 2;
  const [c, g] = canvas(S);
  const r = rng(424242);
  const grey = (k: number, a = 1) => `rgba(${Math.round(255 * k)},${Math.round(255 * k)},${Math.round(255 * k)},${a})`;

  // Broadleaf cluster: a twig with ~34 elliptical leaves.
  g.save();
  g.beginPath(); g.rect(0, 0, H, H); g.clip();
  g.strokeStyle = grey(0.35); g.lineWidth = 5;
  g.beginPath(); g.moveTo(H * 0.5, H * 0.98); g.quadraticCurveTo(H * 0.45, H * 0.5, H * 0.5, H * 0.12); g.stroke();
  for (let i = 0; i < 44; i++) {
    const t = 0.1 + r() * 0.85;
    const x = H * (0.5 + (r() - 0.5) * 0.7 * (1 - Math.abs(t - 0.5)));
    const y = H * (1 - t);
    g.save();
    g.translate(x, y);
    g.rotate((r() - 0.5) * 2.6);
    const l = H * (0.17 + r() * 0.08), w = l * (0.5 + r() * 0.15);
    g.fillStyle = grey(0.62 + r() * 0.38);
    g.beginPath(); g.ellipse(0, -l / 2, w / 2, l / 2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = grey(0.45, 0.6); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -l * 0.95); g.stroke();
    g.restore();
  }
  g.restore();

  // Needle twig: dense thin needles along a central twig.
  g.save();
  g.translate(H, 0);
  g.beginPath(); g.rect(0, 0, H, H); g.clip();
  g.strokeStyle = grey(0.35); g.lineWidth = 5;
  g.beginPath(); g.moveTo(H * 0.08, H * 0.92); g.lineTo(H * 0.92, H * 0.12); g.stroke();
  for (let i = 0; i < 420; i++) {
    const t = r();
    const x = H * (0.08 + 0.84 * t), y = H * (0.92 - 0.8 * t);
    const a = -Math.PI / 4 + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.7);
    const l = H * (0.08 + r() * 0.07) * (1 - 0.4 * t);
    g.strokeStyle = grey(0.55 + r() * 0.45); g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.restore();

  // Palm frond: a rib with paired leaflets, along V (u across the strip).
  g.save();
  g.translate(0, H);
  g.beginPath(); g.rect(0, 0, H, H); g.clip();
  g.fillStyle = grey(0.5); g.fillRect(H * 0.48, 0, H * 0.04, H);
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * H;
    for (const s of [-1, 1]) {
      g.save();
      g.translate(H * 0.5, y);
      g.rotate(s * (0.55 + r() * 0.15));
      g.fillStyle = grey(0.6 + r() * 0.4);
      g.beginPath(); g.ellipse(s * H * 0.24, 0, H * 0.24, H * 0.018, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  g.restore();

  // Flower cluster: 7 five-petal flowers with darker centres.
  g.save();
  g.translate(H, H);
  g.beginPath(); g.rect(0, 0, H, H); g.clip();
  for (let i = 0; i < 7; i++) {
    const cx = H * (0.25 + r() * 0.5), cy = H * (0.25 + r() * 0.5), pr = H * (0.1 + r() * 0.06);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + r();
      g.fillStyle = grey(0.88 + r() * 0.12);
      g.beginPath(); g.ellipse(cx + Math.cos(a) * pr * 0.55, cy + Math.sin(a) * pr * 0.55, pr * 0.55, pr * 0.32, a, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = grey(0.55);
    g.beginPath(); g.arc(cx, cy, pr * 0.22, 0, Math.PI * 2); g.fill();
  }
  g.restore();

  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}

const surfaces = new Map<string, THREE.CanvasTexture>();

/** Tileable 1 m surface texture (UVs of area meshes are in metres). */
export function surfaceTexture(kind: 'grass' | 'mulch' | 'soil' | 'gravel' | 'meadow', base: string): THREE.CanvasTexture {
  const key = `${kind}:${base}`;
  const hit = surfaces.get(key);
  if (hit) return hit;
  const S = 512;
  const [c, g] = canvas(S);
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, S, S);
  const r = rng(kind.length * 9973 + Math.round(col.r * 255));
  const dot = (x: number, y: number, rad: number, k: number, a: number) => {
    const cc = col.clone().multiplyScalar(k);
    g.fillStyle = `rgba(${Math.round(Math.min(1, cc.r) * 255)},${Math.round(Math.min(1, cc.g) * 255)},${Math.round(Math.min(1, cc.b) * 255)},${a})`;
    // Draw wrapped so the tile is seamless.
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, Math.PI * 2); g.fill(); }
  };
  const n = kind === 'gravel' ? 2600 : kind === 'mulch' ? 1800 : 5000;
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S;
    if (kind === 'grass' || kind === 'meadow') dot(x, y, 1.5 + r() * 2.5, 0.75 + r() * 0.5, 0.5);
    else if (kind === 'gravel') dot(x, y, 2 + r() * 5, 0.7 + r() * 0.6, 0.9);
    else if (kind === 'mulch') {
      const cc = col.clone().multiplyScalar(0.65 + r() * 0.7);
      g.strokeStyle = `rgb(${Math.round(Math.min(1, cc.r) * 255)},${Math.round(Math.min(1, cc.g) * 255)},${Math.round(Math.min(1, cc.b) * 255)})`;
      g.lineWidth = 2 + r() * 4;
      const a = r() * Math.PI, l = 8 + r() * 16;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    } else dot(x, y, 1 + r() * 2, 0.8 + r() * 0.4, 0.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  surfaces.set(key, t);
  return t;
}

/** Bark: vertical streaks, tileable. */
let bark: THREE.CanvasTexture | null = null;
export function barkTexture(): THREE.CanvasTexture {
  if (bark) return bark;
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const r = rng(777);
  for (let i = 0; i < 140; i++) {
    const x = r() * S, k = Math.round(150 + r() * 90);
    g.strokeStyle = `rgb(${k},${k},${k})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 20, S / 3, x + (r() - 0.5) * 20, (2 * S) / 3, x, S); g.stroke();
  }
  bark = new THREE.CanvasTexture(c);
  bark.colorSpace = THREE.SRGBColorSpace;
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
  return bark;
}
