"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ThemeChoice, ThemeName } from "@/draw/theme";

const STORAGE_KEY = "excalidraw-theme";

type ThemeContextValue = {
  /** what the user picked: "system" until they choose otherwise */
  choice: ThemeChoice;
  /** what that resolves to right now */
  theme: ThemeName;
  setChoice: (choice: ThemeChoice) => void;
  /** system -> light -> dark -> system */
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // private mode or blocked storage: fall back to following the browser
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The server cannot know either of these, so both start at a safe default and
  // are corrected on mount. The inline script in layout.tsx sets data-theme
  // before first paint so there is no flash while that happens.
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [systemTheme, setSystemTheme] = useState<ThemeName>("dark");

  useEffect(() => {
    setChoiceState(readStoredChoice());
  }, []);

  // Track the browser preference, live. We only ever read it.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemTheme(query.matches ? "dark" : "light");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const theme: ThemeName = choice === "system" ? systemTheme : choice;

  // Expose the resolved theme to CSS. No attribute at all means "following the
  // browser", which keeps prefers-color-scheme rules in charge.
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", choice);
    }
    // so form controls and scrollbars match the canvas
    root.style.colorScheme = theme;
  }, [choice, theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // choice still applies for this session
    }
  }, []);

  const cycle = useCallback(() => {
    setChoice(choice === "system" ? "light" : choice === "light" ? "dark" : "system");
  }, [choice, setChoice]);

  return (
    <ThemeContext.Provider value={{ choice, theme, setChoice, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
