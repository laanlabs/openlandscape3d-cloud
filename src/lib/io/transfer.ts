// Transfer and share links between OpenLandscape3D web and iOS, with no server in between.
//
//   iOS → web:  https://app.openlandscape3d.com/#/import/v1/<payload>
//   web → iOS:  openlandscape3d://import/v1/<payload>
//   share:      https://app.openlandscape3d.com/#/view/v1/<payload>   (read-only view)
//
// <payload> = base64url (no padding) of raw DEFLATE (RFC 1951) of the compact OpenPlan3D JSON.
// Raw DEFLATE is Apple's COMPRESSION_ZLIB and the browser's 'deflate-raw'. Links never carry
// `webProject`, photo contents, a precise location or observation coordinates (EXPORT_FORMAT.md).
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import { toOpenPlan } from './openplan';

export const TRANSFER_VERSION = 'v1';
export const WEB_ORIGIN = 'https://app.openlandscape3d.com';
export const IOS_SCHEME = 'openlandscape3d';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodePayload(json: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodePayload(payload: string): Promise<unknown> {
  const bytes = await pipe(fromBase64Url(decodeURIComponent(payload.trim())), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** OpenPlan3D JSON for links: privacy-stripped, no embedded web project. */
export const transferJson = (p: Project, cat: Catalog) => toOpenPlan(p, cat, { forLink: true });

export async function webImportUrl(p: Project, cat: Catalog, origin = WEB_ORIGIN): Promise<string> {
  return `${origin}/#/import/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}

export async function iosImportUrl(p: Project, cat: Catalog): Promise<string> {
  return `${IOS_SCHEME}://import/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}

export async function shareUrl(p: Project, cat: Catalog, origin = typeof location !== 'undefined' ? location.origin : WEB_ORIGIN): Promise<string> {
  return `${origin}/#/view/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}
