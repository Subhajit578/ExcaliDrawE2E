"use client";
import { useEffect } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { THEMES } from "@/draw/theme";

export type Tone = "error" | "info" | "success";

/**
 * One message on its way to the person using the board.
 *
 * `id` exists so a repeated message still animates as a new notice, and so
 * dismissing one does not disturb the others.
 */
export type Notice = {
  id: string;
  message: string;
  tone: Tone;
};

/** how long each tone stays before dismissing itself, in ms */
const LIFETIME: Record<Tone, number> = {
  error: 6000,
  info: 4000,
  success: 3000,
};

export function makeNotice(message: string, tone: Tone = "error"): Notice {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    message,
    tone,
  };
}

/**
 * A stack of dismissible messages over the canvas.
 *
 * Deliberately knows nothing about drawing: it takes a list and a way to
 * remove one, so anything in the app can use it - a rejected message from the
 * server, a failed save, a room that would not load, or a plain confirmation.
 */
export function ToastStack({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: string) => void;
}) {
  if (notices.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 50,
        // the stack itself must not swallow clicks meant for the canvas
        pointerEvents: "none",
      }}
    >
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: string) => void;
}) {
  const { theme } = useTheme();
  const palette = THEMES[theme];

  const accent =
    notice.tone === "error"
      ? palette.colors.red
      : notice.tone === "success"
        ? palette.colors.green
        : palette.colors.blue;

  const Icon =
    notice.tone === "error" ? AlertTriangle : notice.tone === "success" ? Check : Info;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notice.id), LIFETIME[notice.tone]);
    return () => clearTimeout(timer);
  }, [notice.id, notice.tone, onDismiss]);

  return (
    <div
      // errors interrupt; the quieter tones wait their turn
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 420,
        padding: "10px 12px",
        borderRadius: 10,
        background: palette.panel,
        border: `1px solid ${palette.panelBorder}`,
        borderLeft: `3px solid ${accent}`,
        color: palette.panelText,
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px -12px rgba(0, 0, 0, 0.5)",
        font: "14px/1.4 system-ui, -apple-system, sans-serif",
      }}
    >
      <Icon size={18} style={{ color: accent, flex: "none" }} />
      <span style={{ flex: 1 }}>{notice.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(notice.id)}
        aria-label="Dismiss"
        style={{
          display: "grid",
          placeItems: "center",
          border: "none",
          background: "transparent",
          color: palette.panelMuted,
          cursor: "pointer",
          padding: 2,
          lineHeight: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
