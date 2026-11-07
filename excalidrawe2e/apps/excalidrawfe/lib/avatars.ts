/**
 * Avatars, as the browser deals with them.
 *
 * An avatar id is "<style>/<nn>" - "pixel-art/07" - and that is also where
 * its SVG lives: /avatars/pixel-art/07.svg, served by this app out of
 * `public`. So turning an id into something renderable is string work, with
 * no lookup table, no API call and no third-party request.
 *
 * The files are generated and committed by `scripts/generate-avatars.mjs`.
 * Nothing here talks to DiceBear, and neither does the build.
 */

import axios from "axios";

const API = "http://localhost:3001";

/** One style, as the picker groups the pool. */
export type AvatarStyle = {
  id: string;
  label: string;
  ids: string[];
};

/**
 * Only ids of the expected shape are turned into a path.
 *
 * The server resolves every avatar it sends against the pool, so a bad id
 * should not arrive. This is the cheap second check anyway, because the value
 * is going into a URL: without it, a surprising string from a stale or
 * mismatched API would be interpolated straight into a request path.
 */
const ID = /^[a-z0-9-]+\/\d{2}$/;

/** Where an avatar's SVG can be fetched from, or null if the id is not one. */
export function avatarUrl(id: string | null | undefined): string | null {
  if (!id || !ID.test(id)) return null;
  return `/avatars/${id}.svg`;
}

/**
 * The pool, for the picker.
 *
 * Fetched rather than bundled: the manifest lives in `@repo/common`, which
 * this app does not depend on, and inlining a copy would be a second list to
 * keep in step with the one the server validates against. It is asked for
 * when the picker opens, not on page load - nobody who never opens it pays
 * for it.
 */
export async function fetchAvatarStyles(): Promise<AvatarStyle[]> {
  const res = await axios.get(`${API}/avatars`);
  return res.data.styles ?? [];
}

/** Save a choice. Returns the avatar the server settled on. */
export async function saveAvatar(id: string, token: string): Promise<string> {
  const res = await axios.patch(
    `${API}/me/avatar`,
    { avatar: id },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.avatar;
}
