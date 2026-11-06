/**
 * Reading an image's pixel dimensions out of its own header bytes.
 *
 * Pure parsing - no network, no storage, no image library. Every format in the
 * upload allowlist writes its dimensions within the first few hundred bytes
 * (JPEG being the exception that can need more), so the caller only has to
 * fetch a prefix of the object rather than download the whole thing.
 *
 * This exists because HeadObject reports size and content type but cannot
 * report dimensions - it does not decode anything. Dimensions were the one
 * pair of fields taken from the client on trust, and because a File row is
 * written once and then inherited by every later upload of the same bytes, a
 * wrong value was permanent with no path to correct it. Reading them from the
 * bytes closes that gap.
 *
 * Returns null rather than throwing on anything it does not recognise: a
 * failure to parse should fall back to the client's claim, not reject an
 * upload that is otherwise fine.
 */

export type Dimensions = { width: number; height: number };

/**
 * How much of an object is worth fetching to find its dimensions.
 *
 * PNG, GIF and WebP need under 32 bytes. JPEG keeps its size in an SOF marker
 * that sits after any EXIF block, and a camera photo's EXIF can carry a full
 * thumbnail, so the marker can be tens of kilobytes in. 64KB covers the
 * realistic cases while staying a fraction of the file.
 */
export const HEADER_BYTES = 64 * 1024;

/** PNG: 8-byte signature, then an IHDR chunk whose first two fields are the size. */
function png(b: Buffer): Dimensions | null {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  // bytes 8-11 are the chunk length, 12-15 the type, which must be IHDR
  if (b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** GIF: "GIF87a" or "GIF89a", then the logical screen size, little endian. */
function gif(b: Buffer): Dimensions | null {
  if (b.length < 10) return null;
  const magic = b.toString("ascii", 0, 6);
  if (magic !== "GIF87a" && magic !== "GIF89a") return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

/**
 * WebP: a RIFF container whose first chunk says which of three encodings it is.
 *
 * All three store the size differently, and a browser-encoded file can be any
 * of them - OffscreenCanvas.convertToBlob produces lossy VP8 for a photo and
 * can produce VP8L for flat graphics - so all three have to be handled.
 */
function webp(b: Buffer): Dimensions | null {
  if (b.length < 30) return null;
  if (b.toString("ascii", 0, 4) !== "RIFF") return null;
  if (b.toString("ascii", 8, 12) !== "WEBP") return null;

  const chunk = b.toString("ascii", 12, 16);

  if (chunk === "VP8 ") {
    // lossy: a 3-byte frame tag, then a sync code, then two 14-bit dimensions
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    // lossless: a 0x2f signature byte, then 14 bits of width-1 and 14 of
    // height-1 packed little endian across the next four bytes
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunk === "VP8X") {
    // extended: canvas size as two 24-bit little endian values, each minus one
    return {
      width: b.readUIntLE(24, 3) + 1,
      height: b.readUIntLE(27, 3) + 1,
    };
  }

  return null;
}

/**
 * JPEG: walk the marker chain to the start-of-frame, which carries the size.
 *
 * Unlike the others this is a scan rather than a fixed offset, because the
 * frame header sits after however many metadata segments the encoder wrote -
 * EXIF, ICC profile, a thumbnail. Each segment declares its own length, so the
 * walk is cheap, but it can run a long way into a camera photo.
 */
function jpeg(b: Buffer): Dimensions | null {
  if (b.length < 4) return null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null; // SOI

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      // not at a marker: either padding or a malformed file. Padding is legal
      // between segments, so step over it rather than giving up.
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    // fill bytes and the standalone markers carry no length field
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }

    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;

    // SOF0 through SOF15, excluding DHT (c4), JPG (c8) and DAC (cc), which
    // share the range but are not frame headers
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      // length(2), precision(1), then height and width, big endian
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }

    i += 2 + length;
  }
  return null;
}

/**
 * The pixel dimensions declared by these bytes, or null if they cannot be read.
 *
 * Dispatches on the magic number rather than on a claimed content type, so a
 * file whose type was reported wrongly is still read correctly - or not at all,
 * which is the safe outcome.
 */
export function readDimensions(bytes: Buffer): Dimensions | null {
  const found = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
  if (!found) return null;
  // a zero or absurd dimension means the parse went wrong, whatever the magic
  // number said
  if (
    !Number.isInteger(found.width) || !Number.isInteger(found.height) ||
    found.width < 1 || found.height < 1 ||
    found.width > 65535 || found.height > 65535
  ) {
    return null;
  }
  return found;
}
