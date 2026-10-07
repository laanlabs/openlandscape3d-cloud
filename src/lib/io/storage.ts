// Local-first project library in IndexedDB. Nothing leaves the browser unless the user exports or shares.
import { createStore, del, entries, get, set } from 'idb-keyval';
import type { Project } from '../model/types';
import { normalizeProject } from './openplan';

const store = createStore('openlandscape3d', 'projects');

export interface ProjectSummary { id: string; name: string; updatedAt: string; plants: number; areas: number; regionId: string }

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = (await entries<string, Project>(store)).map(([, p]) => p);
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, plants: p.plants?.length ?? 0, areas: p.areas?.length ?? 0, regionId: p.site?.regionId ?? '' }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(id, store);
  return p ? normalizeProject(p) : undefined;
}
export const saveProject = (p: Project) => set(p.id, JSON.parse(JSON.stringify(p)), store);
export const deleteProject = (id: string) => del(id, store);
