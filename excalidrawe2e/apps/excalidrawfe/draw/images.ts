import axios, { AxiosError } from "axios";

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

/**
 * The cap the API enforces, mirrored here so the browser can say "too large"
 * without a round trip.
 *
 * Declared rather than imported: the frontend does not depend on
 * `@repo/common`, for the same reason `lib/avatars.ts` fetches its manifest
 * instead of bundling it. The server remains the authority - this copy only
 * decides whether a request is worth sending, never whether it is allowed.
 * Keep it in step with MAX_IMAGE_BYTES in packages/common/src/types.ts.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Re-encode quality for the downscaled copy. */
const QUALITY = 0.85;

/**
 * Why an upload did not happen.
 *
 * The point of naming these is that each one has a different thing the person
 * can *do* about it: pick another file, shrink it, sign in again, or wait.
 * A single "it failed" message makes all four look the same, which is how a
 * stopped storage container and an unsupported HEIC photo end up feeling like
 * the same bug.
 */
export type UploadFailure =
  | "type"      // not a format the board can draw
  | "decode"    // the bytes are not a readable image
  | "too-large" // over the cap even after downscaling
  | "insecure"  // no crypto.subtle, so no content hash
  | "offline"   // nothing answered at all
  | "auth"      // the session is no longer valid
  | "storage"   // object storage refused the bytes
  | "server";   // the API refused the request

export class UploadError extends Error {
  constructor(
    readonly reason: UploadFailure,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "UploadError";
  }
}

const UNITS = ["B", "KB", "MB", "GB"];

