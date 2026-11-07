import {z} from "zod";

export const CreateUserSchema = z.object({
    email: z.string(),
    username: z.string().min(3).max(20),
    password: z.string()
})
/**
 * Signing in.
 *
 * `identifier` is a username or an email, because guests never have an email
 * and existing accounts were created typing one. Accepting both means the
 * change to username-first logins locks nobody out.
 *
 * `email` is still accepted so that any client not yet updated keeps working.
 */
export const SigninUserSchema = z.object({
    identifier: z.string().min(3).max(64).optional(),
    email: z.string().min(3).optional(),
    password: z.string()
}).refine((d) => Boolean(d.identifier || d.email), {
    message: "A username or email is required",
})

/** Turning a guest into a real account: the credentials it never had. */
export const ClaimAccountSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8, "Use at least 8 characters"),
})
export const CreateRoomSchema = z.object({
   slug : z.string().min(3).max(20)
})

/**
 * Image formats the board accepts.
 *
 * An allowlist, not a blocklist. SVG is deliberately absent: it is a document
 * that can carry script, and rendering an untrusted one is a cross-site
 * scripting hole rather than a picture. HEIC is absent because only Safari can
 * decode it - accepting it would mean uploads that silently fail to render for
 * everyone else.
 */
export const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
];

/**
 * Largest upload accepted, in bytes.
 *
 * The client downscales to ~2048px and re-encodes before uploading, so a phone
 * photo arrives a few hundred kilobytes rather than the 9MB it started at.
 * This ceiling is the backstop for a client that did not, or did not want to.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Asking for permission to upload one image.
 *
 * The hash is the SHA-256 of the bytes the client is about to send, which is
 * also the object key. Checked against a strict pattern because it is
 * interpolated into a storage path: anything accepting slashes or dots here
 * would let a caller write outside its own namespace.
 */
export const PresignUploadSchema = z.object({
    hash: z.string().regex(/^[a-f0-9]{64}$/, "hash must be a lowercase hex sha-256"),
    // literals inline rather than z.enum(ALLOWED_IMAGE_TYPES): this file is
    // loaded as source at runtime, so it has to stay valid JavaScript, and the
    // `as const` that z.enum would need is TypeScript-only syntax
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
});

/** Reporting that the upload finished, so the row can be written. */
export const ConfirmUploadSchema = z.object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
});

/**
 * Choosing an avatar from the pool.
 *
 * Shape only - whether the id is actually one of the 72 is checked against
 * the manifest on the server, because a schema that listed them would have to
 * be regenerated alongside it and could drift out of step.
 *
 * The bound is a sanity limit on an id of the form "<style>/<nn>", not a
 * guarantee: it keeps a megabyte of junk out of a column that is interpolated
 * into an asset path.
 */
export const UpdateAvatarSchema = z.object({
    avatar: z.string().min(3).max(64),
})
