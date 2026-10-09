// CSV exports with the exact column sets from EXPORT_FORMAT.md. RFC 4180 quoting, CRLF line ends
// and a UTF-8 BOM so spreadsheets open them with the right encoding.
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import { plantSchedule, taskSchedule } from '../analysis/schedule';

export const PLANT_COLUMNS = ['code', 'scientific_name', 'common_name', 'quantity', 'install_size', 'spacing_m', 'mature_height_m', 'mature_spread_m', 'native', 'notes'] as const;
export const TASK_COLUMNS = ['task', 'plant', 'scientific_name', 'quantity', 'start', 'end', 'recurrence', 'source', 'confidence'] as const;

/**
 * One CSV field. Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would be read
 * as a formula by spreadsheets, so it gets a leading apostrophe (the spreadsheet convention for
 * "this is text"). Numbers and booleans are formatted first and never prefixed, so a negative
 * number stays a number.
 */
export function cell(v: string | number | boolean): string {
  let s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: (string | number | boolean)[][]) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function plantScheduleCsv(p: Project, cat: Catalog): string {
  const rows = plantSchedule(p, cat);
  return csv([[...PLANT_COLUMNS], ...rows.map((r) => PLANT_COLUMNS.map((c) => r[c]))]);
}

export function taskScheduleCsv(p: Project, cat: Catalog): string {
  const rows = taskSchedule(p, cat);
  return csv([[...TASK_COLUMNS], ...rows.map((r) => TASK_COLUMNS.map((c) => r[c]))]);
}
