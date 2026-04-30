"use client";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./IconButton";
import { Circle, Pencil, RectangleHorizontalIcon, Trash2 } from "lucide-react";
import { Game } from "@/draw/Game";

export type Tool = "circle" | "rect" | "pencil";

const COLORS = ["#ffffff", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#a855f7"];

export function Canvas({ roomId, socket }: { roomId: string; socket: WebSocket }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>();
  const [selectedTool, setSelectedTool] = useState<Tool>("circle");
  const [selectedColor, setSelectedColor] = useState<string>("#ffffff");

  useEffect(() => {
    game?.setTool(selectedTool);
  }, [selectedTool, game]);

  useEffect(() => {
    game?.setColor(selectedColor);
  }, [selectedColor, game]);

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current, roomId, socket);
    setGame(g);
    return () => g.destroy();
  }, [roomId, socket]);

  function handleClear() {
    if (!game) return;
    if (!confirm("Clear all shapes? This cannot be undone.")) return;
    game.clearRoom();
  }

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      <canvas ref={canvasRef} width={size.w} height={size.h} />
      <TopBar
        selectedTool={selectedTool}
        setSelectedTool={setSelectedTool}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        onClear={handleClear}
      />
    </div>
  );
}

function TopBar({
  selectedTool,
  setSelectedTool,
  selectedColor,
  setSelectedColor,
  onClear,
}: {
  selectedTool: Tool;
  setSelectedTool: (s: Tool) => void;
  selectedColor: string;
  setSelectedColor: (c: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: 10,
        display: "flex",
        gap: 12,
        background: "rgba(30, 30, 30, 0.85)",
        padding: 8,
        borderRadius: 12,
        backdropFilter: "blur(8px)",
        alignItems: "center",
      }}
    >
      {/* Tool buttons */}
      <div className="flex gap-2">
        <IconButton
          onClick={() => setSelectedTool("pencil")}
          activated={selectedTool === "pencil"}
          icon={<Pencil />}
        />
        <IconButton
          onClick={() => setSelectedTool("rect")}
          activated={selectedTool === "rect"}
          icon={<RectangleHorizontalIcon />}
        />
        <IconButton
          onClick={() => setSelectedTool("circle")}
          activated={selectedTool === "circle"}
          icon={<Circle />}
        />
      </div>

      <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.2)" }} />

      {/* Color swatches */}
      <div style={{ display: "flex", gap: 6 }}>
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedColor(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: c,
              border:
                selectedColor === c
                  ? "2px solid white"
                  : "2px solid rgba(255,255,255,0.2)",
              cursor: "pointer",
              padding: 0,
            }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>

      <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.2)" }} />

      {/* Clear button */}
      <IconButton onClick={onClear} activated={false} icon={<Trash2 />} />
    </div>
  );
}