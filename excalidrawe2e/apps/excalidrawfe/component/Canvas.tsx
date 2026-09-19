"use client";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./IconButton";
import {
  Circle,
  Monitor,
  Moon,
  Pencil,
  RectangleHorizontalIcon,
  Sun,
  Trash2,
  Minus, 
  MoveUpRight
} from "lucide-react";
import { Game } from "@/draw/Game";
import { useTheme } from "./ThemeProvider";
import {
  COLOR_NAMES,
  DEFAULT_COLOR,
  THEMES,
  type ColorName,
  type ThemeChoice,
} from "@/draw/theme";

export type Tool = "circle" | "rect" | "pencil" | "line" | "arrow";

export function Canvas({ roomId, socket }: { roomId: string; socket: WebSocket }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>();
  const [selectedTool, setSelectedTool] = useState<Tool>("circle");
  // a palette name; the theme decides what it looks like
  const [selectedColor, setSelectedColor] = useState<ColorName>(DEFAULT_COLOR);
  const { theme, choice, cycle } = useTheme();
  const palette = THEMES[theme];

  useEffect(() => {
    game?.setTool(selectedTool);
  }, [selectedTool, game]);

  useEffect(() => {
    game?.setColor(selectedColor);
  }, [selectedColor, game]);

  useEffect(() => {
    game?.setTheme(theme);
  }, [theme, game]);

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current, roomId, socket, theme);
    setGame(g);
    return () => g.destroy();
    // theme is read once here for the first paint; later changes go through setTheme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, socket]);

  // Setting a canvas's width or height wipes its contents, so every resize needs
  // a repaint. Without this the board stays blank until the next draw.
  useEffect(() => {
    if (!game || size.w === 0) return;
    game.repaint();
  }, [game, size.w, size.h]);

  function handleClear() {
    if (!game) return;
    if (!confirm("Clear all shapes? This cannot be undone.")) return;
    game.clearRoom();
  }

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: palette.canvas,
      }}
    >
      <canvas ref={canvasRef} width={size.w} height={size.h} />
      <TopBar
        selectedTool={selectedTool}
        setSelectedTool={setSelectedTool}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        onClear={handleClear}
        themeChoice={choice}
        onCycleTheme={cycle}
      />
    </div>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: following your browser",
  light: "Theme: light",
  dark: "Theme: dark",
};

function TopBar({
  selectedTool,
  setSelectedTool,
  selectedColor,
  setSelectedColor,
  onClear,
  themeChoice,
  onCycleTheme,
}: {
  selectedTool: Tool;
  setSelectedTool: (s: Tool) => void;
  selectedColor: ColorName;
  setSelectedColor: (c: ColorName) => void;
  onClear: () => void;
  themeChoice: ThemeChoice;
  onCycleTheme: () => void;
}) {
  const { theme } = useTheme();
  const palette = THEMES[theme];
  const iconProps = {
    color: palette.panelMuted,
    activeColor: palette.accent,
    activeBackground: palette.panelBorder,
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: 10,
        display: "flex",
        gap: 12,
        background: palette.panel,
        border: `1px solid ${palette.panelBorder}`,
        color: palette.panelText,
        padding: 8,
        borderRadius: 12,
        backdropFilter: "blur(8px)",
        alignItems: "center",
      }}
    >
      {/* Tools */}
      <div style={{ display: "flex", gap: 4 }}>
        <IconButton
          onClick={() => setSelectedTool("pencil")}
          activated={selectedTool === "pencil"}
          icon={<Pencil size={20} />}
          title="Pencil"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("rect")}
          activated={selectedTool === "rect"}
          icon={<RectangleHorizontalIcon size={20} />}
          title="Rectangle"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("circle")}
          activated={selectedTool === "circle"}
          icon={<Circle size={20} />}
          title="Circle"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("line")}
          activated={selectedTool === "line"}
          icon={<Minus size={20} />}
          title="Line"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("arrow")}
          activated={selectedTool === "arrow"}
          icon={<MoveUpRight size={20} />}
          title="Arrow"
          {...iconProps}
        />
      </div>

      <Divider color={palette.panelBorder} />

      {/* Colours: names, drawn in this theme's version of each */}
      <div style={{ display: "flex", gap: 6 }}>
        {COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setSelectedColor(name)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: palette.colors[name],
              border:
                selectedColor === name
                  ? `2px solid ${palette.panelText}`
                  : `2px solid ${palette.panelBorder}`,
              cursor: "pointer",
              padding: 0,
            }}
            aria-label={name}
            aria-pressed={selectedColor === name}
            title={name}
          />
        ))}
      </div>

      <Divider color={palette.panelBorder} />

      <IconButton
        onClick={onCycleTheme}
        activated={themeChoice !== "system"}
        icon={
          themeChoice === "system" ? (
            <Monitor size={20} />
          ) : themeChoice === "light" ? (
            <Sun size={20} />
          ) : (
            <Moon size={20} />
          )
        }
        title={THEME_LABEL[themeChoice]}
        color={palette.panelMuted}
        activeColor={palette.panelText}
        activeBackground={palette.panelBorder}
      />

      <IconButton
        onClick={onClear}
        activated={false}
        icon={<Trash2 size={20} />}
        title="Clear the board"
        {...iconProps}
      />
    </div>
  );
}

function Divider({ color }: { color: string }) {
  return <div style={{ width: 1, height: 24, background: color }} />;
}
