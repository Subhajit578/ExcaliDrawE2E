"use client";
import React, { useState } from "react";
import axios from "axios";
import { UserRound, X } from "lucide-react";
import { setToken, daysLeft } from "@/lib/session";

const API = "http://localhost:3001";

/**
 * The offer to turn a guest account into a real one.
 *
 * A guest is held by its token and nothing else: lose the browser and the
 * account goes with it, boards included. So the banner leads with the
 * deadline rather than with the form - "keep your work" is the reason, the
 * email and password are the mechanism.
 *
 * Claiming keeps the same user row, so every board, membership and shape
 * stays put. Only the credentials are added.
 */
export function ClaimAccountBanner({
  username,
  onClaimed,
}: {
  username: string;
  onClaimed: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;
  const left = daysLeft();

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API}/account/claim`,
        { email, password },
        // read at call time rather than captured: the token may have been
        // replaced since this component mounted
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setToken(res.data.token);
      onClaimed(res.data.token);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Could not save those details");
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-amber-100 p-2">
          <UserRound className="h-5 w-5 text-amber-700" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">
            You are signed in as <span className="font-mono">{username}</span>, a guest
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {left === null
              ? "Add an email and password to keep these boards."
              : `This session ends in ${left} day${left === 1 ? "" : "s"}, and the boards go with it. Add an email and password to keep them.`}
          </p>

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Keep my account
            </button>
          ) : (
            <form onSubmit={claim} className="mt-3 flex flex-wrap items-start gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="min-w-[200px] flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                autoComplete="new-password"
                minLength={8}
                required
                className="min-w-[200px] flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
          )}

          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          {open && (
            <p className="mt-2 text-xs text-amber-700">
              Your username stays <span className="font-mono">{username}</span> — sign in
              with either that or your email.
            </p>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          // dismissal is for this page view only, deliberately: a guest who
          // waves it away and then loses the browser loses everything, so it
          // comes back on the next visit
          aria-label="Hide for now"
          className="rounded p-1 text-amber-700 hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
