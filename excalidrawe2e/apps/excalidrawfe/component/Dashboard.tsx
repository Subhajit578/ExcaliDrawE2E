"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  Sparkles,
  Plus,
  Trash2,
  ExternalLink,
  LogOut,
  Pencil,
  Share2,
  Check,
  MoreVertical,
} from "lucide-react";

type Room = {
  id: number;
  slug: string;
  createdAt: string;
};

const API = "http://localhost:3001";

export function Dashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Todo - Create a createModal 
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Todo - Create rename modal
  const [renameTarget, setRenameTarget] = useState<Room | null>(null);
  const [renameSlug, setRenameSlug] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Todo - Create share + per-card menu
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/signin");
      return;
    }
    fetchRooms();
  }, []);

  useEffect(() => {
    const close = () => setOpenMenuId(null);
    if (openMenuId !== null) {
      window.addEventListener("click", close);
      return () => window.removeEventListener("click", close);
    }
  }, [openMenuId]);

  function authHeaders() {
    return { Authorization: `Bearer ${localStorage.getItem("token")}` };
  }
// 
  async function fetchRooms() {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await axios.get(`${API}/rooms`, { headers: authHeaders() });
      setRooms(res.data.rooms);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message ?? "Failed to load canvases");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newSlug.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await axios.post(
        `${API}/room`,
        { slug: newSlug.trim() },
        { headers: authHeaders() }
      );
      router.push(`/canvas/${res.data.slug}`);
    } catch (err: any) {
      setCreateError(err?.response?.data?.message ?? "Failed to create");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(" Delete ? ")) return;
    try {
      await axios.delete(`${API}/room/${id}`, { headers: authHeaders() });
      setRooms((r) => r.filter((room) => room.id !== id));
    } catch {
      alert("Failed to delete");
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameTarget || !renameSlug.trim()) return;
    setIsRenaming(true);
    setRenameError(null);
    try {
        console.log("[rename] sending", { id: renameTarget.id, slug: renameSlug });
      const res = await axios.patch(
        `${API}/room/${renameTarget.id}`,
        { slug: renameSlug.trim() },
        { headers: authHeaders() }
      );
      console.log("[rename] got back", res.status, res.data);
      setRooms((r) =>
        r.map((room) =>
          room.id === renameTarget.id ? { ...room, slug: res.data.slug } : room
        )
      );
      console.log("[rename] new state", next);
      setRenameTarget(null);
      setRenameSlug("");
    } catch (err: any) {
      setRenameError(err?.response?.data?.message ?? "Failed to rename");
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleShare(room: Room) {
    const url = `${window.location.origin}/canvas/${room.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(room.id);
      setTimeout(() => setCopiedId((c) => (c === room.id ? null : c)), 1500);
    } catch {
      alert(url);
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    router.push("/signin");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50">
      {/* Top bar */}
      <header className="border-b border-gray-100 bg-white/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl shadow">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">My Canvases</h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Heading row */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Your work</h2>
            <p className="text-gray-600 mt-1">
              {rooms.length} {rooms.length === 1 ? "canvas" : "canvases"}
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-xl font-medium hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all"
          >
            <Plus className="w-5 h-5" />
            New canvas
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-56 bg-white/60 rounded-2xl border border-gray-100 animate-pulse"
              />
            ))}
          </div>
        ) : errorMsg ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
            {errorMsg}
          </div>
        ) : rooms.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-gray-100 p-16 text-center shadow">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No canvases yet
            </h3>
            <p className="text-gray-600 mb-6">
              Create your first canvas to start drawing.
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-xl font-medium hover:from-indigo-700 hover:to-purple-700 shadow"
            >
              <Plus className="w-5 h-5" />
              New canvas
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="group bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow hover:shadow-xl transition-all overflow-hidden relative"
              >
                {/* Thumbnail placeholder */}
                <div
                  onClick={() => router.push(`/canvas/${room.slug}`)}
                  className="h-32 bg-gradient-to-br from-indigo-100 via-purple-100 to-cyan-100 cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute inset-0 flex items-center justify-center opacity-30 group-hover:opacity-50 transition-opacity">
                    <Sparkles className="w-12 h-12 text-indigo-500" />
                  </div>
                </div>

                {/* Card body */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {room.slug}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(room.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>

                    {/* Per-card menu */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === room.id ? null : room.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label="More options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openMenuId === room.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-9 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-10"
                        >
                          <button
                            onClick={() => {
                              setRenameTarget(room);
                              setRenameSlug(room.slug);
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            Rename
                          </button>
                          <button
                            onClick={() => {
                              handleShare(room);
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            {copiedId === room.id ? (
                              <>
                                <Check className="w-4 h-4 text-green-600" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Share2 className="w-4 h-4" />
                                Share link
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              handleDelete(room.id);
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => router.push(`/canvas/${room.slug}`)}
                    className="mt-4 w-full flex items-center justify-center gap-1.5 bg-gray-900 text-white text-sm py-2 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create modal */}
      {isCreateOpen && (
        <Modal onClose={() => setIsCreateOpen(false)}>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">New canvas</h3>
          <p className="text-gray-600 mb-6">
            Pick a name. This becomes your shareable link.
          </p>
          <form onSubmit={handleCreate} className="space-y-4">
            <input
              autoFocus
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="my-cool-canvas"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
              required
            />
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <ModalButtons
              onCancel={() => setIsCreateOpen(false)}
              submitLabel={isCreating ? "Creating..." : "Create"}
              disabled={isCreating}
            />
          </form>
        </Modal>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)}>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            Rename canvas
          </h3>
          <p className="text-gray-600 mb-6">
            Note: this changes the shareable link.
          </p>
          <form onSubmit={handleRename} className="space-y-4">
            <input
              autoFocus
              type="text"
              value={renameSlug}
              onChange={(e) => setRenameSlug(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
              required
            />
            {renameError && <p className="text-sm text-red-600">{renameError}</p>}
            <ModalButtons
              onCancel={() => setRenameTarget(null)}
              submitLabel={isRenaming ? "Saving..." : "Save"}
              disabled={isRenaming}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

/* --- small modal helpers to keep markup tidy --- */

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalButtons({
  onCancel,
  submitLabel,
  disabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:from-indigo-700 hover:to-purple-700 shadow disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}