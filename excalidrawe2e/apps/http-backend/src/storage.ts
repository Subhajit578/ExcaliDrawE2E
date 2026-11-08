import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createGuard } from "@repo/backend-common/resilience";

/**
 * The object store is the second dependency that can hang.
 *
 * Only headObject reaches it - presigning is local HMAC and publicUrl is
 * string building, so neither can block. But headObject runs on every upload
 * confirm, and a wedged store would leave those requests holding sockets and
 * Node handles for as long as the SDK's own retries take.
 *
 * Tighter limits than the database gets: an existence check should be fast,
 * nothing else in the app depends on it, and the sensible answer when it is
 * unwell is to stop asking rather than to wait.
 */
const storageGuard = createGuard({
  name: "object-storage",
  timeoutMs: Number(process.env.STORAGE_TIMEOUT_MS) > 0 ? Number(process.env.STORAGE_TIMEOUT_MS) : 4000,
  concurrency: 20,
  queueLimit: 50,
  slowCallMs: 2000,
  failureThreshold: 0.5,
  minimumCalls: 5,
  openMs: 15000,
  halfOpenTrials: 2,
  onStateChange: (from, to, name) => console.warn(`[resilience] ${name}: ${from} -> ${to}`),
});

/** For the health endpoint, so the breaker's state is observable. */
export const storageHealth = () => storageGuard.snapshot;

/**
 * Object storage, configured entirely from the environment.
 *
 * MinIO, Cloudflare R2 and AWS S3 all speak the same S3 API, so there is no
 * provider abstraction here on purpose - an interface with three
 * implementations that differ only in a base URL would be ceremony around a
 * config value. Moving between them is an env change:
 *
 *   MinIO   endpoint http://localhost:9000   region us-east-1   path style
 *   R2      endpoint <account>.r2.cloudflarestorage.com  region auto  path style
 *   S3      endpoint omitted                 region eu-west-1  virtual host
 *
 * The one real difference is addressing. MinIO serves <endpoint>/<bucket>/<key>
 * while S3 prefers <bucket>.<endpoint>/<key>, which is what forcePathStyle
 * selects. Getting it wrong produces 404s that look like a missing object.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // fail at startup rather than on the first upload: a missing key here is a
    // deployment mistake, and it should not wait for a user to find it
    throw new Error(`[storage] ${name} is not set`);
  }
  return value;
}

export const STORAGE_BUCKET = required("STORAGE_BUCKET");

/** Where a stored object can be read from, without signing. */
const PUBLIC_BASE = required("STORAGE_PUBLIC_BASE").replace(/\/+$/, "");

/**
 * How long an upload URL stays valid.
 *
 * Long enough for a slow connection to finish a few hundred kilobytes, short
 * enough that a leaked URL is not a standing write permission. The client
 * downscales before uploading, so this is not sized for raw camera photos.
 */
const PRESIGN_EXPIRY_SECONDS = 300;

export const s3 = new S3Client({
  region: process.env.STORAGE_REGION || "us-east-1",
  /**
   * Do not add checksum headers unless the operation requires them.
   *
   * Since v3.729 the SDK computes a CRC32 of the body and sends it by default.
   * That breaks presigning: at signing time there is no body, so the checksum
   * of an *empty* payload gets baked into the signed query string, and the
   * real upload is then rejected with "Value for x-amz-checksum-crc32 header
   * is invalid". The signature itself is fine - it is the checksum that
   * disagrees, which is why the error does not mention signing at all.
   *
   * It also keeps the signed request to the headers every S3 implementation
   * understands, which matters for R2.
   */
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  // omitted for real S3, which derives the endpoint from the region
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
  },
});

/**
 * A URL the browser may PUT these exact bytes to, and nothing else.
 *
 * Signing happens locally - no network call - so this is cheap. The signature
 * covers the method, the bucket and the key, so a URL issued for one image
 * cannot be reused to write another, and it stops being valid after the expiry
 * above.
 *
 * It does *not* cover the body, which does not exist yet at signing time
 * (X-Amz-Content-Sha256=UNSIGNED-PAYLOAD), nor the content type, which the
 * presigner leaves out of SignedHeaders. So the URL authorises a write of this
 * key, not a write of particular bytes - which is why /files/confirm checks
 * what actually landed rather than trusting that it was what we signed for.
 *
 * This is what keeps the bytes off the API server: the browser uploads
 * straight to the store, and this process only ever handles the small JSON
 * either side of it.
 */
export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );
}

/**
 * What the store says about an object, or null when it has none.
 *
 * Used to confirm an upload really happened before a row is written. The
 * client reporting success is a claim, not evidence - trusting it would let
 * anyone register rows for objects that do not exist.
 */
export async function headObject(
  key: string
): Promise<{ size: number; mimeType: string } | null> {
  try {
    const head = await storageGuard.run(() =>
      s3.send(new HeadObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }))
    );
    return {
      size: head.ContentLength ?? 0,
      mimeType: head.ContentType ?? "application/octet-stream",
    };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    // 404 and 403 both mean "not there as far as we are concerned"; anything
    // else is a storage fault the caller should hear about
    if (status === 404 || status === 403) return null;
    throw err;
  }
}

/**
 * Where the browser reads an object from.
 *
 * Built from a base URL rather than signed, because a content hash is already
 * unguessable: knowing one tells you nothing about any other. That keeps reads
 * cacheable forever and lets a CDN serve them without involving this process.
 */
export function publicUrl(key: string): string {
  return `${PUBLIC_BASE}/${key}`;
}

/**
 * The first `length` bytes of an object, or null when it has none.
 *
 * A ranged GET, so the transfer is the prefix rather than the whole file -
 * reading a 400KB image's dimensions costs a few kilobytes. Ranges are part of
 * the S3 API proper, so this behaves the same on LocalStack, R2 and S3.
 *
 * Used by /files/confirm to read the real pixel dimensions out of the stored
 * header instead of believing the client's.
 */
export async function getObjectPrefix(
  key: string,
  length: number
): Promise<Buffer | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        // inclusive on both ends, so subtract one
        Range: `bytes=0-${length - 1}`,
      })
    );
    if (!res.Body) return null;
    // the SDK's stream helper, rather than hand-rolling a chunk collector
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    // 404 and 403 mean there is nothing to read; 416 means the object is
    // shorter than the range, which a tiny image legitimately is
    if (status === 404 || status === 403 || status === 416) return null;
    throw err;
  }
}
