"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { Canvas } from "./Canvas";

export function RoomCanvas({ slug }: { slug: string }) {
  const [roomId, setRoomId] = useState<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve slug → id
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Not signed in");
      return;
    }
    axios
      .get(`http://localhost:3001/room/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setRoomId(res.data.room.id))
      .catch(() => setError("Room not found"));
  }, [slug]);

  // Open socket once we have the id
  useEffect(() => {
    if (roomId === null) return;
    const token = localStorage.getItem("token");
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

  return <Canvas roomId={String(roomId)} socket={socket} />;
}