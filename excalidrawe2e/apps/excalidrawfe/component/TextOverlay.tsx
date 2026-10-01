"use client" 
import { Point, LINE_HEIGHT } from "@/draw/renderer";
import { useEffect, useRef, type KeyboardEvent } from "react";
export default function TextOverlay( {
    at, color, fontSize, fontFamily, initialValue, onCommit, onCancel
}: {
    at: Point; 
    color: string;
    fontSize: number;
    fontFamily: string;
    initialValue?: string;
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
      const el = textBox.current;
      el?.focus()
      fit();
      el?.setSelectionRange(el.value.length, el.value.length);
    }, []); 
    const finish = (commit: boolean) => {
        if(finished.current) return;
        finished.current = true;
        const value  = textBox.current?.value ?? ""
        if(commit) onCommit(value)
        else onCancel();
    }; 
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
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
          defaultValue={initialValue}
          wrap="off"
          spellCheck={false}
          onInput={fit}
          onKeyDown={handleKeyDown}
          onBlur={() => finish(true)}
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