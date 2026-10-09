// Display units. Everything is stored in metres; imperial is a presentation choice.
export type Units = 'metric' | 'imperial';

const FT = 0.3048;

/** Prefix a minus sign (U+2212) unless the formatted magnitude rounded to zero. */
const signed = (m: number, body: string) => (m < 0 && /[1-9]/.test(body) ? `−${body}` : body);

export function fmtLen(m: number, units: Units, short = false): string {
  if (!Number.isFinite(m)) return '—';
  const a = Math.abs(m);
  if (units === 'imperial') {
    const totalIn = Math.round(a / 0.0254);
    const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
    if (short && ft >= 10) return signed(m, `${Math.round(a / FT)}′`);
    return signed(m, inch ? (ft ? `${ft}′ ${inch}″` : `${inch}″`) : `${ft}′`);
  }
  if (a < 1 && !short) return signed(m, `${Math.round(a * 100)} cm`);
  return signed(m, `${a.toFixed(a >= 10 ? 1 : 2).replace(/\.?0+$/, '')} m`);
}

export function fmtArea(m2: number, units: Units): string {
  if (units === 'imperial') return `${Math.round(m2 / (FT * FT)).toLocaleString()} ft²`;
  return `${m2 >= 100 ? Math.round(m2).toLocaleString() : m2.toFixed(1)} m²`;
}

/** Unsigned decimal: "12", "12.5" or ".5". */
const NUM = String.raw`(\d*\.?\d+)`;
const FEET_INCHES = new RegExp(String.raw`^${NUM}\s*(?:'|′|ft|feet)\s*(?:${NUM}\s*(?:"|″|in)?)?$`);
const SIMPLE = new RegExp(String.raw`^${NUM}\s*(mm|cm|m|in|"|″)?$`);

/**
 * Parses "12", "12.5m", "40cm", "30'", "30' 6\"", "30ft", "6in", ".5" and a leading "-" or "−".
 * Bare numbers use the display units (m or ft). A comma is a thousands separator when the text
 * also has a point or when exactly three digits follow it ("1,000"); otherwise a decimal point ("1,5").
 */
export function parseLen(s: string, units: Units): number | null {
  let t = s.trim().toLowerCase();
  const neg = t.startsWith('-') || t.startsWith('−');
  if (neg) t = t.slice(1).trim();
  if (!t) return null;
  t = t.includes('.') || /,\d{3}(?!\d)/.test(t) ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  const sign = neg ? -1 : 1;
  const fi = t.match(FEET_INCHES);
  if (fi) return sign * (Number(fi[1]) * FT + (fi[2] ? Number(fi[2]) * 0.0254 : 0));
  const m = t.match(SIMPLE);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case 'mm': return sign * (v / 1000);
    case 'cm': return sign * (v / 100);
    case 'm': return sign * v;
    case 'in': case '"': case '″': return sign * (v * 0.0254);
    default: return sign * (units === 'imperial' ? v * FT : v);
  }
}

/** Grid / snap step in metres for the display units. */
export const gridStep = (units: Units) => (units === 'imperial' ? FT : 0.5);

export function money(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
