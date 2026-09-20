import type { Point } from "./renderer";

/**
 * A drag shorter than this on either axis counts as straight: an elbow there
 * would leave a stub of a few pixels, which reads as a rendering glitch rather
 * than a deliberate corner.
 */
const STRAIGHT_THRESHOLD = 8;

/**
 * Turn a drag into an elbow route - a path made only of horizontal and
 * vertical segments.
 *
 * A drag gives two points, and an elbow needs a corner between them that
 * nobody supplied. Both corners are legal, so this picks one: travel along the
 * longer axis first, which leaves the shorter leg as the final approach.
 *
 *   from ●────────────┐          |dx| > |dy|: across, then down
 *                     │
 *                     ● to
 *
 * Pure on purpose - the live preview and the shape that gets saved both call
 * it, so they cannot disagree, and the rule can be replaced here (Z-routing,
 * obstacle avoidance) without touching the renderer, the shape type or the
 * database.
 *
 * The returned points are fresh objects, so callers can move them later
 * without reaching back into whatever was passed in.
 */
/**
 * Turn a drag into a circle: centred on the middle of the dragged box, sized to
 * the largest circle that fits inside it.
 *
 * Both values come from the box rather than from a single axis. That is what
 * makes dragging up or left work - the deltas are negative then, and taking the
 * midpoint handles the sign without any special cases. Math.min keeps the
 * circle inside the box you dragged; Math.max would spill outside it.
 *
 * Shared by the live preview and the committed shape so the two cannot differ.
 */
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
