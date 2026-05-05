"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateRoomId } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  const createRoom = () => {
    const id = generateRoomId();
    router.push(`/room/${id}`);
  };

  const joinRoom = () => {
    const code = roomCode.trim();
    if (!code) {
      setError("Enter a room id");
      return;
    }
    router.push(`/room/${encodeURIComponent(code)}`);
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">IMV</h1>
          <p className="text-muted-foreground">
            Peer-to-peer chat & file transfer.
            <br />
            No servers. No accounts. Just connect.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={createRoom}
            className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Create Room
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">or join</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Room id"
                value={roomCode}
                onChange={(e) => { setRoomCode(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                className="flex-1 h-12 rounded-lg border border-border bg-card px-4 text-center text-lg font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={joinRoom}
                className="h-12 px-6 rounded-lg border border-border font-medium hover:bg-muted transition-colors">
                Join
              </button>
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
          </div>
        </div>

        <div className="pt-4 text-center text-xs text-muted-foreground space-y-1">
          <p>End-to-end encrypted via WebRTC DataChannel</p>
          <p>Files transfer directly between browsers</p>
        </div>
      </div>
    </div>
  );
}
