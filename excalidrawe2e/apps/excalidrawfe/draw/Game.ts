import { Tool } from "@/component/Canvas";
import { getExistingShapes } from "./http";
import { imageUrl, uploadImage, isSupportedImage } from "./images";
import { DEFAULT_COLOR, resolveColor, THEMES, type ThemeName } from "./theme";
import { SELECT_TOLERANCE, ERASER_RADIUS, ShapeRenderer, type Point } from "./renderer";
import { circleFromDrag, elbowPoints } from "./routing";
import { IDENTITY_CAMERA, type Camera } from "./camera";
import {
  boundsBetween,
  boundsOf,
  boundsUnion,
  handleAt,
  handlesOf,
  hitTest,
  hitTestInside,
  isDegenerate,
  roundShape,
  OPPOSITE,
  scale,
  scaleFactors,
  shapesInBounds,
  translate,
  type Bounds,
  type Corner,
} from "./hitTest";

/** The cursor that shows which way a grip will stretch the selection. */
const RESIZE_CURSOR: Record<Corner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/** how long a newly drawn shape keeps its fading pad, in ms */
const APPEAR_MS = 450;

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
  // line and arrow are polylines: two points for a straight run, three for an
  // elbow. Identical shapes, so one is convertible to the other later.
  | { type: "line"; points: Point[]; color: string; id: string }
  | { type: "arrow"; points: Point[]; color: string; id: string }
  // x,y is the top-left of the first line, matching the editor overlay's box.
  // Size and family are stored per shape: they cannot be recovered from the
  // string later, and export and hit-testing will both need them.
  | { type: "text"; x: number; y: number; text: string; fontSize: number; fontFamily: string; color: string; id: string }
  // An uploaded picture. `hash` is the SHA-256 of its bytes, which is both the
  // storage key and the cache key - the pixels are never carried on the wire
  // or in the database, only this name for them. That is why an image shape
  // syncs through the same message as every other shape, with no protocol
  // work: collaborators resolve the hash to bytes themselves.
  //
  // `color` is unused but kept so the union stays uniform for callers that
  // read it generically.
  | { type: "image"; x: number; y: number; width: number; height: number; hash: string; color: string; id: string };

/**
 * A stroke someone else is drawing right now. Held only until their finished
 * shape arrives, then dropped in favour of the saved version. Never persisted.
 */
type RemoteStroke = { color: string; points: Point[] };
export type TextRequest = { at: Point; shape?: Extract<Shape, { type: "text" }> };
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

/**
 * Whether a key event belongs to a text field rather than to the board.
 *
 * contentEditable is included because a rich-text editor is not an <input> but
 * still owns every keystroke while it has focus.
 */
