import { Shape } from "./Game";
import { Handle } from "./hitTest";
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
 * Reach of the eraser, in pixels.
 *
 * Two readers: the hit test that decides what is erased, and the circle drawn
 * under the cursor. If those drift apart the eraser starts removing things it
 * visibly never touched.
 */
export const ERASER_RADIUS = 12;
export const SELECT_TOLERANCE = 6;
export const HANDLE_SIZE = 8;
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
/**
 * Thinnest a stroke may become on screen, in device pixels.
 *
 * Line widths are world units, so under the camera transform they scale with
 * the board - which is right, a drawing zoomed out should read as smaller.
 * But below one device pixel the canvas renders a line as faint partial
 * coverage, and at the 10% floor a 1-unit stroke is 0.2 device pixels on a
 * Retina display: shapes dissolve into a few marks where the corners happen
 * to overlap. Floor it, and a zoomed-out board stays legible instead of
 * disappearing.
 */
const MIN_STROKE_DEVICE_PX = 1;

export class ShapeRenderer {
  private ctx: CanvasRenderingContext2D;
  /**
   * Device pixels per world unit, as currently transformed.
   *
   * Set by beginWorld, so stroke widths can be floored without every method
   * having to be handed the camera. 1 outside a world block, where world
   * units and device pixels are the same thing.
   */
  private scale = 1;
  /** world units per screen pixel is 1/zoom; kept for the same flooring */
  private zoom = 1;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /**
   * A soft pad behind a shape that has just appeared, fading out.
   *
   * save/restore rather than setting every property: globalAlpha and the dash
   * pattern would otherwise leak into whatever is drawn next, and unlike
   * strokeStyle nobody else sets them back.
   */
  highlight(left: number, top: number, width: number, height: number, color: string, alpha: number) {
    const pad = 6;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.roundRect(left - pad, top - pad, width + pad * 2, height + pad * 2, 10);
    this.ctx.fill();
    this.ctx.restore();
  }

