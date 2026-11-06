/**
 * The signed-in session, as the browser holds it.
 *
 * One module so that "is there a token, and is it still good?" has a single
 * answer. Tokens last 15 days; a guest account is held by nothing else, so
 * when it expires that account is gone - which is why the expiry is checked
 * before use rather than discovered as a 401 halfway through loading a board.
 */

import axios from "axios";

const KEY = "token";

type Claims = { userId: string; username: string; exp?: number };

/**
 * Read the claims without verifying the signature.
 *
 * Decoding is not checking: a token could be tampered with and this would
 * happily read it. That is fine here because nothing is trusted on the
 * strength of it - the server verifies every request, and this is only used
 * to avoid sending one that is already known to be stale.
 */
export function readClaims(token: string): Claims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The token, or null when there is none or it has expired. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(KEY);
  if (!token) return null;

  const claims = readClaims(token);
  // `exp` is in seconds; Date.now() is in milliseconds. Tokens issued before
  // expiry existed have none, and are treated as still valid rather than
  // signing those people out for an upgrade they did not ask for.
  if (claims?.exp && claims.exp * 1000 <= Date.now()) {
    localStorage.removeItem(KEY);
    return null;
  }
  return token;
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

/** Days left on the session, or null when it never expires. */
export function daysLeft(): number | null {
  const token = getToken();
  const claims = token ? readClaims(token) : null;
  if (!claims?.exp) return null;
  return Math.max(0, Math.ceil((claims.exp * 1000 - Date.now()) / 86_400_000));
}

/**
 * Sign the tab out when the server stops recognising its token.
 *
 * A token can stop working without expiring: the account was deleted, or it
 * was a guest whose session ran out and whose row has been swept away. The
 * local expiry check cannot see any of that - the token still looks fine - so
 * without this the tab sits there failing every request with no explanation.
 *
 * The discriminator is whether the failed request carried an Authorization
 * header. An authenticated request answered with 401 means the credential is
 * dead. An *unauthenticated* 401 is just a wrong password on the sign-in
 * form, and treating that as a dead session would wipe the token of whoever
 * was already signed in on the same tab.
 *
 * Installed once per page; calling it again is a no-op. The error is always
 * re-thrown, so callers still see their own failure.
 */
let installed = false;

export function installSessionGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error?.response?.status;
      const sentCredentials = Boolean(error?.config?.headers?.Authorization);

      if (status === 401 && sentCredentials) {
        clearToken();
        // a full navigation rather than a router push: this can fire from
        // anywhere, including code with no router to hand, and the session is
        // gone so there is no state worth preserving
        if (!window.location.pathname.startsWith("/signin")) {
          window.location.href = "/signin";
        }
      }
      return Promise.reject(error);
    }
  );
}
