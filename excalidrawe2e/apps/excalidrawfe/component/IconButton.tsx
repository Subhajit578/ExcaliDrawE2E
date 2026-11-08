import { ReactNode } from "react";

export function IconButton({
  icon,
  onClick,
  activated,
  color,
  activeColor,
  activeBackground,
  title,
  disabled = false,
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
  /**
   * Greyed out and unclickable.
   *
   * For work that takes long enough to notice - an export allocating a
   * bitmap of tens of megapixels - where a button that still looks live
   * invites a second press that would start the whole thing again.
   */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        lineHeight: 0,
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {icon}
    </button>
  );
}
