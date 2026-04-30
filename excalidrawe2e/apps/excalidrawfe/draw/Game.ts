import { Tool } from "@/component/Canvas";
import { getExistingShapes } from "./http";

type Shape =
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string }
  | { type: "circle"; centerX: number; centerY: number; radius: number; color: string }
  | { type: "pencil"; points: { x: number; y: number }[]; color: string };

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
  private remoteStrokes: Map<string, { x: number; y: number }[]> = new Map();

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
    this.existingShapes = await getExistingShapes(this.roomId);
    console.log(this.existingShapes);
    this.clearCanvas();
  }

  initHandlers() {
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "shape") {
        const incomingShape = message.shape;
        if (!incomingShape?.type || !incomingShape?.data) {
          return;
        }
        this.existingShapes.push({
          type: incomingShape.type,
          ...incomingShape.data,
        } as Shape);
        if (message.strokeId) {
          this.remoteStrokes.delete(message.strokeId);
        }
        this.clearCanvas();
      } else if (message.type === "stroke_start") {
        this.remoteStrokes.set(message.strokeId, []);
      } else if (message.type === "stroke_point") {
        const stroke = this.remoteStrokes.get(message.strokeId);
        if (stroke) {
          stroke.push(message.point);
          this.clearCanvas();
        }
      } else if (message.type === "clear_room") {
        this.existingShapes = [];
        this.remoteStrokes.clear();
        this.clearCanvas();
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

    // render in-progress strokes from other users on top
    this.remoteStrokes.forEach((points) => {
      this.drawStroke(points);
    });
  }

  mouseDownHandler = (e: MouseEvent) => {
    this.clicked = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    if (this.selectedTool === "pencil") {
      this.currentStrokeId = crypto.randomUUID();
      this.currentStroke = [{ x: e.clientX, y: e.clientY }];
      this.socket.send(
        JSON.stringify({
          type: "stroke_start",
          strokeId: this.currentStrokeId,
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
    let shape: Shape | null = null;

    if (selectedTool === "rect") {
      shape = {
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
        type: "pencil",
        points: this.currentStroke,
        color: this.currentColor,
      };
    }

    if (!shape) {
      return;
    }

    this.existingShapes.push(shape);
    const { type, ...data } = shape;

    this.socket.send(
      JSON.stringify({
        type: "shape",
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