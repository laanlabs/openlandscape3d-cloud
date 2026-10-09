// Local-first project library in IndexedDB. Nothing leaves the browser unless the user exports or shares.
import { createStore, del, entries, get, set } from 'idb-keyval';
import type { Project } from '../model/types';
import { normalizeProject } from './openplan';

const store = createStore('openlandscape3d', 'projects');

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  plants: number;
  areas: number;
  regionId: string;
  /** Set when the project is a copy of a sample garden (`web.sampleId`). */
  sampleId?: string;
  createdAt?: string;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));

/**
 * Library rows from raw stored records, newest first. Tolerant of damaged records (anything stored
 * before import validation existed): non-objects are skipped and no field is assumed to have its type.
 */
export function summarizeProjects(records: [IDBValidKey, unknown][]): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const [key, p] of records) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const r = p as Record<string, any>;
    const web = r.web && typeof r.web === 'object' ? r.web : {};
    out.push({
      // The store key is what load/delete use, so it wins over a damaged `id`.
      id: typeof key === 'string' ? key : str(r.id),
      name: str(r.name, 'Untitled site'),
      updatedAt: String(r?.updatedAt ?? ''),
      plants: Array.isArray(r.plants) ? r.plants.length : 0,
      areas: Array.isArray(r.areas) ? r.areas.length : 0,
      regionId: typeof r.site?.regionId === 'string' ? r.site.regionId : '',
      ...(typeof web.sampleId === 'string' ? { sampleId: web.sampleId } : {}),
      ...(r.createdAt != null ? { createdAt: String(r.createdAt) } : {})
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return summarizeProjects(await entries<IDBValidKey, unknown>(store));
}

/** Library copies of a sample garden (projects whose `web.sampleId` matches), newest first. */
export async function findSampleCopies(sampleId: string): Promise<ProjectSummary[]> {
  return (await listProjects()).filter((s) => s.sampleId === sampleId);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(id, store);
  return p && typeof p === 'object' ? normalizeProject(p) : undefined;
}
export const saveProject = (p: Project) => set(p.id, JSON.parse(JSON.stringify(p)), store);
export const deleteProject = (id: string) => del(id, store);
