import { ReactNode } from "react";

export function IconButton({
  icon,
  onClick,
  activated,
  color,
  activeColor,
  activeBackground,
  title,
}: {
  icon: ReactNode;
  onClick: () => void;
  activated: boolean;
  /** resting icon colour, from the theme palette */
  color: string;
  /** icon colour while this tool is selected */
  activeColor: string;
  /** pill behind the icon while selected */
  activeBackground: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={activated}
      aria-label={title}
      style={{
        display: "grid",
        placeItems: "center",
        padding: 8,
        borderRadius: 999,
        border: "none",
        background: activated ? activeBackground : "transparent",
        color: activated ? activeColor : color,
        cursor: "pointer",
        lineHeight: 0,
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {icon}
    </button>
  );
}
