"use client";
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Check, Shuffle, X } from "lucide-react";
import { getToken } from "@/lib/session";
import { AvatarStyle, avatarUrl, fetchAvatarStyles, saveAvatar } from "@/lib/avatars";

/**
 * Choose a face from the pool.
 *
 * Browsing is local and saving is one request: clicking a face only moves the
 * selection, and nothing is written until Save. A picker that saved on every
 * click would fire a dozen writes for one decision, and would leave whatever
 * the pointer happened to land on last as the answer.
 *
 * The pool is fetched when this mounts - which is when it opens, because the
 * dashboard renders it conditionally. ~450KB of SVG exists in all, so loading
 * it on every dashboard visit for the few people who want to change their
 * avatar would be a poor trade. The grids are lazily loaded on top of that,
 * so only the style being looked at is actually fetched.
 */
export function AvatarPicker({
  current,
  username,
  onSaved,
  onClose,
}: {
  current: string | null;
  username: string;
  onSaved: (avatar: string) => void;
  onClose: () => void;
}) {
  const [styles, setStyles] = useState<AvatarStyle[] | null>(null);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(current);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAvatarStyles()
      .then((list) => {
        if (cancelled) return;
        setStyles(list);
        // open on the style the current avatar belongs to, so the face
        // someone already has is the one they are looking at
        const own = current?.split("/")[0];
        const match = list.find((s) => s.id === own) ?? list[0];
        setActiveStyle(match?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the avatars");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes, as it does for the other dialogs on this page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = useMemo(
    () => styles?.find((s) => s.id === activeStyle) ?? null,
    [styles, activeStyle]
  );

  /** Everything, flattened - only needed for the shuffle button. */
  const allIds = useMemo(() => (styles ?? []).flatMap((s) => s.ids), [styles]);

  function shuffle() {
    if (allIds.length === 0) return;
    // excluding what is already selected, so the button always visibly does
    // something rather than landing on the same face one time in seventy-two
    const options = allIds.filter((id) => id !== selected);
    const pick = options[Math.floor(Math.random() * options.length)];
    if (!pick) return;
    setSelected(pick);
    setActiveStyle(pick.split("/")[0] ?? activeStyle);
  }

  async function handleSave() {
    if (!selected || selected === current) {
      onClose();
      return;
    }
    const token = getToken();
    if (!token) return;

    setIsSaving(true);
    setError(null);
    try {
      // the server's answer, not the local pick: it validates against the
      // pool and is the thing every other viewer will be given
      const saved = await saveAvatar(selected, token);
      onSaved(saved);
      onClose();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      setError(message ?? "Could not save that avatar");
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose an avatar"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-7 pt-7 pb-5">
          <div className="flex items-center gap-4">
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 ring-1 ring-black/5">
              {avatarUrl(selected) ? (
                <img src={avatarUrl(selected)!} alt="" className="h-full w-full" />
              ) : (
                <span className="text-xl font-semibold text-indigo-600">
                  {username.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Choose your avatar</h3>
              <p className="mt-0.5 text-sm text-gray-600">
                {allIds.length > 0
                  ? `${allIds.length} to pick from, across ${styles?.length} styles.`
                  : "Loading the pool…"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Style tabs */}
        {styles && styles.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-gray-100 px-7 py-3">
            {styles.map((style) => (
              <button
                key={style.id}
                onClick={() => setActiveStyle(style.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  style.id === activeStyle
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          {error && !styles ? (
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          ) : !active ? (
            <div className="grid grid-cols-4 gap-4 sm:grid-cols-6">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-2xl bg-gray-100" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4 sm:grid-cols-6">
              {active.ids.map((id) => {
                const isSelected = id === selected;
                return (
                  <button
                    key={id}
                    onClick={() => setSelected(id)}
                    aria-pressed={isSelected}
                    aria-label={`${active.label} avatar ${id.split("/")[1]}`}
                    className={`relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 transition-all hover:scale-105 ${
                      isSelected
                        ? "ring-2 ring-indigo-600 ring-offset-2"
                        : "ring-1 ring-gray-200 hover:ring-gray-300"
                    }`}
                  >
                    <img
                      src={avatarUrl(id)!}
                      alt=""
                      loading="lazy"
                      className="h-full w-full"
                    />
                    {isSelected && (
                      <span className="absolute right-1 bottom-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 shadow">
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-7 py-5">
          <button
            onClick={shuffle}
            disabled={allIds.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <Shuffle className="h-4 w-4" />
            Surprise me
          </button>
          <div className="flex items-center gap-3">
            {error && styles && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !selected}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2.5 text-sm font-medium text-white shadow transition-all hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