function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
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
  /** where the eraser was on the previous move, so its path can be sampled */
  private lastErasePoint: Point | null = null;
  /** the cursor, tracked while the eraser is active so its reach can be drawn */
  private cursor: Point | null = null;
  /** the text shape open in the editor, hidden from the canvas until it closes */
  private editingId: string | null = null;
  /* ── the appear animation ───────────────────────────────────────────── */
  /** shape id -> when it appeared, so a fading pad can be drawn behind it */
  private appearing: Map<string, number> = new Map();
  private animationFrame: number | null = null;
  /**
   * Where the board is being looked at from.
   *
   * View state, not board state: it is never sent, never stored, and every
   * person in a room has their own. Shapes are stored in world coordinates
   * and know nothing about it.
   *
   * Starts at the identity, which is exactly how the board behaved before a
   * camera existed - so coordinates saved then are already world coordinates
   * and nothing needs migrating.
   */
  private camera: Camera = IDENTITY_CAMERA;

  /* ── selection and dragging ─────────────────────────────────────────── */
  /**
   * Ids of the selected shapes, each outlined and moved together.
   *
   * A set rather than an array: selecting is idempotent, shift-click toggles,
   * and membership is asked far more often than order matters. Nothing here
   * implies the shapes still exist - a shape deleted elsewhere leaves its id
   * behind until forgetShape or the sweep in clearCanvas removes it.
   */
  private selectedIds: Set<string> = new Set();
  /**
   * The selected shape exactly as it was when a drag began, or null when no
   * drag is in progress.
   *
   * A deep clone, so translating never writes through to the shape still in
   * existingShapes. Each move computes the new position from this original and
   * the total offset since mousedown, rather than nudging the live shape by
   * per-move deltas - those accumulate rounding error, and a dropped mousemove
   * would leave the shape permanently offset.
   *
   * Separate from selectedIds because the two outlive different things: shapes
   * stay selected after mouseup, but are no longer being dragged. Empty means
   * no drag is in progress.
   */
  private dragOriginals: Map<string, Shape> = new Map();
  /**
   * The resize in progress, or null when no handle is being dragged.
   *
   * Mirrors dragOriginals: a deep clone so scaling never writes through to the
   * shape on the board, and every frame recomputes from it rather than
   * compounding per-frame factors. `anchor` is the opposite corner's position,
   * captured once at mousedown - recomputing it from the shrinking shape would
   * make it chase the cursor.
   */
  private resizing: {
    /** every selected shape as it was when the grip was grabbed */
    originals: Map<string, Shape>;
    corner: Corner;
    anchor: Point;
    /** the selection's box at that moment, which the scale factors divide by */
    bounds: Bounds;
  } | null = null;
  /**
   * The rubber band being dragged across empty canvas, or null.
   *
   * Lives only until mouseup, which turns the area into a selection.
   */
  private marquee: { from: Point; to: Point } | null = null;
  /**
   * shape id -> how it looked before an update we have sent but not yet seen
   * acknowledged.
   *
   * Updates are applied locally first so a drag feels instant, which means a
   * refusal leaves the board disagreeing with the database until a reload.
   * Holding the previous version lets that be put back. Cleared when the
   * server echoes the update, which doubles as the acknowledgement.
   */
  private pendingUpdates: Map<string, Shape> = new Map();
  /**
   * hash -> decoded bitmap, or how far the attempt to get one has got.
   *
   * The canvas is immediate mode: clearCanvas must draw synchronously, so a
   * bitmap either is in memory when the frame runs or it is not. Fetching is
   * kicked off on the first frame that needs it, a placeholder is drawn, and
   * the arrival triggers a repaint.
   *
   * "failed" is recorded rather than retried, because a repaint loop that
   * re-requests a missing object would hammer storage for as long as the shape
   * is on screen.
   */
  private images: Map<string, ImageBitmap | "loading" | "failed"> = new Map();

  /* ── networking ─────────────────────────────────────────────────────── */
  socket: WebSocket;
  /** set by React; asks it to open a text editor at a point. See setOnTextRequest. */
  private onTextRequest: ((req: TextRequest) => void) | null = null;

  /**
   * set by React; asks it to switch the active tool. See setOnToolChange.
   *
   * The toolbar owns which tool is active, so Game cannot just change it - it
   * can only ask, the same way it asks for a text editor.
   */
  private onToolChange: ((tool: Tool) => void) | null = null;

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
    window.removeEventListener("mouseup", this.mouseUpHandler);
    this.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.removeEventListener("dblclick", this.dblClickHandler);
    window.removeEventListener("keydown", this.keyboardHandler)
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Settings from the toolbar
   * ══════════════════════════════════════════════════════════════════════ */

  setTool(tool: Tool) {
    const wasEraser = this.selectedTool === "eraser";
    const leavingSelect = tool !== "select" && this.selectedIds.size > 0;
    this.selectedTool = tool;

    // A selection belongs to the select tool. Left standing while a drawing
    // tool is active, its outline and grips look like the shape is still
    // live - and the grips are worse than cosmetic, because they are only
    // consulted under the select tool, so they advertise a resize that a
    // click will not perform.
    if (leavingSelect) {
      this.selectedIds.clear();
      this.dragOriginals.clear();
      this.resizing = null;
      this.marquee = null;
    }

    // One assignment, not three: eraser hides the system pointer behind its
    // own ring, select uses the arrow so hovering can swap in grab and resize
    // cursors, and everything else draws, so it gets a crosshair.
    this.canvas.style.cursor =
      tool === "eraser" ? "none" : tool === "select" ? "default" : "crosshair";

    // clear the eraser ring when switching away, so it does not linger
    if (wasEraser && tool !== "eraser") {
      this.cursor = null;
    }
    if (leavingSelect || (wasEraser && tool !== "eraser")) {
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
  setOnTextRequest(cb: (req: TextRequest) => void) {
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

  /**
   * Let React be told when the board needs a different tool.
   *
   * Only used after adding an image so far: the thing you want to do with a
   * picture you just dropped is move or resize it, and being left holding the
   * circle tool means a stray click draws on top of it instead.
   */
  setOnToolChange(cb: (tool: Tool) => void) {
    this.onToolChange = cb;
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
   * Fetch and decode the bytes for a hash, once.
   *
   * Marked "loading" before the request so a second frame does not start a
   * second fetch - at 60fps a drag over an unloaded image would otherwise
   * launch dozens.
   */
  private async loadImage(hash: string) {
    this.images.set(hash, "loading");
    try {
      const response = await fetch(imageUrl(hash));
      if (!response.ok) throw new Error(`storage returned ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      this.images.set(hash, bitmap);
      this.clearCanvas();
    } catch (err) {
      console.error("[canvas] could not load image", hash, err);
      this.images.set(hash, "failed");
      this.clearCanvas();
    }
  }

  /**
   * Put a file on the board.
   *
   * Upload first, shape second: a shape pointing at bytes that failed to store
   * would draw a broken box for everyone, and it would be in the database.
   * Nothing is created until the hash is real.
   */
  async addImage(file: File, at: Point) {
    if (!isSupportedImage(file)) {
      this.notify("That file type is not supported");
      return;
    }
    try {
      const { hash, width, height } = await uploadImage(file);

      // fit to a comfortable size on screen rather than the image's own, which
      // for a screenshot is usually larger than the viewport
      const maxOnScreen = Math.min(this.canvas.width, this.canvas.height) * 0.6;
      const factor = Math.min(1, maxOnScreen / Math.max(width, height));
      const w = Math.round(width * factor);
      const h = Math.round(height * factor);

      const id = newId();
      this.commitShape({
        id,
        type: "image",
        // centre it on the drop point: dropping somewhere should put the image
        // under the cursor, not start it there
        x: at.x - w / 2,
        y: at.y - h / 2,
        width: w,
        height: h,
        hash,
        color: this.currentColor,
      });

      // Hand it over ready to be moved or resized. Nobody drops a picture in
      // order to keep drawing circles, and leaving the drawing tool active
      // means the first click lands a shape on top of it.
      //
      // Set here as well as asked of React: the state change arrives a render
      // later, and a mousedown in that gap would still be read as drawing.
      this.selectedTool = "select";
      this.selectedIds.clear();
      this.selectedIds.add(id);
      this.canvas.style.cursor = "default";
      this.onToolChange?.("select");
      this.clearCanvas();
    } catch (err) {
      console.error("[canvas] image upload failed:", err);
      this.notify("Could not upload that image");
    }
  }

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
    // device coordinates: the wipe has to cover the canvas itself, not a
    // scrolled and scaled rectangle that used to
    this.renderer.clear(THEMES[this.theme].canvas);

    // everything from here is in world coordinates
    this.renderer.beginWorld(this.camera.scrollX, this.camera.scrollY, this.camera.zoom);
    try {
    const now = performance.now();
    
    this.existingShapes.forEach((shape) => {
      if (shape.id === this.editingId) return;
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
      else if (shape.type === "image") {
        const cached = this.images.get(shape.hash);
        if (cached instanceof ImageBitmap) {
          this.renderer.image(cached, shape.x, shape.y, shape.width, shape.height);
        } else {
          // not here yet, or never coming: hold the space either way, so the
          // board does not reflow when the picture lands
          this.renderer.imagePlaceholder(
            shape.x,
            shape.y,
            shape.width,
            shape.height,
            THEMES[this.theme].panelMuted,
            cached === "failed"
          );
          if (cached === undefined) this.loadImage(shape.hash);
        }
      }
    });
    
    this.remoteStrokes.forEach((stroke) => {
      this.renderer.stroke(stroke.points, this.paintColor(stroke.color));
    });
    // the outline around the selected shape, over the shapes it frames but
    // under the eraser cursor
    if (this.selectedIds.size > 0) {
      // collected first: deleting from a Set while iterating it is legal, but
      // reads badly next to the drawing it is interleaved with
      const gone: string[] = [];
      for (const id of this.selectedIds) {
        const selected = this.existingShapes.find((s) => s.id === id);
        if (!selected) {
          // erased here, cleared, or deleted by someone else. Dropping the id
          // keeps every later reader - the Delete key, the drag handler - from
          // aiming at a shape that no longer exists.
          gone.push(id);
          continue;
        }
        const b = boundsOf(selected);
        this.renderer.selectionBox(
          b.left,
          b.top,
          b.right - b.left,
          b.bottom - b.top,
          THEMES[this.theme].accent
        );
      }
      for (const id of gone) this.forgetShape(id);

      // one set of grips for the whole selection, around the union of the
      // outlines above - a group resizes as a single object
      const bounds = this.selectionBounds();
      if (bounds) {
        this.renderer.handles(handlesOf(bounds), THEMES[this.theme].accent);
      }
    }

    // the rubber band, over the outlines it is about to replace
    if (this.marquee) {
      const { from, to } = this.marquee;
      this.renderer.marquee(
        from.x,
        from.y,
        to.x - from.x,
        to.y - from.y,
        THEMES[this.theme].accent
      );
    }

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
    } finally {
      // in a finally because a throw mid-paint would otherwise leave the
      // transform set, and every later frame would compound on top of it
      this.renderer.endWorld();
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
          // Our own update, relayed back: the server stored it, so there is
          // nothing left to revert. Ahead of the check below, so an
          // intermediate send added later is still acknowledged rather than
          // leaving a snapshot that outlives the drag.
          this.pendingUpdates.delete(message.id);
          // Someone else moving the shape under our cursor: both sides would
          // be writing a position to the same entry many times a second, and
          // it would visibly oscillate between the two. Theirs is dropped, so
          // our release is the last write the server stores - last writer
          // wins, not a merge.
          if (
            this.dragOriginals.has(message.id) ||
            this.resizing?.originals.has(message.id)
          ) {
            return;
          }
          this.existingShapes = this.existingShapes.map((s) =>
            s.id === message.id ? ({ ...s, ...message.data, id: s.id, type: s.type } as Shape) : s
          );
          this.clearCanvas();
        }
        else if(message.type === "delete_shape") {
          this.existingShapes = this.existingShapes.filter((s) => s.id !== message.id);
          this.shapeIds.delete(message.id);
          // clearCanvas would drop a stale id from selectedIds on the next paint
          // anyway; doing it here keeps the field honest from the moment the
          // message lands, for anything that reads it in between - a Delete
          // keypress in the same tick, say
          this.forgetShape(message.id);
          this.clearCanvas();
        }
        else if (message.type === "clear_room") {
          this.existingShapes = [];
          this.shapeIds.clear();
          this.remoteStrokes.clear();
          // the board is empty, so nothing can still be selected, dragged, or
          // waiting to be reverted
          this.selectedIds.clear();
          this.dragOriginals.clear();
          this.marquee = null;
          this.resizing = null;
          this.pendingUpdates.clear();
          this.clearCanvas();
        } else if (message.type === "error") {
          // the server refused something - a board you do not own, a shape it
          // could not save. The person needs to see this, not the console.
          // a refused update names its shape, so the optimistic change can be
          // undone rather than left to drift from the database
          if (message.id) {
            const previous = this.pendingUpdates.get(message.id);
            if (previous) {
              this.pendingUpdates.delete(message.id);
              this.applyShape(previous);
            }
          }
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
  private commitShape(unrounded: Shape) {
    // the other place geometry leaves this client, so rounded for the same
    // reason as updateShape: a circle dragged out lands on x.5 as often as
    // not, and that fraction would be stored and broadcast forever
    const shape = roundShape(unrounded);
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
  /**
   * Replace a shape locally and repaint, without telling anyone.
   *
   * Used for the frames of a drag: at 60 moves a second, sending each one
   * would put a row write on the socket per frame. The move is broadcast once,
   * on release.
   *
   * Replaced in place rather than removed and pushed, because list order is
   * z-order - a moved shape must not jump in front of what was covering it.
   */
  private replaceShape(shape: Shape): boolean {
    const index = this.existingShapes.findIndex((s) => s.id === shape.id)
    if(index === -1) {
      return false;
    }
    this.existingShapes[index] = shape;
    return true;
  }

  private applyShape(shape: Shape): boolean {
    const replaced = this.replaceShape(shape);
    if (replaced) this.clearCanvas();
    return replaced;
  }

  /**
   * The same, for a whole selection: one repaint at the end rather than one
   * per shape, so dragging twenty shapes costs the same frame as dragging one.
   */
  private applyShapes(shapes: Shape[]) {
    let any = false;
    for (const shape of shapes) {
      if (this.replaceShape(shape)) any = true;
    }
    if (any) this.clearCanvas();
  }

  /** Replace a shape everywhere: locally, for everyone else, and in the database. */
   updateShape(unrounded: Shape) {
    // the one place geometry leaves this client, so the one place worth
    // tidying: a drag's intermediate frames stay fractional and smooth, and
    // only the committed result is rounded
    const shape = roundShape(unrounded);
    const previous = this.existingShapes.find((s) => s.id === shape.id);
    if (!this.applyShape(shape)) {
      return;
    }
    // keep the first version from before this burst of updates: two edits in a
    // row should revert to how the shape looked before either of them
    if (previous && !this.pendingUpdates.has(shape.id)) {
      this.pendingUpdates.set(shape.id, previous);
    }
    const { type, id, ...data } = shape;
    this.send({
      type:"update_shape", 
      id, 
      data,
      roomId: this.roomId,
    }) 
  }
  /**
   * Drop every reference to a shape that no longer exists.
   *
   * A selected id would outline nothing, a drag original would be translated
   * into a shape that is not in the list, and a pending snapshot would be a
   * revert target for something already gone.
   */
  private forgetShape(id: string) {
    this.selectedIds.delete(id);
    this.dragOriginals.delete(id);
    // a resize of a selection one of whose shapes has gone would scale from a
    // box that no longer describes it
    if (this.resizing?.originals.has(id)) this.resizing = null;
    this.pendingUpdates.delete(id);
  }

  /**
   * Whether a point lands inside the box of something already selected.
   *
   * Open paths - an arrow, a line, a pencil stroke - have no interior, so
   * hitTestInside cannot help them and they can only be grabbed within a few
   * pixels of the stroke itself. An elbow arrow is mostly empty space inside
   * its own bounding box, which made it feel ungrabbable. Once a shape is
   * selected, its whole box becomes a handle, which is what every other
   * editor does.
   */
  private pointInSelection(point: Point): boolean {
    for (const shape of this.existingShapes) {
      if (!this.selectedIds.has(shape.id)) continue;
      const b = boundsOf(shape);
      if (
        point.x >= b.left - SELECT_TOLERANCE &&
        point.x <= b.right + SELECT_TOLERANCE &&
        point.y >= b.top - SELECT_TOLERANCE &&
        point.y <= b.bottom + SELECT_TOLERANCE
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * The box around everything selected, or null when nothing is.
   *
   * One box for the whole selection, so twenty shapes resize as one object
   * rather than each about its own corner.
   */
  private selectionBounds(): Bounds | null {
    if (this.selectedIds.size === 0) return null;
    return boundsUnion(this.existingShapes.filter((s) => this.selectedIds.has(s.id)));
  }

  /**
   * The corner of the grip under a point, or null.
   *
   * Reads the selection's box, so it answers for a group exactly as it does
   * for one shape.
   */
  private hoveredHandle(point: Point): Corner | null {
    const bounds = this.selectionBounds();
    if (!bounds) return null;
    return handleAt(bounds, point)?.corner ?? null;
  }

  /** Snapshot every selected shape, so a drag can be computed from originals. */
  private beginDrag() {
    this.dragOriginals.clear();
    for (const shape of this.existingShapes) {
      if (this.selectedIds.has(shape.id)) {
        // deep: the three point-based types would otherwise share their
        // points array with the shape still on the board
        this.dragOriginals.set(shape.id, structuredClone(shape));
      }
    }
  }

   deleteShape(id: string) {
    const index = this.existingShapes.findIndex((s) => s.id === id)
    if(index ===-1) {
      return;
    }
    this.existingShapes.splice(index, 1);
    this.shapeIds.delete(id)
    // covers the eraser and an emptied text box too, not just the Delete key
    this.forgetShape(id);
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
  editText(id:string, text:string) {
    const shape = this.existingShapes.find((s) => s.id === id); 
    if(!shape || shape.type!== "text") return
    this.editingId = null;
    if(text.trim() === "") return this.deleteShape(id);
    this.updateShape({...shape, text})
  }
  endTextEdit() {
    this.editingId = null;
    this.clearCanvas();
  }

  initMouseHandlers() {
    this.canvas.addEventListener("mousedown", this.mouseDownHandler);
    // on window, not the canvas: a mouseup outside the viewport never reaches
    // the canvas, which would leave a drag running with no button held
    window.addEventListener("mouseup", this.mouseUpHandler);
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.addEventListener("dblclick", this.dblClickHandler);
    window.addEventListener("keydown", this.keyboardHandler)
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
    } else if(this.selectedTool === "select") {
      // Handles first, before any shape test. A grip sits on the outline, so
      // the shape's own hit test would claim the press and start a move -
      // order is what decides which gesture you get.
      const selectionBox = this.selectionBounds();
      const handle = selectionBox ? handleAt(selectionBox, this.pointOf(e)) : null;
      if (selectionBox && handle) {
        const opposite = handlesOf(selectionBox).find(
          (c) => c.corner === OPPOSITE[handle.corner]
        )!;
        const originals = new Map<string, Shape>();
        for (const shape of this.existingShapes) {
          // deep, for the same reason a drag clones: the three point-based
          // types would otherwise share their points array with the board
          if (this.selectedIds.has(shape.id)) {
            originals.set(shape.id, structuredClone(shape));
          }
        }
        this.resizing = {
          originals,
          corner: handle.corner,
          anchor: { x: opposite.x, y: opposite.y },
          bounds: selectionBox,
        };
        this.clearCanvas();
        return;
      }

      // outline first, then the inside: pressing in the middle of a rectangle
      // is a grab, not the start of a rubber band
      const hit =
        hitTest(this.existingShapes, this.pointOf(e), SELECT_TOLERANCE) ??
        hitTestInside(this.existingShapes, this.pointOf(e));
      // shift extends the selection; without it a click starts a new one
      const additive = e.shiftKey;

      if (!hit && !additive && this.pointInSelection(this.pointOf(e))) {
        // inside what is already selected: move it. Shift is excluded so a
        // shift-drag can still sweep an area that overlaps the selection.
        this.beginDrag();
      } else if (!hit) {
        // empty canvas: sweep an area instead. A plain click here clears the
        // selection, a shift-drag adds to it.
        if (!additive) this.selectedIds.clear();
        this.marquee = { from: this.pointOf(e), to: this.pointOf(e) };
      } else if (additive) {
        // toggle, so a shift-click can take a shape back out of a selection
        if (this.selectedIds.has(hit.id)) {
          this.selectedIds.delete(hit.id);
        } else {
          this.selectedIds.add(hit.id);
        }
        // a click that deselected must not then drag what it removed
        if (this.selectedIds.has(hit.id)) this.beginDrag();
      } else {
        // pressing on something already selected drags the whole selection;
        // pressing on anything else selects just that and drags it
        if (!this.selectedIds.has(hit.id)) {
          this.selectedIds.clear();
          this.selectedIds.add(hit.id);
        }
        this.beginDrag();
      }
      this.clearCanvas();
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
    const at = this.pointOf(e);

    if (this.selectedTool === "text") {
      const texts = this.existingShapes.filter((s) => s.type === "text");
      const hit = hitTest(texts, at, 4);
      if (hit && hit.type === "text") {
        this.editingId = hit.id;
        this.clearCanvas();                           // hide it while the editor is open
        this.onTextRequest?.({ at: { x: hit.x, y: hit.y }, shape: hit });
      } else {
        this.onTextRequest?.({ at });
      }
      return;
    }

    // With any other tool, a double click on a shape picks it up: reaching for
    // something you can already see should not require finding the right tool
    // first. The same two tests the select tool uses, so a double click grabs
    // exactly what a click with that tool would have.
    //
    // The eraser is excluded - its first click has already deleted whatever
    // was there, and selecting the next thing underneath would be a surprise.
    if (this.selectedTool === "eraser") return;

    const hit =
      hitTest(this.existingShapes, at, SELECT_TOLERANCE) ??
      hitTestInside(this.existingShapes, at);
    if (!hit) return;

    this.selectedTool = "select";
    this.selectedIds.clear();
    this.selectedIds.add(hit.id);
    this.canvas.style.cursor = "default";
    this.onToolChange?.("select");
    this.clearCanvas();
  };

  /**
   * Commit the drag as a shape: add it locally for an instant result, then
   * send it. The server stores it and echoes it back, and the echo is ignored
   * because the id is already in shapeIds.
   */
  mouseUpHandler = (e: MouseEvent) => {
    // this fires for every release in the page now, so a drag that never began
    // on the canvas must not commit anything: without this, a mousedown on the
    // toolbar released over the board would draw a shape from a stale origin
    const wasClicked = this.clicked;
    this.clicked = false;
    this.lastErasePoint = null;
    // The gesture is over; the shapes stay selected, so selectedIds is left
    // alone. Read into locals and cleared here so every exit path below ends
    // the drag - stale originals would have a later mousemove translating
    // shapes nobody is dragging.
    const dragged = this.dragOriginals;
    const marquee = this.marquee;
    const resizing = this.resizing;
    this.dragOriginals = new Map();
    this.marquee = null;
    this.resizing = null;
    if (!wasClicked) return;

    if (this.selectedTool === "select") {
      if (resizing) {
        // a press on a grip that never moved changed nothing, and a write per
        // click would be a row update for every missed grab
        if (e.clientX !== this.startX || e.clientY !== this.startY) {
          const { originals, corner, anchor, bounds } = resizing;
          const { sx, sy, uniform } = scaleFactors(bounds, corner, anchor, this.pointOf(e));
          // one message per shape: the protocol has no batch form, so resizing
          // ten shapes is ten update_shape frames on release
          for (const original of originals.values()) {
            this.updateShape(scale(original, anchor, sx, sy, uniform));
          }
        }
        return;
      }

      if (marquee) {
        // a sweep that never moved is just a click on empty canvas, which has
        // already cleared the selection in mousedown
        const area = boundsBetween(marquee.from, this.pointOf(e));
        for (const shape of shapesInBounds(this.existingShapes, area)) {
          this.selectedIds.add(shape.id);
        }
        this.clearCanvas();
        return;
      }

      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      // a click that selected without moving: nothing to broadcast, and a
      // write per click would be a row update for every selection
      if (dragged.size > 0 && (dx !== 0 || dy !== 0)) {
        // one message per shape: the protocol has no batch form, so a ten
        // shape drag is ten update_shape frames on release
        for (const original of dragged.values()) {
          this.updateShape(translate(original, dx, dy));
        }
      }
      // select never builds a shape, so it stops before the chain below
      return;
    }

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

    // A click rather than a drag: the shape has no size. Committing it would
    // put an invisible row in the database that still sits in the z-order,
    // above everything drawn before it, swallowing clicks at that point.
    // Dropping it silently is right - the person did not mean to draw.
    if (isDegenerate(shape)) {
      this.currentStroke = [];
      this.currentStrokeId = null;
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

    // with the select tool, the cursor is the only hint that a shape can be
    // picked up - there are no handles on it yet
    if (this.selectedTool === "select") {
      if (this.resizing) {
        const corner = this.resizing.corner;
        if (corner === "n" || corner === "s") {
          this.canvas.style.cursor = "ns-resize";
        } else if (corner === "e" || corner === "w") {
          this.canvas.style.cursor = "ew-resize";
        } else {
          // read from where the cursor is now, not from the corner that was
          // grabbed: dragging through the anchor turns an se grip into a sw
          // one, and the arrow has to turn with it
          const dx = e.clientX - this.resizing.anchor.x;
          const dy = e.clientY - this.resizing.anchor.y;
          this.canvas.style.cursor =
            dx >= 0 === dy >= 0 ? "nwse-resize" : "nesw-resize";
        }
      } else if (this.dragOriginals.size > 0) {
        this.canvas.style.cursor = "grabbing";
      } else if (this.hoveredHandle(this.pointOf(e))) {
        const corner = this.hoveredHandle(this.pointOf(e))!;
        // the line the grip travels along: a diagonal for a corner, a single
        // axis for an edge
        this.canvas.style.cursor = RESIZE_CURSOR[corner];
      } else {
        const over =
          hitTest(this.existingShapes, this.pointOf(e), SELECT_TOLERANCE) ??
          hitTestInside(this.existingShapes, this.pointOf(e));
        this.canvas.style.cursor =
          over || this.pointInSelection(this.pointOf(e)) ? "grab" : "default";
      }
    }

    // a resize in progress: the anchor is fixed and the cursor is the corner
    // being dragged, so the two define the new box
    if (this.clicked && this.resizing) {
      const { originals, corner, anchor, bounds } = this.resizing;
      // one pair of factors for the whole selection, from the box as it was at
      // mousedown - computing them from the shrinking box each frame would
      // compound, and the shapes would run away from the cursor
      const { sx, sy, uniform } = scaleFactors(bounds, corner, anchor, this.pointOf(e));
      const resized: Shape[] = [];
      for (const original of originals.values()) {
        resized.push(scale(original, anchor, sx, sy, uniform));
      }
      // local only - the new geometry goes out once, on mouseup
      this.applyShapes(resized);
      return;
    }

    // a drag in progress: recompute every position from the originals and the
    // total offset since mousedown, never from the offset since the last move
    if (this.clicked && this.dragOriginals.size > 0) {
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      // local only - the moves go out once, on mouseup
      const moved: Shape[] = [];
      for (const original of this.dragOriginals.values()) {
        moved.push(translate(original, dx, dy));
      }
      this.applyShapes(moved);
      return;
    }

    // sweeping an area: only the band itself changes, the shapes do not
    if (this.clicked && this.marquee) {
      this.marquee = { from: this.marquee.from, to: this.pointOf(e) };
      this.clearCanvas();
      return;
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
  /**
   * Board shortcuts. Listens on window, because a canvas cannot take focus and
   * so never receives a key event of its own.
   *
   * Both keys are inert while nothing is selected, which leaves Backspace and
   * Escape doing their normal thing everywhere else on the page.
   */
  keyboardHandler = (e : KeyboardEvent) => {
    // Listening on window means every keystroke in the page arrives here,
    // including ones meant for a field: Backspace while someone is typing is a
    // correction, not a request to delete the selected shape. TextOverlay also
    // stops propagation, but that only covers that one textarea - this covers
    // any field added later.
    if (isTypingTarget(document.activeElement)) return;

    const key = e.key
    if(this.selectedIds.size > 0) {
      if(key === "Backspace" || key ==="Delete") {
        // only this key, and only once it is going to act: Backspace is
        // browser back-navigation in some contexts
        e.preventDefault();
        // copied first: deleteShape removes the id from selectedIds through
        // forgetShape, so iterating the live set would skip entries
        for (const id of [...this.selectedIds]) {
          this.deleteShape(id);
        }
        this.selectedIds.clear();
      } else if(key === "Escape") {
        this.selectedIds.clear();
        this.repaint()
      }
    }
  }
}