/** A size a person can read, e.g. "7.2 MB". */
export function formatBytes(bytes: number): string {
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n < 10 && unit > 0 ? n.toFixed(1) : Math.round(n)} ${UNITS[unit]}`;
}

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
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (cause) {
    // The browser accepted the type but could not turn the bytes into pixels:
    // a truncated download, a file renamed to .png, or a format this browser
    // has no decoder for. HEIC is the one that bites in practice - it is what
    // an iPhone saves by default, and no desktop browser decodes it.
    throw new UploadError(
      "decode",
      file.type === "image/heic" || file.type === "image/heif"
        ? "This browser cannot read HEIC photos. On an iPhone, Settings > Camera > Formats > Most Compatible saves JPEGs instead."
        : `Could not read ${file.name || "that file"} - it looks damaged, or it is not really a ${file.type.replace("image/", "").toUpperCase() || "image"}.`,
      { cause }
    );
  }
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
  if (!ctx)
    throw new UploadError("decode", "This browser could not prepare that image for upload.");
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
    throw new UploadError(
      "insecure",
      "Images can only be uploaded from a secure page. Open the board over https, or on localhost."
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Turn an axios rejection into something worth showing someone.
 *
 * The API already answers with a specific message for every case it knows
 * about - a bad hash, a size over the cap, an upload that never arrived - so
 * the job here is mostly to stop throwing those away and to tell apart the
 * three shapes of failure axios reports identically: nothing answered, the
 * session is gone, and the server said no.
 */
function fromAxios(err: unknown, step: "presign" | "upload" | "confirm"): UploadError {
  if (err instanceof UploadError) return err;
  const axiosError = err as AxiosError<{ message?: string; issues?: string[] }>;
  if (!axios.isAxiosError(axiosError)) {
    return new UploadError("server", "Something went wrong uploading that image.", {
      cause: err,
    });
  }

  // No response at all: the request never reached anything. For the upload
  // step that is object storage rather than the API, and they fail
  // independently - the API can be up while the bucket is not, which is
  // exactly what a stopped storage container looks like.
  if (!axiosError.response) {
    const offline =
      step === "upload"
        ? "Could not reach image storage. The bytes never left the browser - the storage service looks like it is down."
        : "Could not reach the server. Check your connection and try again.";
    return new UploadError("offline", offline, { cause: err });
  }

  const status = axiosError.response.status;
  const said = axiosError.response.data?.message;
  const issues = axiosError.response.data?.issues;

  if (status === 401 || status === 403) {
    return new UploadError(
      "auth",
      said ?? "Your session has expired. Sign in again to upload images.",
      { cause: err }
    );
  }
  if (status === 413) {
    return new UploadError(
      "too-large",
      said ?? `That image is larger than the ${formatBytes(MAX_IMAGE_BYTES)} limit.`,
      { cause: err }
    );
  }
  if (status === 422 && issues?.length) {
    // the API validates hash, type, size and dimensions in one schema, so its
    // own issue text says which of them was wrong
    return new UploadError("server", `The server rejected that image: ${issues[0]}`, {
      cause: err,
    });
  }
  if (step === "upload") {
    return new UploadError(
      "storage",
      `Image storage refused the upload (${status}). Nothing was saved.`,
      { cause: err }
    );
  }
  return new UploadError("server", said ?? `The server refused that image (${status}).`, {
    cause: err,
  });
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

  // Check the cap here rather than letting the server's schema reject it.
  // By this point the image has already been downscaled and re-encoded, so
  // "still too big" is a real fact about the file and worth saying precisely -
  // and the person is spared a round trip to be told it.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new UploadError(
      "too-large",
      `That image is ${formatBytes(bytes.byteLength)} even after compression, over the ${formatBytes(MAX_IMAGE_BYTES)} limit. Try cropping it or saving it at a lower quality.`
    );
  }

  const hash = await sha256(bytes);
  const mimeType = blob.type || file.type;

  const presign = await axios
    .post(
      `${API}/files/presign`,
      { hash, mimeType, size: bytes.byteLength, width, height },
      { headers: authHeaders() }
    )
    .catch((err) => {
      throw fromAxios(err, "presign");
    });

  if (presign.data.exists) {
    // someone has stored these exact bytes before, here or on another board
    return { hash, width: presign.data.width, height: presign.data.height };
  }

  // straight to storage; the API is not in this request's path
  await axios
    .put(presign.data.uploadUrl, blob, { headers: { "Content-Type": mimeType } })
    .catch((err) => {
      throw fromAxios(err, "upload");
    });

  const confirmed = await axios
    .post(`${API}/files/confirm`, { hash, width, height }, { headers: authHeaders() })
    .catch((err) => {
      throw fromAxios(err, "confirm");
    });

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

const SUPPORTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Whether a dropped or pasted file is something we can actually draw. */
export function isSupportedImage(file: File): boolean {
  return SUPPORTED.includes(file.type);
}

/**
 * Why this file cannot be drawn, in words, or null if it can be.
 *
 * Separate from `isSupportedImage` because the answer "no" is not useful on
 * its own: a PDF, a HEIC photo and a folder are all rejected, and all three
 * need a different sentence to be worth reading.
 */
export function unsupportedReason(file: File): string | null {
  if (SUPPORTED.includes(file.type)) return null;

  if (file.type === "image/heic" || file.type === "image/heif") {
    return "HEIC photos cannot be read by browsers. On an iPhone, Settings > Camera > Formats > Most Compatible saves JPEGs instead.";
  }
  if (file.type === "image/svg+xml") {
    return "SVG files are not accepted, because an SVG can carry scripts. Export it as a PNG first.";
  }
  if (file.type.startsWith("image/")) {
    const kind = file.type.slice("image/".length).toUpperCase();
    return `${kind} images are not supported. The board accepts PNG, JPEG, WebP and GIF.`;
  }
  if (!file.type) {
    // a folder, or a file the OS could not identify
    return `${file.name || "That"} is not an image the board can read. Drop a PNG, JPEG, WebP or GIF.`;
  }
  return `${file.name || "That file"} is ${file.type}, not an image. The board accepts PNG, JPEG, WebP and GIF.`;
}
