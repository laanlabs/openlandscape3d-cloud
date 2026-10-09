// Field observations (notes, photos, issues, measurements, existing-plant inventory). The contract
// (openlandscape3d-ios/docs/EXPORT_FORMAT.md, `observations`) makes them append-only and merged by id:
// a copy that comes back never removes one, *resolve* replaces *delete*, and a resolved copy wins.
import type { Observation } from './types';

export type ObservationKind = Observation['kind'];

export const OBSERVATION_LABEL: Record<ObservationKind, string> = {
  note: 'Note', photo: 'Photo', issue: 'Issue', measurement: 'Measurement', inventory: 'Existing plant'
};
/** Literal colours (the plan exports to PNG, so no CSS variables). */
export const OBSERVATION_COLOR: Record<ObservationKind, string> = {
  note: '#3b6fb6', photo: '#6a4fb3', issue: '#b4382f', measurement: '#b07a12', inventory: '#2f6b4f'
};
export const RESOLVED_COLOR = '#9aa09a';

export const kindLabel = (o: Pick<Observation, 'kind'>) => OBSERVATION_LABEL[o.kind] ?? String(o.kind ?? 'Note');
export const kindColor = (o: Pick<Observation, 'kind' | 'resolved'>) => (o.resolved ? RESOLVED_COLOR : OBSERVATION_COLOR[o.kind] ?? OBSERVATION_COLOR.note);
export const hasPosition = (o: Observation): o is Observation & { x: number; y: number } => Number.isFinite(o.x) && Number.isFinite(o.y);

/** Notes written in this planner. Field observations from other producers are append-only facts. */
export const WEB_AUTHOR = 'web';
export const isWebNote = (o: Observation) => o.author === WEB_AUTHOR;

/** Date order, as iOS stores them: createdAt, then id. */
export function sortObservations(list: readonly Observation[]): Observation[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 1-based numbers in date order; `openOnly` numbers only unresolved observations (the print sheet). */
export function observationNumbers(list: readonly Observation[], openOnly = false): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of sortObservations(list)) if (!openOnly || !o.resolved) m.set(o.id, m.size + 1);
  return m;
}

/**
 * Contract merge (same as iOS `ObservationMerge.merge`): union by id; for an id both sides have, the
 * local copy stays unless the incoming copy is resolved and the local one is not. Never removes and
 * never un-resolves. Result in date order.
 */
export function mergeObservations(local: readonly Observation[], incoming: readonly Observation[]): Observation[] {
  const byId = new Map<string, Observation>();
  for (const o of local) byId.set(o.id, o);
  for (const o of incoming) {
    const have = byId.get(o.id);
    if (!have || (o.resolved === true && have.resolved !== true)) byId.set(o.id, o);
  }
  return sortObservations([...byId.values()]);
}
