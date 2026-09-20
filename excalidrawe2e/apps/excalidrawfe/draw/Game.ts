import { Tool } from "@/component/Canvas";
import { getExistingShapes } from "./http";
import { DEFAULT_COLOR, resolveColor, THEMES, type ThemeName } from "./theme";
import { ShapeRenderer, type Point } from "./renderer";
import { circleFromDrag, elbowPoints } from "./routing";

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
type Shape =
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string; id: string }
  | { type: "circle"; centerX: number; centerY: number; radius: number; color: string; id: string  }
  | { type: "pencil"; points: Point[]; color: string; id: string  }
  // line and arrow are polylines: two points for a straight run, three for an
  // elbow. Identical shapes, so one is convertible to the other later.
  | { type: "line"; points: Point[]; color: string; id: string }
  | { type: "arrow"; points: Point[]; color: string; id: string }
  // x,y is the top-left of the first line, matching the editor overlay's box.
  // Size and family are stored per shape: they cannot be recovered from the
  // string later, and export and hit-testing will both need them.
  | { type: "text"; x: number; y: number; text: string; fontSize: number; fontFamily: string; color: string; id: string };

/**
 * A stroke someone else is drawing right now. Held only until their finished
 * shape arrives, then dropped in favour of the saved version. Never persisted.
 */
type RemoteStroke = { color: string; points: Point[] };

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A v4 UUID for a new shape.
 *
 * crypto.randomUUID() only exists in a secure context, so it is undefined when
 * the app is opened over plain http on a LAN address - a phone on the same
 * wifi, say. getRandomValues works everywhere, so the fallback builds the same
 * thing by hand rather than letting ids come out undefined.
 */
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

/* ────────────────────────────────────────────────────────────────────────────
 * Game
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One board: the shapes on it, the socket that syncs them, and the mouse.
 *
 * Deliberately framework-free - React owns *what* the settings are (tool,
 * colour, theme) and pushes them in through setters; this class owns the
 * drawing. It never reads React state and never calls back into it, with one
 * exception: text needs a real DOM editor, so React registers a callback.
 *
 * Rendering is immediate-mode: there are no retained objects, only a list of
 * shapes and a full repaint. So anything that changes what should be on screen
 * has to call repaint() - the browser will not do it for you.
 */
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

  /* ── networking ─────────────────────────────────────────────────────── */
  socket: WebSocket;

  /** set by React; asks it to open a text editor at a point. See setOnTextRequest. */
  private onTextRequest: ((at: Point) => void) | null = null;

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
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Settings from the toolbar
   * ══════════════════════════════════════════════════════════════════════ */

  setTool(tool: Tool) {
    this.selectedTool = tool;
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

    this.existingShapes.forEach((shape) => {
      // stored colours are palette names now, but old rows hold raw hex
      const color = this.paintColor(shape.color);

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
    });

    // in-progress strokes from other users, in *their* colour, drawn last so
    // they sit above the saved shapes
    this.remoteStrokes.forEach((stroke) => {
      this.renderer.stroke(stroke.points, this.paintColor(stroke.color));
    });
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
            if (id) this.shapeIds.add(id);
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
        } else if (message.type === "clear_room") {
          this.existingShapes = [];
          this.shapeIds.clear();
          this.remoteStrokes.clear();
          this.clearCanvas();
        } else if (message.type === "error") {
          console.error("[canvas] server rejected a message:", message.message);
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
   * Record where the drag began. Only the pencil does more than that: it is
   * the one tool that streams to other people while it is being drawn, so it
   * announces itself here.
   */
  mouseDownHandler = (e: MouseEvent) => {
    this.clicked = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    // text is placed, not dragged: hand the point to React and let the editor
    // overlay take over. clicked goes back to false so no preview is drawn
    // while someone is typing.
    if (this.selectedTool === "text") {
      this.clicked = false;
      this.onTextRequest?.(this.pointOf(e));
      return;
    }

    if (this.selectedTool === "pencil") {
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
   * Commit the drag as a shape: add it locally for an instant result, then
   * send it. The server stores it and echoes it back, and the echo is ignored
   * because the id is already in shapeIds.
   */
  mouseUpHandler = (e: MouseEvent) => {
    this.clicked = false;

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
