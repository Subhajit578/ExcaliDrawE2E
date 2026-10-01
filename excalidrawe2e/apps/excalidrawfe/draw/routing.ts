import type { Point } from "./renderer";

/**
 * A drag shorter than this on either axis counts as straight: an elbow there
 * would leave a stub of a few pixels, which reads as a rendering glitch rather
 * than a deliberate corner.
 */
const STRAIGHT_THRESHOLD = 8;

export function circleFromDrag(
  from: Point,
  to: Point
): { centerX: number; centerY: number; radius: number } {
  const width = to.x - from.x;
  const height = to.y - from.y;

  return {
    centerX: from.x + width / 2,
    centerY: from.y + height / 2,
    radius: Math.min(Math.abs(width), Math.abs(height)) / 2,
  };
}

export function elbowPoints(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const start = { x: from.x, y: from.y };
  const end = { x: to.x, y: to.y };

  if (Math.abs(dx) < STRAIGHT_THRESHOLD || Math.abs(dy) < STRAIGHT_THRESHOLD) {
    return [start, end];
  }

  const corner =
    Math.abs(dx) > Math.abs(dy)
      ? { x: to.x, y: from.y } // across, then down
      : { x: from.x, y: to.y }; // down, then across

  return [start, corner, end];
}
