import type { Shape } from "./Game";
import type { ShapeRenderer } from "./renderer";
import { boundsOf } from "./hitTest";

/**
 * Turning a list of shapes into renderer calls. Once.
 *
 * This is the layer between the two rules in CLAUDE.md that would otherwise
 * leave the dispatch homeless: `ShapeRenderer` is dumb and knows nothing
 * about shapes, and `Game` owns drawing but also owns the chrome - the grid,
 * the selection outlines, the eraser ring, the rubber band. Export wants the
 * shapes and none of the chrome.
 *
 * Before this file the switch lived inside `Game.clearCanvas`, interleaved
 * with all of that, which meant exporting a board could only be done by
 * writing the same switch a second time. Two copies of "which renderer call
 * does a circle need" is exactly the kind of drift the renderer was
 * extracted to stop, and the bug it produces is invisible until someone
 * prints a board and finds one shape type missing.
 *
 * So: shapes in, renderer calls out, nothing else. No camera, no theme, no
 * canvas, no state. The caller decides where it is drawing and what the
 * colours mean.
 */

export type PaintOptions = {
  /**
   * A stored colour, resolved for wherever this is being painted.
   *
   * A function rather than a ThemeName so this file never imports the
   * palette: the live canvas passes the board's theme, the exporter passes
   * the print one, and neither has to be known here.
   */
  color: (stored: string | undefined) => string;

  /**
   * Decoded images, by hash.
   *
   * Read-only because painting must never start a fetch - it is a frame, not
   * a place to begin network work. A hash that is missing is reported
   * through `onMissingImage` and left to the caller.
   */
  images: ReadonlyMap<string, ImageBitmap | "loading" | "failed">;

  /** what an absent or broken image is outlined in */
  placeholderColor: string;

  /**
   * A shape to leave unpainted.
   *
   * The live canvas hides the text shape that is currently open in the
   * editor overlay, so the two do not show at once. Export passes nothing:
   * there is no overlay in a PDF, and a hidden shape would be a hole.
   */
  skipId?: string | null;

  /**
   * How strongly to pad a shape that has just appeared, or null for none.
   *
   * Only the live canvas has an opinion here. It is a callback rather than a
   * map of alphas because the animation is a function of the clock, and the
   * caller is the one holding it.
   */
  highlightAlpha?: (shape: Shape) => number | null;

  /**
   * Told about an image whose bytes are not in the map.
   *
   * The live canvas starts a fetch and repaints when it lands. The exporter
   * has already awaited every hash before painting, so anything still
   * missing here is genuinely unavailable and it passes nothing.
   */
  onMissingImage?: (hash: string) => void;
};

/**
 * Paint every shape, in list order.
 *
 * List order is z-order - the load query sorts by creation time - so later
 * shapes cover earlier ones. Callers must not sort.
 */
export function paintShapes(
  renderer: ShapeRenderer,
  shapes: readonly Shape[],
  options: PaintOptions
) {
  for (const shape of shapes) {
    if (shape.id === options.skipId) continue;

    const color = options.color(shape.color);

    const alpha = options.highlightAlpha?.(shape);
    if (alpha !== null && alpha !== undefined) {
      const b = boundsOf(shape);
      renderer.highlight(b.left, b.top, b.right - b.left, b.bottom - b.top, color, alpha);
    }

    switch (shape.type) {
      case "rect":
        renderer.rect(shape.x, shape.y, shape.width, shape.height, color);
        break;
      case "circle":
        renderer.circle(shape.centerX, shape.centerY, shape.radius, color);
        break;
      case "pencil":
        renderer.stroke(shape.points, color);
        break;
      case "line":
        renderer.polyline(shape.points, color);
        break;
      case "arrow":
        renderer.arrow(shape.points, color);
        break;
      case "text":
        renderer.text(shape.x, shape.y, shape.text, color, shape.fontSize, shape.fontFamily);
        break;
      case "image": {
        const cached = options.images.get(shape.hash);
        if (cached instanceof ImageBitmap) {
          renderer.image(cached, shape.x, shape.y, shape.width, shape.height);
        } else {
          // hold the space either way, so the board does not reflow when the
          // picture lands
          renderer.imagePlaceholder(
            shape.x,
            shape.y,
            shape.width,
            shape.height,
            options.placeholderColor,
            cached === "failed"
          );
          if (cached === undefined) options.onMissingImage?.(shape.hash);
        }
        break;
      }
    }
  }
}
