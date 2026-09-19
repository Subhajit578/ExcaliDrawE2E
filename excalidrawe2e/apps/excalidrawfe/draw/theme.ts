// One palette, two themes. This is the only place colours are defined: the React
// toolbar reads it for its swatches and chrome, and Game reads it when painting.
// Nothing here touches the browser's own colour-scheme preference - a user's
// choice is stored locally and layered on top of it.

export type ThemeName = "light" | "dark";

// "system" means "follow the browser preference", and is the default
export type ThemeChoice = "system" | ThemeName;

export type ColorName = "ink" | "red" | "blue" | "green" | "amber" | "purple";

// swatch order in the toolbar; "ink" is the default and flips per theme
export const COLOR_NAMES: ColorName[] = ["ink", "red", "blue", "green", "amber", "purple"];

export const DEFAULT_COLOR: ColorName = "ink";

export type Palette = {
  /** the drawing surface itself */
  canvas: string;
  /** toolbar background, sitting over the canvas */
  panel: string;
  panelBorder: string;
  panelText: string;
  panelMuted: string;
  /** the selected-tool highlight */
  accent: string;
  colors: Record<ColorName, string>;
};

export const THEMES: Record<ThemeName, Palette> = {
  dark: {
    canvas: "#0b0c0f",
    panel: "rgba(24, 26, 31, 0.88)",
    panelBorder: "rgba(255, 255, 255, 0.14)",
    panelText: "#f3f4f6",
    panelMuted: "rgba(255, 255, 255, 0.45)",
    accent: "#f87171",
    colors: {
      ink: "#f5f6f8",
      red: "#ef4444",
      blue: "#3b82f6",
      green: "#10b981",
      amber: "#f59e0b",
      purple: "#a855f7",
    },
  },
  light: {
    canvas: "#fdfdfc",
    panel: "rgba(255, 255, 255, 0.92)",
    panelBorder: "rgba(17, 24, 39, 0.12)",
    panelText: "#1f2937",
    panelMuted: "rgba(17, 24, 39, 0.45)",
    accent: "#dc2626",
    colors: {
      // deliberately not pure black, and each hue darkened so it holds up on white
      ink: "#1f2937",
      red: "#dc2626",
      blue: "#2563eb",
      green: "#059669",
      amber: "#b45309",
      purple: "#7e22ce",
    },
  },
};

// Shapes drawn before this step stored raw hex. Map the ones we shipped back onto
// palette names so old boards stay readable in both themes; anything else is
// honoured exactly as stored.
const LEGACY_HEX: Record<string, ColorName> = {
  "#ffffff": "ink",
  "#fff": "ink",
  "rgba(255, 255, 255)": "ink",
  "#ef4444": "red",
  "#3b82f6": "blue",
  "#10b981": "green",
  "#f59e0b": "amber",
  "#a855f7": "purple",
};

/**
 * Turn whatever a shape has stored into a colour to paint with, for this theme.
 * Accepts a palette name (what new shapes save), a legacy hex we recognise, or
 * an arbitrary hex.
 */
export function resolveColor(stored: string | undefined, theme: ThemeName): string {
  const palette = THEMES[theme];
  if (!stored) return palette.colors[DEFAULT_COLOR];

  const key = stored.toLowerCase();
  if (key in palette.colors) {
    return palette.colors[key as ColorName];
  }
  const legacy = LEGACY_HEX[key];
  if (legacy) {
    return palette.colors[legacy];
  }
  return stored;
}
