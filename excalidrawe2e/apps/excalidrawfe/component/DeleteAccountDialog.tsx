"use client";
import React, { useState } from "react";
import axios from "axios";
import { AlertTriangle } from "lucide-react";
import { getToken } from "@/lib/session";

const API = "http://localhost:3001";

/**
 * Confirming account deletion.
 *
 * Its own component rather than a ConfirmDialog with an extra prop, because
 * the confirmation is not a button press: an account with a password has to
 * re-enter it. A token alone should not be enough to destroy an account, and
 * a dialog that asks for something is a different shape from one that asks
 * whether.
 *
 * The copy spells out what survives. "Delete account" reads as "erase
 * everything I did", and for shapes drawn on other people's boards that is
 * not what happens - saying so here is better than someone discovering it
 * afterwards, in either direction.
 */
export function DeleteAccountDialog({
  isGuest,
  roomCount,
  onCancel,
  onDeleted,
}: {
  isGuest: boolean;
  roomCount: number;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await axios.delete(`${API}/account`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        // axios puts a DELETE body under `data`, not as the second argument
        data: isGuest ? {} : { password },
      });
      onDeleted();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Could not delete the account");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-red-100 p-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">Delete this account?</h2>

            <div className="mt-2 space-y-2 text-sm text-gray-600">
              <p>
                This cannot be undone.{" "}
                {roomCount > 0 ? (
                  <>
                    Your <strong>{roomCount}</strong> canvas{roomCount === 1 ? "" : "es"} will be
                    deleted, along with everything anyone has drawn on {roomCount === 1 ? "it" : "them"}.
                  </>
                ) : (
                  <>You have no canvases of your own to lose.</>
                )}
              </p>
              <p>
                Anything you drew on <em>other people&rsquo;s</em> canvases stays where it is &mdash;
                it just stops being attributed to you.
              </p>
            </div>

            <form onSubmit={remove} className="mt-4 space-y-3">
              {!isGuest && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password to confirm"
                  autoComplete="current-password"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
                />
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Keep my account
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
