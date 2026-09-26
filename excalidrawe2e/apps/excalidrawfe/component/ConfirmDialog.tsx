"use client";
import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { THEMES } from "@/draw/theme";

/**
 * A modal that asks before something irreversible happens.
 *
 * Knows nothing about boards or rooms: give it words and two callbacks. It is
 * the replacement for window.confirm, which cannot be styled, cannot say what
 * will actually be lost, and blocks the whole tab while it is open.
 *
 * Render it conditionally - when it is on screen it takes focus, listens for
 * Escape, and closes on a backdrop click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger paints the confirm button red; use default for harmless choices */
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const palette = THEMES[theme];
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Cancel, not Confirm: a stray Enter should not destroy work.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const accent = tone === "danger" ? palette.colors.red : palette.colors.blue;

  return (
    <div
      onMouseDown={(e) => {
        // only a click on the backdrop itself cancels, not one that started
        // inside the dialog and drifted out
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(2px)",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{
          width: "min(420px, 100%)",
          background: palette.panel,
          border: `1px solid ${palette.panelBorder}`,
          borderRadius: 14,
          padding: 20,
          color: palette.panelText,
          boxShadow: "0 24px 60px -24px rgba(0, 0, 0, 0.7)",
          font: "14px/1.5 system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={20} style={{ color: accent, flex: "none", marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h2
              id="confirm-title"
              style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              {title}
            </h2>
            <p id="confirm-message" style={{ margin: "6px 0 0", color: palette.panelMuted }}>
              {message}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              borderRadius: 9,
              border: `1px solid ${palette.panelBorder}`,
              background: "transparent",
              color: palette.panelText,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "8px 14px",
              borderRadius: 9,
              border: "none",
              background: accent,
              color: "#ffffff",
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
