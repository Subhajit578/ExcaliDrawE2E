import type { Shape } from "./Game";
import { ShapeRenderer } from "./renderer";
import { paintShapes } from "./scene";
import { boundsUnion } from "./hitTest";
import { resolveColor, THEMES, type ThemeName } from "./theme";

/**
 * Rendering a board to a bitmap, for export.
 *
 * The same drawing code the screen uses, pointed at a canvas that is not on
 * screen and transformed to frame the content instead of the viewport. That
 * is the whole idea, and it is only this short because the camera already
 * made "draw the board from somewhere else at some other scale" an
 * expressible thing: `beginWorld` sets the matrix absolutely, so a different
 * scroll and zoom is all an export is.
 *
 * Nothing here knows what a PDF is. It produces a picture; wrapping that in
 * a document is a separate job for a separate file, which is what keeps a
 * PDF library out of the drawing code.
 */

/** Whole board, or only what is selected. */
export type ExportScope = "board" | "selection";

/** World units of breathing room left around the content. */
export const EXPORT_PAD = 24;

/**
 * The largest bitmap worth asking a browser for, in pixels.
 *
 * Browsers cap canvas size, and the cap is not the same everywhere. Measured
 * in Chromium: 65,535 on a single edge and about 268 megapixels of area
 * (2^28). Safari is far lower - around 16.7 megapixels (2^24), and older iOS
 * stops at 4096 x 4096.
 *
 * These are set near Safari's limit rather than Chromium's on purpose. Going
 * over does not throw: the context comes back unusable or `toBlob` returns
 * null, which reaches the person as a blank page rather than an error. A
 * slightly softer export everywhere is a better trade than a silently empty
 * one on an iPad.
 */
export const MAX_EXPORT_AREA = 16_000_000;
export const MAX_EXPORT_EDGE = 16_000;

/**
 * Above this, re-encode as JPEG.
 *
 * PNG is the right default: a whiteboard is flat colour and hard edges,
 * which it compresses to almost nothing and JPEG smears. But a board full of
 * photographs at 3x can produce a PNG of tens of megabytes, which is slow to
 * build, slow to embed and unpleasant to email. The threshold is the point
 * where fidelity stops being worth that.
 */
const MAX_PNG_BYTES = 12 * 1024 * 1024;

/** A rendered board: the picture, and the size it stands for in world units. */
export type BoardRender = {
  blob: Blob;
  /** how `blob` is encoded, in the spelling a PDF library wants */
  format: "PNG" | "JPEG";
  /** world units, which is also the natural page size in points */
  width: number;
  height: number;
  /** pixels per world unit actually used, after clamping */
  scale: number;
  /** what the caller asked for, so it can say when it could not be met */
  requestedScale: number;
};

/** The padded box around some shapes, or null when there are none. */
export function exportBounds(shapes: readonly Shape[]) {
  const b = boundsUnion(shapes as Shape[]);
  if (!b) return null;
  return {
    left: b.left - EXPORT_PAD,
    top: b.top - EXPORT_PAD,
    // floored, for the same reason cameraFitting floors: a single dot, a
    // perfectly vertical line or one character of text has zero extent on an
    // axis, and a canvas of zero width cannot be allocated
    width: Math.max(b.right - b.left, 1) + EXPORT_PAD * 2,
    height: Math.max(b.bottom - b.top, 1) + EXPORT_PAD * 2,
  };
}

/**
 * The largest scale at or below `wanted` that the browser should allocate.
 *
 * Allowed below 1, which is the part that is easy to get wrong. Flooring at
 * 1x looks like a quality guarantee and is really a crash: an infinite
 * canvas can hold a board whose own world size is past the ceiling before
 * any magnification at all - 8000 x 6000 is 48 megapixels at 1x, and a
 * 100,000-unit-wide board exceeds even the single-edge limit. Floored, those
 * ask for a canvas the browser will not give and come back as a blank page.
 *
 * Scaling below 1 costs resolution and nothing else. The PDF page is still
 * sized in world units, so a huge board exports at a lower DPI rather than
 * failing - which is what someone wanting a picture of their board would
 * choose if asked.
 */
export function exportScale(width: number, height: number, wanted: number): number {
  const byArea = Math.sqrt(MAX_EXPORT_AREA / (width * height));
  const byEdge = MAX_EXPORT_EDGE / Math.max(width, height);
  return Math.min(wanted, byArea, byEdge);
}

/**
 * Draw shapes into an off-screen bitmap.
 *
 * Always in the light palette. A board worked on at night is stored as
 * palette names, not colours, so it can be printed in whichever theme suits
 * paper - and that is the light one. Exporting a dark board as a dark page
 * is a wall of toner nobody asked for, and is the one place where the
 * decision to store names rather than hex values actually pays out.
 */
export async function renderShapesToBlob(
  shapes: readonly Shape[],
  images: ReadonlyMap<string, ImageBitmap | "loading" | "failed">,
  requestedScale: number
): Promise<BoardRender | null> {
  const box = exportBounds(shapes);
  if (!box) return null;

  const scale = exportScale(box.width, box.height, requestedScale);

  // a detached element rather than OffscreenCanvas: Safari only gained a 2D
  // context on OffscreenCanvas in 16.4, and toBlob is available everywhere
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.width * scale);
  canvas.height = Math.ceil(box.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const theme: ThemeName = "light";
  const renderer = new ShapeRenderer(ctx);

  renderer.clear(THEMES[theme].canvas);

  // The whole trick, in one call. The transform is
  //
  //     screen = (world + scroll) * zoom
  //
  // so a scroll of -box.left puts the left edge of the content at x = 0, and
  // a zoom of `scale` is the resolution multiplier.
  //
  // dpr is 1 deliberately. `scale` already is the multiplier; passing a
  // device ratio as well would square it, and a 3x export on a Retina
  // machine would quietly ask for nine times the pixels and fail the
  // ceiling above.
  renderer.beginWorld(-box.left, -box.top, scale, 1);
  try {
    paintShapes(renderer, shapes, {
      color: (stored) => resolveColor(stored, theme),
      images,
      placeholderColor: THEMES[theme].panelMuted,
      // no skipId: there is no editor overlay in a file, so a shape hidden
      // behind one would just be a hole
      // no highlightAlpha: the appear animation is a thing that happens on
      // screen, not a property of the board
      // no onMissingImage: every hash was awaited before this was called,
      // so anything still absent is genuinely unavailable
    });
  } finally {
    renderer.endWorld();
  }

  let blob = await toBlob(canvas, "image/png");
  let format: "PNG" | "JPEG" = "PNG";
  if (blob && blob.size > MAX_PNG_BYTES) {
    const jpeg = await toBlob(canvas, "image/jpeg", 0.92);
    // only if it actually helped - a board of flat colour can encode larger
    // as JPEG than as PNG, and would then be both bigger and worse
    if (jpeg && jpeg.size < blob.size) {
      blob = jpeg;
      format = "JPEG";
    }
  }

  // a 16-megapixel backing store is 64MB of memory; let it go now rather
  // than waiting for the element to be collected
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) return null;
  return { blob, format, width: box.width, height: box.height, scale, requestedScale };
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
