/**
 * The key every session token is signed with.
 *
 * It used to fall back to a hardcoded string. Anyone who could read this
 * repository could forge a token for any account - including an admin's -
 * and nothing about the running service would look wrong. A default secret
 * is not a weak secret; it is a published one.
 *
 * Development keeps a fixed local value so three services agree without
 * anyone configuring anything. Anywhere else, a missing JWT_SECRET stops the
 * process at startup rather than quietly accepting forged tokens for the
 * lifetime of the deployment.
 */
const fromEnv = process.env.JWT_SECRET;

if (!fromEnv && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET is not set. Refusing to start with a known signing key."
  );
}

export const JWT_SECRET = fromEnv || "dev-only-insecure-shared-secret";
