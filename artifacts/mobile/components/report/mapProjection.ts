/**
 * Web-Mercator projection for the site-plan canvas.
 *
 * Shared by the site plan itself and the AI Subdivision overlay so both draw
 * into exactly the same pixel space. If these diverged, subdivision lots would
 * land offset from the parcel they belong to — plausible-looking and wrong.
 *
 * Input is always WGS84 `[lng, lat]`, which is what both the site-plan API and
 * Rubin return, so no reprojection happens on the client.
 */

export type Coordinate = [number, number];

export type SitePlanBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

export function projectCoordinate(
  coord: Coordinate,
  bounds: SitePlanBounds,
  width: number,
  height: number,
): Coordinate {
  const [lng, lat] = coord;
  const west = mercatorX(bounds.minLng);
  const east = mercatorX(bounds.maxLng);
  const north = mercatorY(bounds.maxLat);
  const south = mercatorY(bounds.minLat);
  const x = ((mercatorX(lng) - west) / Math.max(1e-9, east - west)) * width;
  const y = ((mercatorY(lat) - north) / Math.max(1e-9, south - north)) * height;
  return [x, y];
}

export function pointsString(
  coords: Coordinate[],
  bounds: SitePlanBounds,
  width: number,
  height: number,
): string {
  return coords
    .map((coord) => projectCoordinate(coord, bounds, width, height))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

/**
 * Area-weighted centroid of a projected ring, used to place a lot's label.
 * Falls back to the bounding-box centre for degenerate rings (zero area), where
 * the shoelace formula divides by zero.
 */
export function ringCentroid(points: Coordinate[]): Coordinate | null {
  if (points.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [x0, y0] = points[j]!;
    const [x1, y1] = points[i]!;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const xs = points.map(([px]) => px);
    const ys = points.map(([, py]) => py);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  const factor = 1 / (3 * twiceArea);
  return [x * factor, y * factor];
}
