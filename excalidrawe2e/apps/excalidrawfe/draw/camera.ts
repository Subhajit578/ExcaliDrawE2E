import type { Point } from "./renderer";

/**
 * Where the board is being looked at from.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  Stored is world. Touched is screen. Converted at the edges.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every shape, every hit test, every message on the wire and every row in
 * the database is in *world* coordinates and knows nothing about the camera.
 * Only two kinds of thing are in *screen* coordinates: a DOM event arriving,
 * and a DOM element being positioned. Those are the edges, and they are the
 * only places a conversion belongs.
 *
 * The conversion, in one direction, is the definition everything else follows
 * from:
 *
 *     screen = (world + scroll) * zoom
 *     world  = screen / zoom - scroll
 *
 * They are exact inverses, and keeping them so is the whole contract of this
 * file. Getting them subtly out of step is the classic way this feature goes
 * wrong, because at zoom 1 with no scroll the camera is the identity and
 * everything still looks correct.
 *
 * That identity is also why no migration is needed: coordinates saved before
 * this file existed are already world coordinates.
 */
export type Camera = {
  /** world units added before scaling; panning moves this, not the shapes */
  scrollX: number;
  scrollY: number;
  /** screen pixels per world unit. 1 is "actual size" */
  zoom: number;
};

/** The view a board opens at, and what "reset view" goes back to. */
export const IDENTITY_CAMERA: Camera = { scrollX: 0, scrollY: 0, zoom: 1 };

/**
 * How far in and out the camera may go.
 *
 * Not taste - safety. A trackpad flick can multiply zoom many times in a few
 * frames, and without a floor the board reaches 1e-7, where every shape is
 * sub-pixel and there is no visual cue for how to get back.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;

export function clampZoom(zoom: number): number {
  // NaN defends against a wheel event with odd deltas: NaN would propagate
  // into every coordinate and the board would vanish with nothing to blame
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** A world point, as it appears on screen. */
export function toScreen(point: Point, camera: Camera): Point {
  return {
    x: (point.x + camera.scrollX) * camera.zoom,
    y: (point.y + camera.scrollY) * camera.zoom,
  };
}

/** A point on screen, as a place on the board. */
export function toWorld(point: Point, camera: Camera): Point {
  return {
    x: point.x / camera.zoom - camera.scrollX,
    y: point.y / camera.zoom - camera.scrollY,
  };
}

/**
 * A length on screen, in world units.
 *
 * For the handful of constants that are only meaningful in screen pixels -
 * how near a click counts as a hit, how big a grip is - once the comparison
 * itself happens in world space. A 12px grip has to stay 12px whether the
 * board is at 20% or 500%, which means its world size changes with the zoom.
 */
export function screenLengthToWorld(pixels: number, camera: Camera): number {
  return pixels / camera.zoom;
}

/**
 * Change the zoom while keeping one point on screen exactly where it is.
 *
 * The point under the cursor should not move when you zoom - that is what
 * makes zooming feel like leaning in rather than being shoved. Which means
 * finding the scroll that satisfies
 *
 *     toWorld(anchor, before) === toWorld(anchor, after)
 *
 * Expanding both sides of that and solving for the new scroll:
 *
 *     anchor/z₀ - s₀ = anchor/z₁ - s₁
 *     s₁ = s₀ + anchor/z₁ - anchor/z₀
 *
 * which is all the function does, once per axis.
 */
export function zoomAt(camera: Camera, screenAnchor: Point, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom);
  // clamping can make this a no-op at the limits; bail so repeated scrolling
  // at full zoom cannot accumulate rounding error into the scroll
  if (zoom === camera.zoom) return camera;

  return {
    zoom,
    scrollX: camera.scrollX + screenAnchor.x / zoom - screenAnchor.x / camera.zoom,
    scrollY: camera.scrollY + screenAnchor.y / zoom - screenAnchor.y / camera.zoom,
  };
}
