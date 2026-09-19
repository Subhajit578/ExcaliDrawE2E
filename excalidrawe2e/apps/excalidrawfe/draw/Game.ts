import { Tool } from "@/component/Canvas";
import { getExistingShapes } from "./http";

type Shape =
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string; id: string }
  | { type: "circle"; centerX: number; centerY: number; radius: number; color: string; id: string  }
  | { type: "pencil"; points: { x: number; y: number }[]; color: string; id: string  };

// a stroke someone else is drawing right now: kept until their finished shape arrives
type RemoteStroke = { color: string; points: { x: number; y: number }[] };

// crypto.randomUUID() only exists in a secure context, so it is undefined when the
// app is opened over plain http on a LAN address. getRandomValues works everywhere.
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
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private existingShapes: Shape[];
  private roomId: string;
  private clicked: boolean;
  private startX = 0;
  private startY = 0;
  private selectedTool: Tool = "circle";
  private currentColor: string = "#ffffff";

  // pencil state
  private currentStroke: { x: number; y: number }[] = [];
  private currentStrokeId: string | null = null;
  private remoteStrokes: Map<string, RemoteStroke> = new Map();

  // every shape id we already hold, so an echo of our own shape is a no-op
  private shapeIds: Set<string> = new Set();

  socket: WebSocket;

  constructor(canvas: HTMLCanvasElement, roomId: string, socket: WebSocket) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.existingShapes = [];
    this.roomId = roomId;
    this.socket = socket;
    this.clicked = false;
    this.init();
    this.initHandlers();
    this.initMouseHandlers();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.mouseDownHandler);
    this.canvas.removeEventListener("mouseup", this.mouseUpHandler);
    this.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
  }

  setTool(tool: "circle" | "pencil" | "rect") {
    this.selectedTool = tool;
  }

  setColor(color: string) {
    this.currentColor = color;
  }

  clearRoom() {
    this.socket.send(
      JSON.stringify({
        type: "clear_room",
        roomId: this.roomId,
      })
    );
  }

  async init() {
    try {
      this.existingShapes = await getExistingShapes(this.roomId);
      this.shapeIds = new Set(this.existingShapes.map((s) => s.id));
      this.clearCanvas();
    } catch (err) {
      console.error("[canvas] could not load existing shapes:", err);
    }
  }

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
          this.remoteStrokes.set(message.strokeId, {
            color: message.color || "#ffffff",
            points: [],
          });
        } else if (message.type === "stroke_point") {
          const stroke = this.remoteStrokes.get(message.strokeId);
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

  private drawStroke(
    points: { x: number; y: number }[],
    color: string = this.currentColor
  ) {
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

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "rgba(0, 0, 0)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.existingShapes.map((shape) => {
      // fallback to white for any pre-color-update shapes still in the DB
      const color = shape.color || "#ffffff";

      if (shape.type === "rect") {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      } else if (shape.type === "circle") {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(
          shape.centerX,
          shape.centerY,
          Math.abs(shape.radius),
          0,
          Math.PI * 2
        );
        this.ctx.stroke();
        this.ctx.closePath();
      } else if (shape.type === "pencil") {
        this.drawStroke(shape.points, color);
      }
    });

    // render in-progress strokes from other users on top, in *their* color
    this.remoteStrokes.forEach((stroke) => {
      this.drawStroke(stroke.points, stroke.color);
    });
  }

  mouseDownHandler = (e: MouseEvent) => {
    this.clicked = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    if (this.selectedTool === "pencil") {
      this.currentStrokeId = newId();
      this.currentStroke = [{ x: e.clientX, y: e.clientY }];
      this.socket.send(
        JSON.stringify({
          type: "stroke_start",
          strokeId: this.currentStrokeId,
          color: this.currentColor,
          roomId: this.roomId,
        })
      );
    }
  };

  mouseUpHandler = (e: MouseEvent) => {
    this.clicked = false;
    const width = e.clientX - this.startX;
    const height = e.clientY - this.startY;

    const selectedTool = this.selectedTool;
    // the client names the shape, so the echo of it is recognisable as our own
    const id = newId();
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
      const radius = Math.max(width, height) / 2;
      shape = {
        id,
        type: "circle",
        radius: radius,
        centerX: this.startX + radius,
        centerY: this.startY + radius,
        color: this.currentColor,
      };
    } else if (selectedTool === "pencil") {
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
    }

    if (!shape) {
      return;
    }

    this.existingShapes.push(shape);
    this.shapeIds.add(id);
    // id travels at the top level: it is identity, not geometry, so it stays
    // out of the JSON column that `data` becomes
    const { type, id: _id, ...data } = shape;

    this.socket.send(
      JSON.stringify({
        type: "shape",
        id,
        shape: {
          type,
          data,
        },
        strokeId: this.currentStrokeId, // included for pencil; ignored otherwise
        roomId: this.roomId,
      })
    );

    // reset pencil state after commit
    this.currentStroke = [];
    this.currentStrokeId = null;
  };

  mouseMoveHandler = (e: MouseEvent) => {
    if (this.clicked) {
      const width = e.clientX - this.startX;
      const height = e.clientY - this.startY;
      this.clearCanvas();
      this.ctx.strokeStyle = this.currentColor;
      const selectedTool = this.selectedTool;

      if (selectedTool === "rect") {
        this.ctx.strokeRect(this.startX, this.startY, width, height);
      } else if (selectedTool === "circle") {
        const radius = Math.max(width, height) / 2;
        const centerX = this.startX + radius;
        const centerY = this.startY + radius;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, Math.abs(radius), 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.closePath();
      } else if (selectedTool === "pencil" && this.currentStrokeId) {
        const point = { x: e.clientX, y: e.clientY };
        this.currentStroke.push(point);
        this.socket.send(
          JSON.stringify({
            type: "stroke_point",
            strokeId: this.currentStrokeId,
            point,
            roomId: this.roomId,
          })
        );
        this.drawStroke(this.currentStroke);
      }
    }
  };

  initMouseHandlers() {
    this.canvas.addEventListener("mousedown", this.mouseDownHandler);
    this.canvas.addEventListener("mouseup", this.mouseUpHandler);
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
  }
}