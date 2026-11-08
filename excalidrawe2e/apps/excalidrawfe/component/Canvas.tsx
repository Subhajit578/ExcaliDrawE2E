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
  MousePointer2,
  Image as ImageIcon,
  Plus,
  Maximize,
  Hand,
  Compass,
  Grid2x2
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
import { IDENTITY_CAMERA, type Camera } from "@/draw/camera";
import {
  COLOR_NAMES,
  DEFAULT_COLOR,
  THEMES,
  resolveColor,
  type ColorName,
  type ThemeChoice,
} from "@/draw/theme";
export type Tool = "circle" | "rect" | "pencil" | "line" | "arrow" | "text" | "eraser" | "select" | "hand";

export function Canvas({ roomId, socket }: { roomId: string; socket: WebSocket }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  /**
   * Physical pixels per CSS pixel.
   *
   * 1 until the effect below runs, because window does not exist while this
   * renders on the server. Starting at the real value would mean guessing.
   */
  const [dpr, setDpr] = useState(1);
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
  // mirrored from Game so the zoom readout and the text editor can react to
  // it; Game remains the owner, this is a copy for rendering
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA);
  // whether any shape is on screen; drives the offer to scroll back
  const [contentVisible, setContentVisible] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Game asks for a tool change after adding an image, so the picture arrives
  // ready to move rather than leaving the drawing tool armed over it
  useEffect(() => {
    game?.setOnToolChange(setSelectedTool);
  }, [game]);

  useEffect(() => {
    game?.setOnCameraChange(setCamera);
  }, [game]);

  useEffect(() => {
    game?.setOnContentVisibilityChange(setContentVisible);
  }, [game]);

  useEffect(() => {
    game?.setOnGridChange(setGridOn);
  }, [game]);

  // Images arrive three ways - dropped, pasted, or picked from the toolbar -
  // and all three end at Game.addImage. Paste is the one people actually use:
  // it is how a screenshot gets onto a board.
  useEffect(() => {
    if (!game) return;

    // addImage places the picture at a point on the board, so a drop position
    // has to cross from screen to world first - otherwise a drop lands
    // somewhere else entirely once the board has been scrolled
    const centre = () => game.viewportCentreWorld();

    // Whether this drag is carrying a file at all. During dragover the files
    // themselves are not readable yet - only the item list is - so the kind
    // is all there is to go on, and it is enough.
    const carriesFile = (e: DragEvent) =>
      Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
      (e.dataTransfer?.types ?? []).includes("Files");

    const onDrop = (e: DragEvent) => {
      // Prevent the default for everything that lands on the board, not just
      // for the drops that turn into images. The board has already told the
      // browser it accepts drops, so bailing out without this leaves the
      // browser to handle the drop itself - which means navigating away from
      // the board to display whatever was dropped, losing the canvas.
      e.preventDefault();

      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        // A drag with no file: an image dragged out of another tab or app,
        // which travels as a URL rather than bytes. Saying so beats a drop
        // that visibly does nothing.
        const url = e.dataTransfer?.getData("text/uri-list");
        showNotice(
          url
            ? "That came across as a link, not a file. Save the image first, then drop the file - or copy the image and paste it here."
            : "Nothing to add - that drag did not carry a file.",
          "info"
        );
        return;
      }

      const rect = (e.target as HTMLElement)?.getBoundingClientRect?.();
      game.addImage(
        file,
        game.screenToWorld({
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        })
      );
    };

    // Without this the browser never fires `drop` at all - it navigates away
    // to display the dragged file instead. Setting dropEffect alongside it is
    // what stops the cursor promising a "copy" the board will then refuse:
    // the badge now appears only for drags that really are files.
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = carriesFile(e) ? "copy" : "none";
    };

    const onPaste = (e: ClipboardEvent) => {
      // let a paste into the text editor stay a paste into the text editor
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (!file) {
        // Copying an image in another browser tab often puts only its HTML on
        // the clipboard, not the bytes - "Copy image" works, "Copy" on the
        // surrounding page does not.
        const looksLikeAnImage = Array.from(e.clipboardData?.items ?? []).some((item) =>
          item.type.startsWith("image/")
        );
        if (looksLikeAnImage) {
          showNotice(
            "That clipboard entry points at an image but does not contain it. Use \"Copy image\" at the source, or save it and drop the file here.",
            "info"
          );
        }
        return;
      }
      e.preventDefault();
      game.addImage(file, centre());
    };

    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("paste", onPaste);
    };
  }, [game, showNotice]);

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // devicePixelRatio is not constant: it changes when the window is dragged
  // to a display of a different density, and when the browser is zoomed.
  // There is no event for it, but a media query pinned to the current value
  // stops matching the moment it changes - so the query is rebuilt each time,
  // which is what the dependency is for.
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    update();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [dpr]);

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
  }, [game, size.w, size.h, dpr]);

  function handlePickImage(file: File) {
    if (!game) return;
    game.addImage(file, game.viewportCentreWorld());
  }

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
      {/* Two sizes, deliberately different. The width/height attributes are
          the backing store in physical pixels; the CSS size is what it
          occupies on the page. Setting only the first would make the canvas
          enormous, only the second would leave it soft on a Retina display -
          the ratio between them is what buys the sharpness. */}
      <canvas
        ref={canvasRef}
        width={Math.round(size.w * dpr)}
        height={Math.round(size.h * dpr)}
        style={{ width: size.w, height: size.h, display: "block" }}
      />

      {/* key: each editor is a fresh instance. Reusing one would keep the
          previous text (the textarea is uncontrolled, so defaultValue only
          applies on mount) and the `finished` latch, which would make the
          second editor silently refuse to commit. */}
      {editing && (
        <TextOverlay
          key={editing.shape?.id ?? `${editing.at.x}-${editing.at.y}`}
          // Recomputed from the world point on every camera change, so
          // panning or zooming mid-edit carries the editor with the board
          // rather than leaving it stranded over the wrong place.
          at={game ? game.worldToScreen(editing.at) : editing.at}
          // an existing text keeps its own styling: editing must not restyle it
          color={
            editing.shape
              ? resolveColor(editing.shape.color, theme)
              : palette.colors[selectedColor]
          }
          // the stored size is in world units; what is typed has to match
          // what will be painted, which is that size times the zoom
          fontSize={(editing.shape?.fontSize ?? DEFAULT_FONT_SIZE) * camera.zoom}
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

      {/* accept + capture together: desktop gets a file picker, mobile offers
          the camera as well, which is the "camera photos" route */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePickImage(file);
          // reset, or picking the same file twice in a row fires no change
          e.target.value = "";
        }}
      />

      {/* Whenever nothing is on screen, whatever tool is in hand: getting lost
          is not something only the hand tool can do - a wheel scroll or a
          zoom will do it just as well, and needing to switch tools to find
          your way back is a strange thing to ask. Still conditional on being
          lost, so it never covers a board someone can already see. */}
      {!contentVisible && (
        <button
          type="button"
          onClick={() => game?.scrollToNearestContent()}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            background: palette.panel,
            border: `1px solid ${palette.panelBorder}`,
            color: palette.panelText,
            backdropFilter: "blur(8px)",
            fontSize: 13,
            cursor: "pointer",
            zIndex: 20,
          }}
        >
          <Compass size={16} />
          Scroll back to content
        </button>
      )}

      <ToastStack notices={notices} onDismiss={dismissNotice} />

      <TopBar
        selectedTool={selectedTool}
        setSelectedTool={setSelectedTool}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        onClear={handleClear}
        onPickImage={() => fileInputRef.current?.click()}
        zoom={camera.zoom}
        onZoomIn={() => game?.zoomBy(1.2)}
        onZoomOut={() => game?.zoomBy(1 / 1.2)}
        onResetView={() => game?.resetView()}
        onZoomToFit={() => game?.zoomToFit()}
        gridOn={gridOn}
        onToggleGrid={() => game?.toggleGrid()}
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
  onPickImage,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onZoomToFit,
  gridOn,
  onToggleGrid,
  themeChoice,
  onCycleTheme,
}: {
  selectedTool: Tool;
  setSelectedTool: (s: Tool) => void;
  selectedColor: ColorName;
  setSelectedColor: (c: ColorName) => void;
  onClear: () => void;
  onPickImage: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onZoomToFit: () => void;
  gridOn: boolean;
  onToggleGrid: () => void;
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
          onClick={onPickImage}
          activated={false}
          icon={<ImageIcon size={20} />}
          title="Add an image - or just paste or drop one"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("hand")}
          activated={selectedTool === "hand"}
          icon={<Hand size={20} />}
          title="Pan the board - or hold space with any tool"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("select")}
          activated={selectedTool === "select"}
          icon={<MousePointer2 size={20} />}
          title="Select"
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

      {/* On an infinite canvas being lost is a real state, and the only clue
          that you are is the zoom. The readout is the reset button, so the
          way out is where you were already looking. */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <IconButton
          onClick={onZoomOut}
          activated={false}
          icon={<Minus size={16} />}
          title="Zoom out"
          {...iconProps}
        />
        <button
          type="button"
          onClick={onResetView}
          title="Reset the view"
          style={{
            minWidth: 52,
            padding: "4px 6px",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            color: palette.panelText,
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          onClick={onZoomIn}
          activated={false}
          icon={<Plus size={16} />}
          title="Zoom in"
          {...iconProps}
        />
        <IconButton
          onClick={onZoomToFit}
          activated={false}
          icon={<Maximize size={16} />}
          title="Fit everything on screen"
          {...iconProps}
        />
      </div>

      <Divider color={palette.panelBorder} />

      <IconButton
        onClick={onToggleGrid}
        activated={gridOn}
        icon={<Grid2x2 size={20} />}
        title={gridOn ? "Hide the grid" : "Show the grid"}
        {...iconProps}
      />

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
