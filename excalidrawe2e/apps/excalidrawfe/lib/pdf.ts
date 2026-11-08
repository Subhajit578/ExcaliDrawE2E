import type { BoardRender } from "@/draw/exportBoard";

/**
 * Wrapping a rendered board in a PDF.
 *
 * Separate from the drawing code on purpose: `Game` and the renderer know
 * how to make a picture, and nothing more. A PDF library imported into them
 * would ride along in every page that draws, for a feature almost nobody
 * uses in a given session.
 *
 * The document is one page, sized to the content rather than to A4. A
 * whiteboard has no page shape - cropping an arbitrary rectangle onto
 * Letter means either wide margins or lost corners, and neither is what
 * someone exporting a diagram wants. A viewer or printer can fit it to
 * paper; it cannot put back what was cropped.
 */

/**
 * Largest page side, in points.
 *
 * 14,400pt is 200 inches, the ceiling Acrobat and most viewers enforce on a
 * MediaBox. Past it a reader may refuse the file or clamp it silently. A
 * board that wide is rare, but an infinite canvas makes it possible, so the
 * page is scaled down to fit and the bitmap's own pixels carry the detail
 * instead - the picture loses nothing, it is just printed smaller.
 */
const MAX_PAGE_PT = 14_400;

/**
 * Save a rendered board as a one-page PDF.
 *
 * One world unit becomes one point, so the effective resolution is exactly
 * 72 x the render scale: a 2x render prints at 144 DPI, a 3x one at 216.
 * That is the whole reason the renderer is asked for 2-3x rather than 1x -
 * a 1x export would be a 72 DPI image, which looks like a screenshot of a
 * screenshot on paper.
 */
export async function saveBoardAsPdf(render: BoardRender, filename: string) {
  // loaded here rather than at the top of the module: jsPDF is a few
  // hundred kilobytes, and this is the only thing that needs it
  const { jsPDF } = await import("jspdf");

  const fit = Math.min(1, MAX_PAGE_PT / render.width, MAX_PAGE_PT / render.height);
  const width = render.width * fit;
  const height = render.height * fit;

  const doc = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "pt",
    format: [width, height],
    compress: true,
  });

  // bytes rather than a data URL: base64 is a third larger again, and a
  // large export is already tens of megabytes to hold in memory
  const bytes = new Uint8Array(await render.blob.arrayBuffer());

  // "FAST" is the deflate level for the PNG stream. The bitmap is already
  // compressed by the canvas encoder, so a slower setting spends real time
  // to save very little - and a JPEG stream is embedded as-is regardless.
  doc.addImage(bytes, render.format, 0, 0, width, height, undefined, "FAST");

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
