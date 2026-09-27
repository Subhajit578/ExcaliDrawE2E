import { Tool } from "@/component/Canvas";
import { getExistingShapes } from "./http";
import { DEFAULT_COLOR, resolveColor, THEMES, type ThemeName } from "./theme";
import { ERASER_RADIUS, ShapeRenderer, type Point } from "./renderer";
import { boundsOf } from "./hitTest";

/** how long a newly drawn shape keeps its fading pad, in ms */
const APPEAR_MS = 450;
import { circleFromDrag, elbowPoints } from "./routing";
import { hitTest } from "./hitTest";

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Everything that can live on a board.
 *
 * `color` holds a palette name ("ink", "blue"), not a hex value - what it looks
 * like is decided at paint time, which is how a theme switch restyles drawings
 * made months ago. `id` is minted by the client, so an echo of our own shape
 * arrives with a name we already know.
 *
 * pencil, line and arrow share one structure on purpose: three types, one list
 * of points, so hit-testing and transforms can be written once for all three.
 */
export type Shape =
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string; id: string }
  | { type: "circle"; centerX: number; centerY: number; radius: number; color: string; id: string  }
  | { type: "pencil"; points: Point[]; color: string; id: string  }
  | { type: "line"; points: Point[]; color: string; id: string }
  | { type: "arrow"; points: Point[]; color: string; id: string }
  | { type: "text"; x: number; y: number; text: string; fontSize: number; fontFamily: string; color: string; id: string };


