import type { Zone } from "./painting-pack";

export function findZone(
  zones: Zone[],
  x: number,
  y: number
): Zone | null {
  for (const z of zones) {
    const dx = x - z.x;
    const dy = y - z.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= z.r) return z;
  }
  return null;
}
