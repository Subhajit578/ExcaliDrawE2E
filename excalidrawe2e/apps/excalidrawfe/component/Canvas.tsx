"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  MoveUpRight,
  Type,
  Eraser,
  SquareDashedMousePointerIcon
} from "lucide-react";
import { Game, TextRequest } from "@/draw/Game";
import TextOverlay from "./TextOverlay";
import { makeNotice, ToastStack, type Notice } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  type Point,
} from "@/draw/renderer";
import { useTheme } from "./ThemeProvider";
import {
  COLOR_NAMES,
  DEFAULT_COLOR,
  THEMES,
  resolveColor,
  type ColorName,
  type ThemeChoice,
} from "@/draw/theme";
export type Tool = "circle" | "rect" | "pencil" | "line" | "arrow" | "text" | "eraser" |"mouse_selector";

export function Canvas({ roomId, socket }: { roomId: string; socket: WebSocket }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>();
  const [selectedTool, setSelectedTool] = useState<Tool>("circle");
  // a palette name; the theme decides what it looks like
  const [selectedColor, setSelectedColor] = useState<ColorName>(DEFAULT_COLOR);
  // where the text editor is open, or null when there isn't one
  const [editing, setEditing] = useState<TextRequest | null>(null);
  // messages shown over the board: server refusals, load failures, confirmations
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const showNotice = useCallback(
    (message: string, tone: "error" | "info" | "success" = "error") => {
      setNotices((current) => [...current, makeNotice(message, tone)]);
    },
    []
  );

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);
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
    game?.setOnTextRequest((at) => setEditing(at));
  }, [game]);

  useEffect(() => {
    game?.setOnNotice(showNotice);
  }, [game, showNotice]);

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
    setConfirmingClear(true);
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

      {/* key: each editor is a fresh instance. Reusing one would keep the
          previous text (the textarea is uncontrolled, so defaultValue only
          applies on mount) and the `finished` latch, which would make the
          second editor silently refuse to commit. */}
      {editing && (
        <TextOverlay
          key={editing.shape?.id ?? `${editing.at.x}-${editing.at.y}`}
          at={editing.at}
          // an existing text keeps its own styling: editing must not restyle it
          color={
            editing.shape
              ? resolveColor(editing.shape.color, theme)
              : palette.colors[selectedColor]
          }
          fontSize={editing.shape?.fontSize ?? DEFAULT_FONT_SIZE}
          fontFamily={editing.shape?.fontFamily ?? DEFAULT_FONT_FAMILY}
          initialValue={editing.shape?.text}
          onCommit={(value) => {
            if (editing.shape) {
              // editText handles the empty case by deleting the shape
              game?.editText(editing.shape.id, value);
            } else if (value.trim() !== "") {
              game?.addText(editing.at, value.trim(), DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY);
            }
            setEditing(null);
          }}
          onCancel={() => {
            // bring back the shape that was hidden while its editor was open
            game?.endTextEdit();
            setEditing(null);
          }}
        />
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="Clear this board?"
          message="Every shape is removed for everyone in the room. This cannot be undone."
          confirmLabel="Clear board"
          onConfirm={() => {
            setConfirmingClear(false);
            game?.clearRoom();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}

      <ToastStack notices={notices} onDismiss={dismissNotice} />

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
        <IconButton
          onClick={() => setSelectedTool("text")}
          activated={selectedTool === "text"}
          icon={<Type size={20} />}
          title="Text"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("eraser")}
          activated={selectedTool === "eraser"}
          icon={<Eraser size={20} />}
          title="Eraser"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("mouse_selector")}
          activated={selectedTool === "mouse_selector"}
          icon={<SquareDashedMousePointerIcon size={20} />}
          title="mouse_selector"
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
