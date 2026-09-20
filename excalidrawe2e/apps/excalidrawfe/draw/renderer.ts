export type Point = { x: number; y: number };

/**
 * How much to round an elbow corner. Applies to lines and arrow shafts only -
 * pencil strokes keep their exact points, since rounding a hand-drawn path
 * would smooth away what the person actually drew.
 */
const CORNER_RADIUS = 12;

/**
 * Gap between lines of a text shape, as a multiple of its font size.
 *
 * Exported because the editor overlay has to use the same value: if the
 * textarea's line-height differs from this, the text jumps the moment it is
 * committed to the canvas.
 */
export const LINE_HEIGHT = 1.25;

/** Size new text is created at, until there is a size picker in the toolbar. */
export const DEFAULT_FONT_SIZE = 20;

/**
 * Family new text is created with.
 *
 * A system stack rather than the app's Geist: ctx.font cannot read a CSS
 * variable, and a webfont that has not finished loading paints with fallback
 * metrics, so text drawn early would shift position once the real font arrives.
 * Moving to Geist later means resolving the family and repainting on
 * document.fonts.ready.
 */
export const DEFAULT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/**
 * Every drawing primitive, in one place.
 *
 * Saved shapes and live previews both go through here, so the two can no longer
 * drift apart - that was the bug waiting to happen while rect and circle each
 * had their drawing code written twice in Game.
 *
 * Colours arrive already resolved to a real value: this class knows nothing
 * about themes, which is what will let a PDF export replay the same calls with
 * a print palette later.
 *
 * Every method sets the context state it depends on (strokeStyle, lineWidth),
 * because canvas state is global and sticky - whatever was drawn last would
 * otherwise leak into the next shape.
 */
export class ShapeRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** wipe the canvas and lay down the board colour */
  clear(background: string) {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = background;
    this.ctx.fillRect(0, 0, width, height);
  }

  rect(x: number, y: number, width: number, height: number, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;

    // dragging right-to-left or upwards gives negative sizes, so normalise to a
    // top-left origin before the corner maths
    const left = width < 0 ? x + width : x;
    const top = height < 0 ? y + height : y;
    const w = Math.abs(width);
    const h = Math.abs(height);

    // a corner cannot round past half the shorter side, or the arcs meet and
    // the rectangle turns into a lozenge
    const radius = Math.min(CORNER_RADIUS, w / 2, h / 2);

    this.ctx.beginPath();
    this.ctx.roundRect(left, top, w, h, radius);
    this.ctx.stroke();
  }

  circle(centerX: number, centerY: number, radius: number, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, Math.abs(radius), 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.closePath();
  }
  arrow(points: Point[], color: string) {
    if (points.length < 2) return;
    this.polyline(points, color);
    this.arrowhead(points[points.length - 2], points[points.length - 1], color);
  }
  stroke(points: Point[], color: string) {
    this.path(points, color, 2);
  }

  /**
   * Draw a text shape. `x` and `y` are the top-left of the first line, which is
   * what the editor overlay positions itself at - keeping the two in the same
   * coordinate space is why textBaseline is "top" rather than the canvas
   * default of "alphabetic".
   *
   * fillText ignores "\n" completely, so lines are split here.
   */
  text(
    x: number,
    y: number,
    content: string,
    color: string,
    fontSize: number,
    fontFamily: string
  ) {
    // text is filled, not stroked - and clear() leaves fillStyle on the board
    // colour, so an unset fillStyle paints text invisibly
    this.ctx.fillStyle = color;
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    this.ctx.textBaseline = "top";
    this.ctx.textAlign = "left";

    const lineHeight = fontSize * LINE_HEIGHT;
    content.split("\n").forEach((line, index) => {
      this.ctx.fillText(line, x, y + index * lineHeight);
    });
  }

  private path(
    points: Point[],
    color: string,
    width: number,
    cornerRadius = 0
  ) {
    if (points.length < 2) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    if (cornerRadius > 0 && points.length > 2) {
      // arcTo draws toward the corner, then curves away along the next segment.
      // Only the vertices in the middle are corners; the two ends stay square.
      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]!;
        const corner = points[i]!;
        const next = points[i + 1]!;
        // a corner cannot round further than half of either leg, or the two
        // arcs of a short segment would overlap and bulge
        const radius = Math.min(
          cornerRadius,
          Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
          Math.hypot(next.x - corner.x, next.y - corner.y) / 2
        );
        this.ctx.arcTo(corner.x, corner.y, next.x, next.y, radius);
      }
      const last = points[points.length - 1]!;
      // arcTo stops where the curve leaves the corner, so close the final run
      this.ctx.lineTo(last.x, last.y);
    } else {
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i].x, points[i].y);
      }
    }

    this.ctx.stroke();
  }
  polyline(points: Point[], color: string) {
    this.path(points, color, 1, CORNER_RADIUS);
  }
  private arrowhead(pointFrom: Point, pointTo: Point, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    var dx = pointTo.x - pointFrom.x;
    var dy = pointTo.y - pointFrom.y; 
    var angle = Math.atan2(dy, dx);
    var headlen =10;
    this.ctx.moveTo(pointTo.x, pointTo.y); 
    this.ctx.lineTo(pointTo.x - headlen * Math.cos(angle - Math.PI / 6), pointTo.y - headlen * Math.sin(angle - Math.PI / 6));
    this.ctx.moveTo(pointTo.x, pointTo.y);
    this.ctx.lineTo(pointTo.x - headlen * Math.cos(angle + Math.PI / 6), pointTo.y - headlen * Math.sin(angle + Math.PI / 6));
    this.ctx.stroke();
  }
}