  /** the eraser's reach, drawn under the cursor so its size is visible */
  eraserCursor(at: Point, radius: number, color: string, zoom = 1) {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.setLineDash([3 / zoom, 3 / zoom]);

    this.ctx.beginPath();
    this.ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    // a dot at the centre: the ring alone is hard to aim with
    this.ctx.setLineDash([]);
    this.ctx.globalAlpha = 0.9;
    this.ctx.beginPath();
    this.ctx.arc(at.x, at.y, 1.5 / zoom, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * An uploaded picture, already decoded.
   *
   * Takes a bitmap rather than a URL because the canvas is immediate mode:
   * every repaint must draw synchronously, and there is nowhere to await a
   * network fetch. Decoding and caching happen outside; this only paints.
   */
  image(bitmap: CanvasImageSource, x: number, y: number, width: number, height: number) {
    // negative sizes come from a flipped resize; drawImage would silently draw
    // nothing rather than mirror, so normalise to a top-left origin
    const left = width < 0 ? x + width : x;
    const top = height < 0 ? y + height : y;
    this.ctx.drawImage(bitmap, left, top, Math.abs(width), Math.abs(height));
  }

  /**
   * Stand-in for an image whose bytes have not arrived, or will not.
   *
   * Drawn at the shape's real size so the board does not reflow when the
   * picture appears - the gap is already the right shape.
   */
  imagePlaceholder(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    failed: boolean
  ) {
    const left = width < 0 ? x + width : x;
    const top = height < 0 ? y + height : y;
    const w = Math.abs(width);
    const h = Math.abs(height);

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = this.strokeWidth(1);
    this.ctx.globalAlpha = 0.35;
    this.ctx.setLineDash(failed ? [2, 3] : [6, 4]);
    this.ctx.strokeRect(left, top, w, h);

    if (failed) {
      // a cross, so a broken image is distinguishable from one still loading
      this.ctx.beginPath();
      this.ctx.moveTo(left, top);
      this.ctx.lineTo(left + w, top + h);
      this.ctx.moveTo(left + w, top);
      this.ctx.lineTo(left, top + h);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /**
   * Switch into world coordinates for everything drawn until endWorld().
   *
   * Plain numbers rather than a Camera, so this file stays ignorant of the
   * camera module - and so the two do not end up importing each other, since
   * camera.ts already takes Point from here.
   *
   * setTransform, not translate + scale: it sets the matrix absolutely rather
   * than multiplying into whatever was there, so a missed restore cannot
   * compound frame after frame into a board drifting off screen.
   *
   * The matrix is screen = (world + scroll) * zoom, then device = screen *
   * dpr, folded into one: a scale of `zoom * dpr` and a translation of
   * `scroll * zoom * dpr`.
   *
   * There are three coordinate spaces now, and only the last is new:
   *
   *   world   what is stored; shapes live here
   *   screen  CSS pixels; what the mouse reports and the eye measures
   *   device  physical pixels; what the canvas actually paints
   *
   * On a Retina display one CSS pixel is two or three device pixels. Drawing
   * at CSS size and letting the browser upscale is exactly what made the
   * board soft; painting into a backing store that large and scaling here is
   * what makes it sharp. The mouse and every constant stay in CSS pixels,
   * because that is the space a person actually perceives.
   */
  beginWorld(scrollX: number, scrollY: number, zoom: number, dpr = 1) {
    this.ctx.save();
    const s = zoom * dpr;
    this.scale = s;
    this.zoom = zoom;
    this.ctx.setTransform(s, 0, 0, s, scrollX * s, scrollY * s);
  }

  /** Back to device coordinates. Must pair with every beginWorld. */
  endWorld() {
    this.scale = 1;
    this.zoom = 1;
    this.ctx.restore();
  }

  /**
   * A stroke width in world units that will not vanish once transformed.
   *
   * Returns the width asked for, unless that would land under a device pixel
   * on screen - in which case the smallest width that still shows.
   */
  private strokeWidth(worldWidth: number): number {
    return Math.max(worldWidth, MIN_STROKE_DEVICE_PX / this.scale);
  }

  /**
   * A world length that will not shrink below `screenPixels` on screen.
   *
   * Same idea as strokeWidth, for details whose job is to be recognisable
   * rather than to be any particular size - an arrowhead that scales away
   * leaves a line that is no longer an arrow.
   */
  private atLeastOnScreen(worldLength: number, screenPixels: number): number {
    return Math.max(worldLength, screenPixels / this.zoom);
  }

  /**
   * A dot at every grid intersection across the visible area.
   *
   * On an infinite canvas this is not decoration. Panning across empty space
   * with nothing to see gives no feedback that anything is happening, and
   * without a repeating unit there is no sense of how big a shape is or how
   * far you have travelled. The dots supply both.
   *
   * Drawn inside the camera transform so it scrolls with the board, which is
   * the whole point - a grid pinned to the screen would say nothing about
   * movement. Only the dots themselves are kept a constant size, like every
   * other mark whose job is to be seen rather than to be measured.
   *
   * Iterating over the visible area, not the board: the board is infinite,
   * so there is no "all the dots" to draw.
   */
  grid(
    bounds: { left: number; top: number; right: number; bottom: number },
    spacing: number,
    color: string,
    zoom = 1
  ) {
    if (spacing <= 0) return;

    // One dot per grid step across the viewport - a few thousand at most,
    // since the spacing adapts to keep them ~40px apart. The guard is for
    // the pathological case only: a spacing that somehow went tiny would
    // otherwise try to paint millions of dots and hang the frame.
    const columns = (bounds.right - bounds.left) / spacing;
    const rows = (bounds.bottom - bounds.top) / spacing;
    if (!Number.isFinite(columns) || columns * rows > 40_000) return;

    // constant on screen, like the grips and the selection outline
    const size = 1.4 / zoom;
    const half = size / 2;

    // start at the first multiple of spacing inside the view, so the dots
    // sit on absolute world positions rather than relative to the scroll -
    // that is what makes them hold still while everything else moves
    const firstX = Math.ceil(bounds.left / spacing) * spacing;
    const firstY = Math.ceil(bounds.top / spacing) * spacing;

    this.ctx.save();
    this.ctx.fillStyle = color;
    for (let x = firstX; x <= bounds.right; x += spacing) {
      for (let y = firstY; y <= bounds.bottom; y += spacing) {
        this.ctx.fillRect(x - half, y - half, size, size);
      }
    }
    this.ctx.restore();
  }

  /**
   * Wipe the canvas and lay down the board colour.
   *
   * Device coordinates, always - call it outside beginWorld. Under the camera
   * transform this rectangle would itself be scrolled and scaled, so it would
   * stop covering the canvas and the board would grow an unpainted margin on
   * two sides.
   */
  clear(background: string) {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = background;
    this.ctx.fillRect(0, 0, width, height);
  }

  rect(x: number, y: number, width: number, height: number, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = this.strokeWidth(1);

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
    this.ctx.lineWidth = this.strokeWidth(1);
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
    this.ctx.lineWidth = this.strokeWidth(width);
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
    this.ctx.lineWidth = this.strokeWidth(1);
    this.ctx.beginPath();
    var dx = pointTo.x - pointFrom.x;
    var dy = pointTo.y - pointFrom.y; 
    var angle = Math.atan2(dy, dx);
    // floored so an arrow still reads as an arrow when zoomed out: at the
    // 10% floor a fixed 10 units is 1 screen pixel, which is nothing
    const headlen = this.atLeastOnScreen(10, 8);
    this.ctx.moveTo(pointTo.x, pointTo.y); 
    this.ctx.lineTo(pointTo.x - headlen * Math.cos(angle - Math.PI / 6), pointTo.y - headlen * Math.sin(angle - Math.PI / 6));
    this.ctx.moveTo(pointTo.x, pointTo.y);
    this.ctx.lineTo(pointTo.x - headlen * Math.cos(angle + Math.PI / 6), pointTo.y - headlen * Math.sin(angle + Math.PI / 6));
    this.ctx.stroke();
  }
  /**
   * The rubber-band rectangle dragged across empty canvas.
   *
   * Filled as well as stroked, unlike a selection outline: the fill is what
   * makes it read as an area being swept rather than a shape being drawn.
   */
  marquee(x: number, y: number, width: number, height: number, color: string, zoom = 1) {
    const left = width < 0 ? x + width : x;
    const top = height < 0 ? y + height : y;
    const w = Math.abs(width);
    const h = Math.abs(height);

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.setLineDash([4 / zoom, 4 / zoom]);
    this.ctx.globalAlpha = 0.12;
    this.ctx.fillRect(left, top, w, h);
    this.ctx.globalAlpha = 1;
    this.ctx.beginPath();
    this.ctx.rect(left, top, w, h);
    this.ctx.stroke();
    this.ctx.restore();
  }

  selectionBox(x: number, y: number, width : number, height: number, color: string, zoom = 1) {
    this.ctx.save();
    // the gap, the hairline and the dash are all judged by eye, so they are
    // screen pixels and have to be divided back out of the zoom
    const PAD = 4 / zoom;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 0.8 / zoom;
    const left = width < 0 ? x + width : x;
    const top = height < 0 ? y + height : y;
    const w = Math.abs(width);
    const h = Math.abs(height);
    this.ctx.beginPath();
    this.ctx.setLineDash([4 / zoom, 4 / zoom]);
    this.ctx.rect(left- PAD, top -PAD, w+PAD*2, h+PAD*2)
    this.ctx.stroke();
    this.ctx.restore()
  }
  handles(points: Handle[], color: string, zoom = 1) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.setLineDash([]);
    // Drawn inside the camera transform, so a fixed size would scale with
    // the board - a grip the size of a postage stamp zoomed in, invisible
    // zoomed out. Dividing by the zoom keeps it constant on screen.
    const size = HANDLE_SIZE / zoom;
    const half = size / 2;
    this.ctx.lineWidth = 1 / zoom;
    for (const p of points) {
      this.ctx.fillRect(p.x - half, p.y - half, size, size);
    }

    this.ctx.restore();
  }
}