type RemoteStroke = { color: string; points: Point[] };

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class Game {
  /* ── canvas ─────────────────────────────────────────────────────────── */
  private canvas: HTMLCanvasElement;
  private renderer: ShapeRenderer;

  /* ── the board ──────────────────────────────────────────────────────── */
  private roomId: string;
  private existingShapes: Shape[];
  /** every shape id we already hold, so an echo of our own shape is a no-op */
  private shapeIds: Set<string> = new Set();
  /** other people's in-flight pencil strokes, keyed by their stroke id */
  private remoteStrokes: Map<string, RemoteStroke> = new Map();

  /* ── settings, pushed in from the toolbar ───────────────────────────── */
  private selectedTool: Tool = "circle";
  /** a palette name, not a hex: what it looks like is decided at paint time */
  private currentColor: string = DEFAULT_COLOR;
  private theme: ThemeName = "dark";

  /* ── the drag in progress ───────────────────────────────────────────── */
  private clicked: boolean;
  private startX = 0;
  private startY = 0;
  /** points collected since the pencil went down */
  private currentStroke: Point[] = [];
  /** names the stroke being drawn, so receivers can drop their live copy */
  private currentStrokeId: string | null = null;
  /** where the eraser was on the previous move, so its path can be sampled */
  private lastErasePoint: Point | null = null;
  /** the cursor, tracked while the eraser is active so its reach can be drawn */
  private cursor: Point | null = null;

  /* ── the appear animation ───────────────────────────────────────────── */
  /** shape id -> when it appeared, so a fading pad can be drawn behind it */
  private appearing: Map<string, number> = new Map();
  private animationFrame: number | null = null;

  /* ── networking ─────────────────────────────────────────────────────── */
  socket: WebSocket;

  /** set by React; asks it to open a text editor at a point. See setOnTextRequest. */
  private onTextRequest: ((at: Point) => void) | null = null;

  /** set by React; shows a message to the person. See setOnNotice. */
  private onNotice: ((message: string, tone: "error" | "info" | "success") => void) | null = null;

  /* ══════════════════════════════════════════════════════════════════════
   * Lifecycle
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * The socket must already be open and joined to the room - RoomCanvas does
   * that before constructing this. `theme` is only the starting value; later
   * changes arrive through setTheme so the board is never rebuilt for one.
   */
  constructor(
    canvas: HTMLCanvasElement,
    roomId: string,
    socket: WebSocket,
    theme: ThemeName = "dark"
  ) {
    this.canvas = canvas;
    this.renderer = new ShapeRenderer(canvas.getContext("2d")!);
    this.existingShapes = [];
    this.roomId = roomId;
    this.socket = socket;
    this.clicked = false;
    this.theme = theme;
    this.init();
    this.initHandlers();
    this.initMouseHandlers();
  }

  /** Detach the mouse listeners. The socket is closed by whoever opened it. */
  destroy() {
    this.canvas.removeEventListener("mousedown", this.mouseDownHandler);
    this.canvas.removeEventListener("mouseup", this.mouseUpHandler);
    this.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.removeEventListener("dblclick", this.dblClickHandler);
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Settings from the toolbar
   * ══════════════════════════════════════════════════════════════════════ */

  setTool(tool: Tool) {
    const wasEraser = this.selectedTool === "eraser";
    this.selectedTool = tool;

    // hide the system pointer behind the eraser's own ring, and clear the ring
    // when switching away so it does not linger over the board
    this.canvas.style.cursor = tool === "eraser" ? "none" : "default";
    if (wasEraser && tool !== "eraser") {
      this.cursor = null;
      this.clearCanvas();
    }
  }

  /**
   * Register the callback that opens the text editor. This is the one place
   * Game talks back to React: a canvas cannot take keyboard input, so the
   * overlay has to be a real DOM element that React owns.
   *
   * A setter rather than a constructor argument, so a new callback identity
   * does not rebuild the board.
   */
  setOnTextRequest(cb: (at: Point) => void) {
    this.onTextRequest = cb;
  }

  /**
   * Register how to show a message. Anything the person should know about but
   * cannot see on the canvas goes through here: a refusal from the server, a
   * board that would not load, a shape that failed to save.
   *
   * Without it these only reach the console, where nobody is looking.
   */
  setOnNotice(cb: (message: string, tone: "error" | "info" | "success") => void) {
    this.onNotice = cb;
  }

  /** report something to the person, and keep it in the console for debugging */
  private notify(message: string, tone: "error" | "info" | "success" = "error") {
    if (tone === "error") console.error("[canvas]", message);
    this.onNotice?.(message, tone);
  }

  /** Takes a palette name ("ink", "red"), never a hex value. */
  setColor(color: string) {
    this.currentColor = color;
  }

  setTheme(theme: ThemeName) {
    // React effects re-run more often than the theme actually changes, and a
    // full repaint per re-render would be wasteful
    if (this.theme === theme) return;
    this.theme = theme;
    this.repaint();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Painting
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * Repaint from the shape list. The entry point for anything outside the
   * drawing loop that invalidates the canvas: a theme change, or a resize -
   * setting a canvas's width or height wipes its contents.
   */
  repaint() {
    this.clearCanvas();
  }

  /**
   * Redraw the whole board: background, every saved shape in list order, then
   * other people's in-flight strokes on top.
   *
   * List order is z-order, and the load query sorts by creation time, so newer
   * shapes cover older ones.
   */
  clearCanvas() {
    this.renderer.clear(THEMES[this.theme].canvas);

    const now = performance.now();

    this.existingShapes.forEach((shape) => {
      // stored colours are palette names now, but old rows hold raw hex
      const color = this.paintColor(shape.color);

      // a pad behind anything that just appeared, fading over APPEAR_MS
      const appearedAt = this.appearing.get(shape.id);
      if (appearedAt !== undefined) {
        const progress = (now - appearedAt) / APPEAR_MS;
        if (progress >= 1) {
          this.appearing.delete(shape.id);
        } else {
          const b = boundsOf(shape);
          // ease out: bright immediately, then away quickly
          const alpha = 0.28 * (1 - progress) * (1 - progress);
          this.renderer.highlight(b.left, b.top, b.right - b.left, b.bottom - b.top, color, alpha);
        }
      }

      if (shape.type === "rect") {
        this.renderer.rect(shape.x, shape.y, shape.width, shape.height, color);
      } else if (shape.type === "circle") {
        this.renderer.circle(shape.centerX, shape.centerY, shape.radius, color);
      } else if (shape.type === "pencil") {
        this.renderer.stroke(shape.points, color);
      } else if (shape.type === "line") {
        this.renderer.polyline(shape.points, color);
      } else if (shape.type === "arrow") {
        this.renderer.arrow(shape.points, color);
      }
      else if (shape.type === "text") {
        this.renderer.text(shape.x, shape.y, shape.text, color, shape.fontSize, shape.fontFamily);
      }
    });

    // in-progress strokes from other users, in *their* colour, drawn last so
    // they sit above the saved shapes
    this.remoteStrokes.forEach((stroke) => {
      this.renderer.stroke(stroke.points, this.paintColor(stroke.color));
    });

    // the eraser's reach, on top of everything so it is never hidden
    if (this.selectedTool === "eraser" && this.cursor) {
      this.renderer.eraserCursor(this.cursor, ERASER_RADIUS, THEMES[this.theme].panelMuted);
    }

    // ids that no longer match a shape would keep the animation loop alive
    if (this.appearing.size > 0) {
      for (const id of this.appearing.keys()) {
        if (!this.shapeIds.has(id)) this.appearing.delete(id);
      }
    }
  }

  /**
   * What to actually stroke with, given a stored colour and the current theme.
   * The renderer never resolves colours itself - it is handed real values.
   */
  private paintColor(stored?: string) {
    return resolveColor(stored, this.theme);
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Loading
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * Fetch the room's saved shapes and paint them.
   *
   * Called un-awaited from the constructor, so it catches its own failures: an
   * expired token or a sleeping backend would otherwise surface as an
   * unhandled rejection and a canvas that stays blank with no explanation.
   */
  async init() {
    try {
      this.existingShapes = await getExistingShapes(this.roomId);
      this.shapeIds = new Set(this.existingShapes.map((s) => s.id));
      this.clearCanvas();
    } catch (err) {
      console.error("[canvas] could not load existing shapes:", err);
      this.notify("Could not load this board. Reload to try again.");
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Messages in
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * Handle everything the server sends. Wrapped in try/catch because one
   * malformed frame should cost a repaint, not the whole session.
   */
  initHandlers() {
    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "shape") {
          const incomingShape = message.shape;
          if (!incomingShape?.type || !incomingShape?.data) {
            return;
          }
          const id: string | undefined = incomingShape.id ?? message.id;

          // our own shape coming back (or a resend): we already have it, so
          // adding it again would leave two copies of one shape in the array
          if (!id || !this.shapeIds.has(id)) {
            if (id) {
              this.shapeIds.add(id);
              this.markAppearing(id);
            }
            this.existingShapes.push({
              id,
              type: incomingShape.type,
              ...incomingShape.data,
            } as Shape);
          }

          // the finished shape replaces the live preview of the same stroke
          if (message.strokeId) {
            this.remoteStrokes.delete(message.strokeId);
          }
          this.clearCanvas();
        } else if (message.type === "stroke_start") {
          // someone started drawing: hold their points until the shape arrives
          this.remoteStrokes.set(message.strokeId, {
            color: message.color || "#ffffff",
            points: [],
          });
        } else if (message.type === "stroke_point") {
          const stroke = this.remoteStrokes.get(message.strokeId);
          // a stroke we never saw start (we joined mid-draw): nothing to extend
          if (stroke) {
            stroke.points.push(message.point);
            this.clearCanvas();
          }
        } 
        else if(message.type === "update_shape") {

        } 
        else if(message.type === "delete_shape") {

        }
        else if (message.type === "clear_room") {
          this.existingShapes = [];
          this.shapeIds.clear();
          this.remoteStrokes.clear();
          this.clearCanvas();
        } else if (message.type === "error") {
          this.notify(message.message ?? "The server refused that action");
        }
      } catch (err) {
        console.error("[canvas] bad message from server:", err);
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Messages out
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * Every outgoing message goes through here - one place to add a readyState
   * guard, buffering or logging when the time comes.
   */
  private send(payload: Record<string, unknown>) {
    this.socket.send(JSON.stringify(payload));
  }

  /** Wipe the room for everyone. The server deletes the rows and broadcasts. */
  clearRoom() {
    this.send({
      type: "clear_room",
      roomId: this.roomId,
    });
  }

  /**
   * The one path a finished shape takes, whatever created it: remember it
   * locally so it appears instantly, then tell the server. The echo comes back
   * carrying the same id and is ignored, because the id is already in shapeIds.
   *
   * Shared by the mouse handlers and by text, which commits on a blur rather
   * than a mouseup.
   */
  private commitShape(shape: Shape) {
    this.existingShapes.push(shape);
    this.shapeIds.add(shape.id);
    this.markAppearing(shape.id);
    // paint it now rather than waiting for the server to echo it back: text
    // would otherwise disappear with its editor and reappear a round trip
    // later. Drag tools hide this because their preview already drew it.
    this.clearCanvas();
    // id and type travel at the top level: they are identity, not geometry, so
    // they stay out of the JSON column that `data` becomes
    const { type, id, ...data } = shape;

    this.send({
      type: "shape",
      id,
      shape: {
        type,
        data,
      },
      strokeId: this.currentStrokeId, // included for pencil; ignored otherwise
      roomId: this.roomId,
    });
  }
   updateShape(shape: Shape) {
    const index = this.existingShapes.findIndex((s) => s.id === shape.id)
    if(index ==-1) {
      return;
    }
    this.existingShapes[index] = shape;
    this.clearCanvas();
    const { type, id, ...data } = shape;
    this.send({
      type:"update_shape", 
      id, 
      data,
      roomId: this.roomId,
    }) 
  }
   deleteShape(id: string) {
    const index = this.existingShapes.findIndex((s) => s.id === id)
    if(index ===-1) {
      return;
    }
    this.existingShapes.splice(index, 1);
    this.shapeIds.delete(id)
    this.clearCanvas();
    this.send({
      type:"delete_shape", 
      id,
      roomId: this.roomId,
    }) 
  }
  /**
   * Create a text shape. Called by the editor overlay once someone finishes
   * typing - the position came from the click that opened it.
   *
   * Colour is the palette name, like every other shape; the overlay shows a
   * resolved value while typing, but what is stored is the name.
   */
  addText(at: Point, text: string, fontSize: number, fontFamily: string) {
    this.commitShape({
      id: newId(),
      type: "text",
      x: at.x,
      y: at.y,
      text,
      fontSize,
      fontFamily,
      color: this.currentColor,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Pointer input
   * ══════════════════════════════════════════════════════════════════════ */

  initMouseHandlers() {
    this.canvas.addEventListener("mousedown", this.mouseDownHandler);
    this.canvas.addEventListener("mouseup", this.mouseUpHandler);
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.addEventListener("dblclick", this.dblClickHandler);
  }

  /** where the cursor is now */
  private pointOf(e: MouseEvent): Point {
    return { x: e.clientX, y: e.clientY };
  }

  /** where the current drag began */
  private dragStart(): Point {
    return { x: this.startX, y: this.startY };
  }

  /**
   * Mark a shape as newly arrived, so the repaint draws a pad behind it that
   * fades away. Runs for shapes you drew and shapes other people drew - which
   * is the point: it is how you notice something appearing across the room.
   */
  private markAppearing(id: string) {
    this.appearing.set(id, performance.now());
    this.runAppearAnimation();
  }

  /**
   * Repaint on every frame while any shape is still fading in, then stop.
   *
   * Immediate-mode rendering means nothing animates on its own: each frame has
   * to be drawn. The loop ends as soon as the last animation expires, so an
   * idle board costs nothing.
   */
  private runAppearAnimation() {
    if (this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      this.clearCanvas();
      if (this.appearing.size > 0) this.runAppearAnimation();
    });
  }

  /**
   * Erase the topmost shape under a point, if there is one.
   *
   * No record of what has already been erased is needed: deleteShape removes
   * the shape from existingShapes, so the next hit test cannot find it again.
   */
  private eraseAt(at: Point) {
    const hit = hitTest(this.existingShapes, at, ERASER_RADIUS);
    if (hit) this.deleteShape(hit.id);
  }

  /**
   * Record where the drag began. Only the pencil does more than that: it is
   * the one tool that streams to other people while it is being drawn, so it
   * announces itself here.
   */
  mouseDownHandler = (e: MouseEvent) => {
    this.clicked = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    // text is placed by a double click - see dblClickHandler. Opening the
    // editor from mousedown as well would unmount the one already being typed
    // in (the key changes), so the text would be discarded on the very click
    // meant to commit it. clicked goes back to false so no preview is drawn
    // while someone types.
    if (this.selectedTool === "text") {
      this.clicked = false;
      return;
    }
    else if(this.selectedTool === "eraser") {
      // start the path here, or the first move would sweep all the way from
      // wherever the previous erase drag happened to end
      this.lastErasePoint = this.pointOf(e);
      this.eraseAt(this.pointOf(e));
    }
    else if (this.selectedTool === "pencil") {
      this.currentStrokeId = newId();
      this.currentStroke = [this.pointOf(e)];
      this.send({
        type: "stroke_start",
        strokeId: this.currentStrokeId,
        color: this.currentColor,
        roomId: this.roomId,
      });
    }
  };

  /**
   * A double click with the text tool opens the editor at that point.
   *
   * Double click rather than a single one so a stray click on the board does
   * not leave an editor open, and so the gesture stays available to "edit the
   * text under the cursor" later.
   *
   * Nothing happens here without a listener: React registers one through
   * setOnTextRequest, and owns the editor itself.
   */
  dblClickHandler = (e: MouseEvent) => {
    if (this.selectedTool !== "text") return;
    this.onTextRequest?.(this.pointOf(e));
  };

  /**
   * Commit the drag as a shape: add it locally for an instant result, then
   * send it. The server stores it and echoes it back, and the echo is ignored
   * because the id is already in shapeIds.
   */
  mouseUpHandler = (e: MouseEvent) => {
    this.clicked = false;
    this.lastErasePoint = null;

    // text commits from the editor's blur, never from a mouseup
    if (this.selectedTool === "text") return;

    const width = e.clientX - this.startX;
    const height = e.clientY - this.startY;

    const selectedTool = this.selectedTool;
    // the client names the shape, so the echo of it is recognisable as our own
    const id = newId();
    const start = this.dragStart();
    const end = this.pointOf(e);
    let shape: Shape | null = null;

    if (selectedTool === "rect") {
      shape = {
        id,
        type: "rect",
        x: this.startX,
        y: this.startY,
        height,
        width,
        color: this.currentColor,
      };
    } else if (selectedTool === "circle") {
      const { centerX, centerY, radius } = circleFromDrag(start, end);
      shape = {
        id,
        type: "circle",
        radius,
        centerX,
        centerY,
        color: this.currentColor,
      };
    } else if (selectedTool === "pencil") {
      // a tap, not a stroke: drop it and leave nothing behind
      if (this.currentStroke.length < 2) {
        this.currentStroke = [];
        this.currentStrokeId = null;
        return;
      }
      shape = {
        id,
        type: "pencil",
        points: this.currentStroke,
        color: this.currentColor,
      };
    } else if (selectedTool === "line") {
      // a click with no drag would store a zero-length shape: invisible, and
      // nearly impossible to erase later
      if (Math.hypot(width, height) < 4) return;
      shape = {
        id,
        type: "line",
        points: [start, end],
        color: this.currentColor,
      };
    } else if (selectedTool === "arrow") {
      if (Math.hypot(width, height) < 4) return;
      shape = {
        id,
        type: "arrow",
        // the same router the preview used, so what is saved is what was shown
        points: elbowPoints(start, end),
        color: this.currentColor,
      };
    }

    if (!shape) {
      return;
    }

    this.commitShape(shape);

    // reset pencil state after commit
    this.currentStroke = [];
    this.currentStrokeId = null;
  };

  /**
   * Draw the shape as it is being dragged.
   *
   * Every move repaints the whole board and then draws the in-progress shape
   * on top - nothing is retained. The preview calls the same renderer methods,
   * and the same elbow router, as the committed shape, so the two cannot
   * disagree about what is being drawn.
   *
   * Only the pencil sends anything here; the other tools stay local until
   * mouseup, so other people see them appear on release.
   */
  mouseMoveHandler = (e: MouseEvent) => {
    // the eraser draws its reach under the cursor, so it needs the position on
    // every move - not only while the button is held
    if (this.selectedTool === "eraser") {
      this.cursor = this.pointOf(e);
      if (!this.clicked) this.clearCanvas();
    }

    if (this.clicked) {
      const width = e.clientX - this.startX;
      const height = e.clientY - this.startY;
      this.clearCanvas();
      const color = this.paintColor(this.currentColor);
      const selectedTool = this.selectedTool;

      if (selectedTool === "rect") {
        this.renderer.rect(this.startX, this.startY, width, height, color);
      } else if (selectedTool === "circle") {
        const { centerX, centerY, radius } = circleFromDrag(
          this.dragStart(),
          this.pointOf(e)
        );
        this.renderer.circle(centerX, centerY, radius, color);
      }
      else if(selectedTool === "eraser") {
        // Sample along the path the cursor took since the last event, not just
        // where it is now: mouse events arrive every 8-16ms, so a fast swipe
        // jumps 40px or more and thin shapes would slip through the gaps.
        const from = this.lastErasePoint ?? this.dragStart();
        const to = this.pointOf(e);
        const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          this.eraseAt({
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
          });
        }
        this.lastErasePoint = to;
      } else if (selectedTool === "pencil" && this.currentStrokeId) {
        const point = this.pointOf(e);
        this.currentStroke.push(point);
        this.send({
          type: "stroke_point",
          strokeId: this.currentStrokeId,
          point,
          roomId: this.roomId,
        });
        this.renderer.stroke(this.currentStroke, color);
      } else if (selectedTool === "line") {
        this.renderer.polyline([this.dragStart(), this.pointOf(e)], color);
      } else if (selectedTool === "arrow") {
        this.renderer.arrow(
          elbowPoints(this.dragStart(), this.pointOf(e)),
          color
        );
      }
    }
  };
}
