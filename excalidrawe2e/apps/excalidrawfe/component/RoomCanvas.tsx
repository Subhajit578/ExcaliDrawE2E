"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { Canvas } from "./Canvas";
import { getToken, installSessionGuard } from "@/lib/session";

export function RoomCanvas() {
  // Read from the URL rather than taken as a prop from the server. That is
  // what lets the page itself be a static shell: nothing about the render
  // depends on which board this is.
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  const [roomId, setRoomId] = useState<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve slug → id
  useEffect(() => {
    installSessionGuard();
    // getToken, not localStorage: an expired token is treated as no token,
    // so a session that ran out while the tab was closed says "sign in again"
    // rather than failing as a 401 somewhere further in
    const token = getToken();
    if (!token) {
      setError("Your session has ended. Sign in again.");
      return;
    }
    axios
      .get(`http://localhost:3001/room/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setRoomId(res.data.room.id);
        // Opening a shared link is what joining means: the room is recorded on
        // this person's dashboard so they can get back to it. Idempotent, and
        // a no-op for the owner, so it is fire-and-forget - a failure here
        // must not stop the canvas loading.
        axios
          .post(
            `http://localhost:3001/room/${slug}/join`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          )
          .catch(() => {});
      })
      .catch(() => setError("Room not found"));
  }, [slug]);

  // Open socket once we have the id
  useEffect(() => {
    if (roomId === null) return;
    const token = getToken();
    if (!token) {
      setError("Your session has ended. Sign in again.");
      return;
    }
    const ws = new WebSocket(`ws://localhost:8080?token=${token}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join_room", roomId: String(roomId) }));
      setSocket(ws);
    };

    return () => ws.close();
  }, [roomId]);

  if (error) return <div className="p-8">{error}</div>;
  if (roomId === null) return <div className="p-8">Loading canvas...</div>;
  if (!socket) return <div className="p-8">Connecting to server...</div>;

  // the slug as well as the id: the id is what the protocol speaks, but the
  // slug is the name a person gave this canvas, so it is what an exported
  // file should be called
  return <Canvas roomId={String(roomId)} slug={slug} socket={socket} />;
}