export type Point = { x: number; y: number };

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
    this.ctx.strokeRect(x, y, width, height);
  }

  circle(centerX: number, centerY: number, radius: number, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, Math.abs(radius), 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.closePath();
  }

  stroke(points: Point[], color: string) {
    if (points.length < 2) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.stroke();
  }
}
