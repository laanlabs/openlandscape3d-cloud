// Simple solar position for the sun/shade preview: the 15th of the scenario month, local solar time.
// Accurate to a degree or two — plenty for "where will the patio be shaded at 4 pm in July".
import type { Vec2 } from '../model/types';

const DAY_OF_YEAR_15TH = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

export interface SunPosition { altitude: number; azimuth: number } // radians; azimuth clockwise from north

export function solarPosition(latDeg: number, month: number, hour: number): SunPosition {
  const n = DAY_OF_YEAR_15TH[(Math.round(month) - 1 + 12) % 12];
  const decl = ((23.44 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (284 + n));
  const lat = (latDeg * Math.PI) / 180;
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { altitude, azimuth: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/**
 * Unit vector from the ground towards the sun in world coordinates (X = plan x, Y up, Z = plan y).
 * `north` is the plan-space unit vector to true north; east is north rotated a quarter turn clockwise on screen.
 */
export function sunDirection(latDeg: number, month: number, hour: number, north: Vec2): [number, number, number] {
  const { altitude, azimuth } = solarPosition(latDeg, month, hour);
  const nl = Math.hypot(north[0], north[1]) || 1;
  const N: Vec2 = [north[0] / nl, north[1] / nl];
  const E: Vec2 = [-N[1], N[0]];
  const h = Math.cos(altitude);
  const px = (N[0] * Math.cos(azimuth) + E[0] * Math.sin(azimuth)) * h;
  const py = (N[1] * Math.cos(azimuth) + E[1] * Math.sin(azimuth)) * h;
  return [px, Math.sin(altitude), py];
}

/** Sunrise/sunset hours (local solar time) for the month at a latitude. */
export function dayLength(latDeg: number, month: number): { rise: number; set: number } {
  const n = DAY_OF_YEAR_15TH[(Math.round(month) - 1 + 12) % 12];
  const decl = ((23.44 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (284 + n));
  const lat = (latDeg * Math.PI) / 180;
  const c = -Math.tan(lat) * Math.tan(decl);
  const H = Math.acos(Math.max(-1, Math.min(1, c))) * (180 / Math.PI) / 15;
  return { rise: 12 - H, set: 12 + H };
}
