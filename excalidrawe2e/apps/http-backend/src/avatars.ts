/**
 * The avatar pool, as the server deals with it.
 *
 * The pool itself is generated - `packages/common/src/avatars.ts`, written by
 * `scripts/generate-avatars.mjs` from DiceBear. That file is data and nothing
 * else, because the backend loads it as raw source at runtime and Node will
 * not tolerate a type annotation in it. So the logic lives here instead: this
 * module is the only thing that decides what a valid avatar is, which account
 * gets which one, and what to show when the stored answer is no good.
 *
 * An avatar id is "<style>/<nn>" - "pixel-art/07". It is three things at once:
 * the value in `User.photo`, the path of the SVG under the frontend's
 * /avatars, and a key into the manifest. Nothing has to be mapped, and there
 * is no table of URLs to keep in step.
 */

import { AVATAR_IDS, AVATAR_STYLES } from "@repo/common/avatars";

/** One style, as the picker is told about it. */
export type AvatarStyle = {
  id: string;
  label: string;
  ids: string[];
};

export const STYLES: AvatarStyle[] = AVATAR_STYLES;

/**
 * Membership is checked against a Set, not a regex.
 *
 * A regex would have to encode the shape of the pool - six style names and a
 * two-digit range - and would then quietly start accepting ids that no longer
 * exist the moment a style is dropped or the count changes. The manifest is
 * the authority; this is just a fast way to ask it.
 */
const POOL = new Set<string>(AVATAR_IDS);

export function isAvatarId(value: unknown): value is string {
  return typeof value === "string" && POOL.has(value);
}

/**
 * A random avatar, for an account that is being created.
 *
 * Uniform across the whole pool rather than picking a style first: styles have
 * the same number of faces today, but picking a style then a face inside it
 * would silently start favouring the smaller styles the moment they differ.
 */
export function randomAvatarId(): string {
  const i = Math.floor(Math.random() * AVATAR_IDS.length);
  // AVATAR_IDS is never empty (the generator writes at least one per style),
  // but noUncheckedIndexedAccess cannot know that, and falling back to the
  // first entry is better than returning undefined into a database column
  return AVATAR_IDS[i] ?? AVATAR_IDS[0]!;
}

/**
 * A stable avatar derived from an account's id.
 *
 * Deterministic so that the same account looks the same on every page load
 * and to every person looking at it - a random pick here would give someone a
 * different face each time the dashboard loaded, which reads as a bug.
 *
 * FNV-1a, not a cryptographic hash: this picks a picture, and the only
 * property that matters is that it spreads uuids evenly across 72 buckets.
 */
function avatarFromId(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_IDS[h % AVATAR_IDS.length] ?? AVATAR_IDS[0]!;
}

/**
 * What to actually show for an account.
 *
 * Every read goes through this rather than trusting the column, for two
 * reasons that are easy to mistake for one:
 *
 *   - Accounts created before avatars existed hold `""`. Resolving on read
 *     means they get a face immediately, with no backfill migration and no
 *     window where the dashboard renders a broken image.
 *   - An id can stop being valid *after* it was stored. Dropping a style from
 *     the pool deletes its SVGs, and every account that had chosen one would
 *     otherwise point at a 404 forever. Checking here turns that from a
 *     visible break into a silent fall back to a face that exists.
 *
 * The fallback is not persisted. Writing it would turn a derived default into
 * a stored choice, and the next pool change could not correct it.
 */
export function avatarFor(photo: string | null | undefined, userId: string): string {
  return isAvatarId(photo) ? photo : avatarFromId(userId);
}
