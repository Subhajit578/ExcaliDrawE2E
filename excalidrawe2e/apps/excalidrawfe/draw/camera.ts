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
 * Partly safety: a trackpad flick can multiply zoom many times in a few
 * frames, and without a floor the board reaches 1e-7, where every shape is
 * sub-pixel and there is no visual cue for how to get back.
 *
 * The floor is 15% rather than 10% because 10% was further out than anything
 * useful - shapes become specks and strokes thin to nothing well before it.
 * The cost is that zoom-to-fit can no longer frame a board that would need
 * less than 15%; it gets as close as the floor allows and leaves the rest
 * off screen.
 */
export const MIN_ZOOM = 0.10;
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
 * The camera that shows `bounds` centred and filling the viewport.
 *
 * Fit the smaller of the two ratios, so the whole box is visible on both
 * axes rather than cropped on one - fitting the larger would guarantee the
 * content overflows the side it was not measured against.
 *
 * The padding is subtracted from the viewport before the ratio is taken, so
 * it is a true screen margin: a gap that stays the same thickness however
 * far the content ends up being scaled.
 *
 * Returns null when there is nothing to fit, which the caller should treat
 * as "leave the camera alone" - jumping to the origin because the board is
 * empty is a worse answer than doing nothing.
 */
export function cameraFitting(
  bounds: { left: number; top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  padding = 60
): Camera | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  // A single dot, a perfectly vertical line, one character of text: real
  // content with zero extent on an axis. Dividing by that gives Infinity, so
  // the extent is floored - the shape is then centred at a sane zoom rather
  // than the camera flying to the clamp.
  const width = Math.max(bounds.right - bounds.left, 1);
  const height = Math.max(bounds.bottom - bounds.top, 1);

  // never let padding eat the whole viewport on a small window
  const usableW = Math.max(viewport.width - padding * 2, viewport.width * 0.2);
  const usableH = Math.max(viewport.height - padding * 2, viewport.height * 0.2);

  // capped at 1: filling the screen with one small rectangle is disorienting,
  // and "fit" should never mean "magnify"
  const zoom = clampZoom(Math.min(usableW / width, usableH / height, 1));

  // put the middle of the content at the middle of the viewport, which is
  // toScreen(centre) === viewportCentre solved for scroll
  const centreX = (bounds.left + bounds.right) / 2;
  const centreY = (bounds.top + bounds.bottom) / 2;
  return {
    zoom,
    scrollX: viewport.width / 2 / zoom - centreX,
    scrollY: viewport.height / 2 / zoom - centreY,
  };
}

/**
 * The camera that puts `point` in the middle of the viewport, at the zoom
 * already in use.
 *
 * Deliberately does not touch the zoom: this is for scrolling back to
 * something, and changing how far in you were working is not part of that.
 * Being returned to your work at a magnification you did not choose is
 * disorienting in a way that simply moving is not.
 */
export function cameraCentredOn(
  point: Point,
  viewport: { width: number; height: number },
  zoom: number
): Camera {
  // toScreen(point) === viewportCentre, solved for scroll
  return {
    zoom,
    scrollX: viewport.width / 2 / zoom - point.x,
    scrollY: viewport.height / 2 / zoom - point.y,
  };
}

/**
 * The part of the board currently on screen, in world coordinates.
 *
 * The inverse of the viewport rectangle - what a person can actually see,
 * expressed in the space shapes live in, so the two can be compared.
 */
export function visibleWorldBounds(
  viewport: { width: number; height: number },
  camera: Camera
): { left: number; top: number; right: number; bottom: number } {
  const topLeft = toWorld({ x: 0, y: 0 }, camera);
  const bottomRight = toWorld({ x: viewport.width, y: viewport.height }, camera);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

/**
 * The world distance between grid dots, chosen so they stay readable.
 *
 * A fixed spacing cannot work on an infinite canvas: 20 world units is a
 * comfortable grid at 100%, an unreadable moire at 15%, and a handful of
 * dots in the far corners at 500%. So the spacing steps up and down with
 * the zoom instead, always landing on a round number.
 *
 * Doubling, rather than the 1 / 2 / 5 of axis ticks, so that every spacing
 * is an exact multiple of every finer one. That nesting is what stops the
 * dots sliding around as you zoom: the grid thins out and fills back in on
 * the same positions, instead of landing somewhere new each time the step
 * changes. With 1 / 2 / 5 it would not - 50 is not a multiple of 20.
 */
const GRID_BASE = 10;

export function gridSpacing(zoom: number, targetScreenGap = 28): number {
  // what one gap on screen is worth in world units at this zoom, as a
  // number of doublings away from the base spacing
  const raw = targetScreenGap / zoom;
  const doublings = Math.ceil(Math.log2(raw / GRID_BASE));
  return GRID_BASE * 2 ** doublings;
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
