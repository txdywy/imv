"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { generateRoomId } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ready) setStorageWarning("Database not connected. Go to Vercel → Storage → Create → Upstash Redis, then connect it to this project and redeploy.");
      })
      .catch(() => {});
  }, []);

  const createRoom = () => {
    const id = generateRoomId();
    router.push(`/room/${id}?init=true`);
  };

  const joinRoom = () => {
    const code = roomCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Enter a 6-character room code");
      return;
    }
    router.push(`/room/${code}`);
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
          {storageWarning && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              {storageWarning}
            </div>
          )}
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
              <span className="bg-background px-2 text-muted-foreground">
                or join
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Room code"
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(e.target.value.toUpperCase());
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                maxLength={6}
                className="flex-1 h-12 rounded-lg border border-border bg-card px-4 text-center text-lg font-mono tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={joinRoom}
                className="h-12 px-6 rounded-lg border border-border font-medium hover:bg-muted transition-colors"
              >
                Join
              </button>
            </div>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
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
