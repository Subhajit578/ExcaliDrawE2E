"use client" 
import { Point, LINE_HEIGHT } from "@/draw/renderer";
import { useEffect, useRef, type KeyboardEvent } from "react";
export default function TextOverlay( {
    at, color, fontSize, fontFamily, onCommit, onCancel
}: {
    at: Point; 
    color: string;
    fontSize: number;
    fontFamily: string;
    onCommit: (value: string) => void;
    onCancel: () => void
}) {
    const textBox = useRef<HTMLTextAreaElement>(null);
    const finished = useRef(false);
    const fit = () => {
        const el = textBox.current;
        if (!el) return;
        el.style.width = "0px";
        el.style.height = "0px";
        el.style.width = `${el.scrollWidth + 2}px`; // +2 leaves room for the caret
        el.style.height = `${el.scrollHeight}px`;
      };
    useEffect(() => {
        textBox.current?.focus()
        fit();
    }, []); 
    const finish = (commit: boolean) => {
        if(finished.current) return;
        finished.current = true;
        const value  = textBox.current?.value ?? ""
        if(commit && value.trim() !== "") onCommit(value)
        else onCancel();
    }; 
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        // Enter makes a new line, like any textarea. Saving happens when the
        // editor loses focus - click anywhere, pick another tool, start a
        // second text. Cmd/Ctrl+Enter is there for finishing without the mouse.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      };
      return (
        <textarea
          ref={textBox}
          rows={1}
          wrap="off"
          spellCheck={false}
          onInput={fit}
          onKeyDown={handleKeyDown}
          onBlur={() => finish(true)}
          // Don't let the canvas underneath start a stroke or selection.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: at.x,
            top: at.y,
            zIndex: 10,
            minWidth: "2ch",
            margin: 0,
            padding: 0,
            border: "none",
            outline: "1px dashed rgba(128, 128, 128, 0.7)",
            outlineOffset: 2,
            background: "transparent",
            resize: "none",
            overflow: "hidden",
            whiteSpace: "pre",
            color,
            caretColor: color,
            fontSize,
            fontFamily,
            lineHeight: LINE_HEIGHT,
          }}
        />
      );
}