// Display units. Everything is stored in metres; imperial is a presentation choice.
export type Units = 'metric' | 'imperial';

const FT = 0.3048;

export function fmtLen(m: number, units: Units, short = false): string {
  if (!Number.isFinite(m)) return '—';
  if (units === 'imperial') {
    const totalIn = Math.round(m / 0.0254);
    const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
    if (short && ft >= 10) return `${Math.round(m / FT)}′`;
    return inch ? (ft ? `${ft}′ ${inch}″` : `${inch}″`) : `${ft}′`;
  }
  if (m < 1 && !short) return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')} m`;
}

export function fmtArea(m2: number, units: Units): string {
  if (units === 'imperial') return `${Math.round(m2 / (FT * FT)).toLocaleString()} ft²`;
  return `${m2 >= 100 ? Math.round(m2).toLocaleString() : m2.toFixed(1)} m²`;
}

/** Parses "12", "12.5m", "40cm", "30'", "30' 6\"", "30ft", "6in". Bare numbers use the display units (m or ft). */
export function parseLen(s: string, units: Units): number | null {
  const t = s.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;
  const fi = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in)?)?$/);
  if (fi) return Number(fi[1]) * FT + (fi[2] ? Number(fi[2]) * 0.0254 : 0);
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|″)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case 'mm': return v / 1000;
    case 'cm': return v / 100;
    case 'm': return v;
    case 'in': case '"': case '″': return v * 0.0254;
    default: return units === 'imperial' ? v * FT : v;
  }
}

/** Grid / snap step in metres for the display units. */
export const gridStep = (units: Units) => (units === 'imperial' ? FT : 0.5);

export function money(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
