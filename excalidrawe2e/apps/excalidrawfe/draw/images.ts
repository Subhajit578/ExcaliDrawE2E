import axios from "axios";

/**
 * Turning a dropped, pasted or picked file into something the board can hold.
 *
 * Nothing here touches the canvas or React - it is the pipeline from "a File
 * exists" to "these bytes are stored under this hash", and it is deliberately
 * the same path for all three input routes, because a screenshot from the
 * clipboard and a photo from a phone differ only in how they arrive.
 */

const API = "http://localhost:3001";

/**
 * Longest edge an uploaded image is reduced to, in pixels.
 *
 * A phone camera produces 4000px, 9MB files. Nothing on a whiteboard needs
 * that, and uploading it would cost the user a visible wait, the storage a
 * real bill, and every collaborator the download. Re-encoding at 2048 brings a
 * typical photo under 400KB with no difference anyone can see on screen.
 */
const MAX_EDGE = 2048;

/** Re-encode quality for the downscaled copy. */
const QUALITY = 0.85;

export type UploadedImage = {
  hash: string;
  /** natural size after downscaling, used to place the shape */
  width: number;
  height: number;
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

/**
 * Decode a file to a bitmap, honouring the orientation flag cameras write.
 *
 * Without `imageOrientation`, a portrait photo from a phone decodes sideways:
 * the pixels are landscape and an EXIF tag says "rotate me", which drawImage
 * does not read. This is the single most common way image support looks
 * broken to anyone uploading from a phone.
 */
async function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/**
 * Shrink to MAX_EDGE and re-encode as WebP.
 *
 * Returns the original bytes untouched when it is already small enough and
 * already a format worth keeping - re-encoding a 20KB PNG would only make it
 * bigger and lose a little quality for nothing.
 */
async function downscale(
  file: File,
  bitmap: ImageBitmap
): Promise<{ blob: Blob; width: number; height: number }> {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_EDGE && file.size <= 512 * 1024) {
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }

  const ratio = Math.min(1, MAX_EDGE / longest);
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare that image");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
  return { blob, width, height };
}

/**
 * The SHA-256 of some bytes, lowercase hex.
 *
 * The hash of the *downscaled* bytes, not the original: two people dropping
 * the same photo should agree on the name, and they only will if they hash
 * what is actually stored.
 *
 * crypto.subtle exists only in a secure context, so this works on localhost
 * and over https but is undefined on a plain-http LAN address - the same trap
 * newId() documents.
 */
async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("Image upload needs a secure page (https or localhost)");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Store a file, and get back the name the board will refer to it by.
 *
 * Three steps, and the middle one is the interesting part: the bytes go
 * straight from the browser to object storage with a presigned URL, so the API
 * server never buffers a megabyte of image. When the hash is already known the
 * upload is skipped entirely - pasting the same screenshot twice costs one
 * round trip.
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const bitmap = await decode(file);
  const { blob, width, height } = await downscale(file, bitmap);
  bitmap.close();

  const bytes = await blob.arrayBuffer();
  const hash = await sha256(bytes);
  const mimeType = blob.type || file.type;

  const presign = await axios.post(
    `${API}/files/presign`,
    { hash, mimeType, size: bytes.byteLength, width, height },
    { headers: authHeaders() }
  );

  if (presign.data.exists) {
    // someone has stored these exact bytes before, here or on another board
    return { hash, width: presign.data.width, height: presign.data.height };
  }

  // straight to storage; the API is not in this request's path
  await axios.put(presign.data.uploadUrl, blob, {
    headers: { "Content-Type": mimeType },
  });

  const confirmed = await axios.post(
    `${API}/files/confirm`,
    { hash, width, height },
    { headers: authHeaders() }
  );

  // the server reads the real dimensions out of the stored header, so prefer
  // its answer over the ones measured here - they agree in the normal case,
  // and when they do not the server's are the ones every other client will be
  // given for these bytes
  return {
    hash,
    width: confirmed.data.width ?? width,
    height: confirmed.data.height ?? height,
  };
}

/**
 * Where the bytes for a hash can be read from.
 *
 * Built in the browser from a public base rather than routed through the API,
 * so reads go straight to storage - or to the CDN in front of it - and never
 * occupy a Node process. The base is public config, not a secret: it is just
 * where the bucket is.
 *
 * No signing, because a SHA-256 key is already unguessable, and a signed URL
 * could not be cached.
 */
const PUBLIC_BASE = (
  process.env.NEXT_PUBLIC_STORAGE_PUBLIC_BASE ??
  "http://localhost:4566/whiteboard-images"
).replace(/\/+$/, "");

export function imageUrl(hash: string): string {
  return `${PUBLIC_BASE}/${hash}`;
}

/** Whether a dropped or pasted file is something we can actually draw. */
export function isSupportedImage(file: File): boolean {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
}
