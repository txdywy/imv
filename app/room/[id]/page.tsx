"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { MultiPeerManager, type PeerInfo } from "@/lib/multi-peer";
import { FileTransferManager } from "@/lib/file-transfer";
import type { ChatMessage, FileTransferProgress } from "@/lib/types";
import { playNotification } from "@/lib/sound";

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const isInitiator = searchParams.get("init") === "true";
  const roomId = params.id;
  const selfId = useRef(nanoid(8)).current;

  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [fileProgress, setFileProgress] = useState<Map<string, FileTransferProgress>>(new Map());
  const [receivedFiles, setReceivedFiles] = useState<File[]>([]);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const mpRef = useRef<MultiPeerManager | null>(null);
  const ftRef = useRef<FileTransferManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevConnectedRef = useRef(0);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateProgress = useCallback((progress: FileTransferProgress) => {
    setFileProgress((prev) => {
      const next = new Map(prev);
      next.set(progress.fileId, progress);
      return next;
    });
  }, []);

  const handleFileReady = useCallback((file: File) => {
    setReceivedFiles((prev) => [...prev, file]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Background notification for new messages
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.from === "peer") playNotification();
  }, [messages]);

  useEffect(() => {
    const mp = new MultiPeerManager(roomId, selfId, {
      onPeerChange: setPeers,
      onMessage: (from, data) => {
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data);
            if (parsed.__type === "file-meta" || parsed.__type === "file-end") {
              ftRef.current?.handleMessage({ data } as MessageEvent);
              return;
            }
          } catch {
            // not JSON, treat as chat
          }
          addMessage({
            id: nanoid(8),
            from: "peer",
            text: data,
            timestamp: Date.now(),
            type: "chat",
          });
        } else if (data instanceof ArrayBuffer) {
          ftRef.current?.handleMessage({ data } as MessageEvent);
        }
      },
    });

    mp.start();
    mpRef.current = mp;

    const ft = new FileTransferManager({
      send: (data) => mp.sendBinary(data),
      sendText: (text) => mp.sendMessage(text),
      onProgress: updateProgress,
      onFileReady: handleFileReady,
    });
    ftRef.current = ft;

    addMessage({
      id: nanoid(8),
      from: "system",
      text: isInitiator
        ? "Room created. Share the code to invite peers."
        : "Joined room. Connecting to peers...",
      timestamp: Date.now(),
      type: "system",
    });

    return () => mp.destroy();
  }, [roomId, selfId, isInitiator, addMessage, updateProgress, handleFileReady]);

  // Notify when peers connect
  useEffect(() => {
    const connected = peers.filter((p) => p.state === "connected").length;
    if (connected > prevConnectedRef.current) {
      addMessage({
        id: nanoid(8),
        from: "system",
        text: `Peer connected (${connected} total). Messages are end-to-end encrypted.`,
        timestamp: Date.now(),
        type: "system",
      });
    }
    prevConnectedRef.current = connected;
  }, [peers, addMessage]);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || peers.every((p) => p.state !== "connected")) return;

    if (mpRef.current?.sendMessage(text)) {
      addMessage({
        id: nanoid(8),
        from: "self",
        text,
        timestamp: Date.now(),
        type: "chat",
      });
      setInputText("");
    }
  };

  const sendFile = async (files: FileList) => {
    if (!ftRef.current || peers.every((p) => p.state !== "connected")) return;
    for (const file of Array.from(files)) {
      await ftRef.current.sendFile(file);
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(window.location.origin + `/room/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const connectedCount = peers.filter((p) => p.state === "connected").length;
  const hasConnection = connectedCount > 0;

  return (
    <div
      className="flex flex-col flex-1 h-screen relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length) sendFile(e.dataTransfer.files);
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="border-2 border-dashed border-primary rounded-2xl p-16 text-center">
            <p className="text-xl font-medium text-primary">Drop files to send</p>
            <p className="text-sm text-muted-foreground mt-2">Files transfer directly to peers</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-lg">IMV</h1>
          <button
            onClick={copyRoomCode}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-sm font-mono hover:bg-border transition-colors"
          >
            {roomId}
            <span className="text-xs text-muted-foreground">
              {copied ? "Copied!" : "Copy link"}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          {/* Peer badges */}
          {peers.length > 0 && (
            <div className="flex items-center gap-1">
              {peers.map((p) => (
                <div
                  key={p.id}
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${
                    p.state === "connected"
                      ? "bg-green-400"
                      : p.state === "connecting"
                      ? "bg-yellow-400 animate-pulse"
                      : "bg-muted-foreground"
                  }`}
                  title={`${p.id} — ${p.state}`}
                />
              ))}
            </div>
          )}
          <span
            className={`text-sm ${
              hasConnection ? "text-green-400" : "text-muted-foreground"
            }`}
          >
            {hasConnection
              ? `${connectedCount} peer${connectedCount > 1 ? "s" : ""}`
              : "Waiting..."}
          </span>
        </div>
      </header>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isInitiator && !hasConnection && (
          <div className="text-center py-20 space-y-4">
            <p className="text-muted-foreground">Share this room code:</p>
            <p className="text-5xl font-mono font-bold tracking-[0.3em] text-foreground">
              {roomId}
            </p>
            <button
              onClick={copyRoomCode}
              className="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-border transition-colors"
            >
              {copied ? "Link copied!" : "Copy invite link"}
            </button>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.from === "self"
                ? "justify-end"
                : msg.from === "system"
                ? "justify-center"
                : "justify-start"
            }`}
          >
            {msg.type === "system" ? (
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                {msg.text}
              </span>
            ) : (
              <div
                className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm ${
                  msg.from === "self"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card border border-border rounded-bl-md"
                }`}
              >
                {msg.text}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />

        {/* File transfer progress */}
        {Array.from(fileProgress.values()).map((fp) => (
          <div
            key={fp.fileId}
            className="bg-card border border-border rounded-lg p-3 mx-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium truncate max-w-[200px]">
                {fp.direction === "send" ? "↑" : "↓"} {fp.fileName}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(fp.direction === "send" ? fp.sent : fp.received)} /{" "}
                {formatBytes(fp.fileSize)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200 rounded-full"
                style={{
                  width: `${
                    fp.fileSize > 0
                      ? ((fp.direction === "send" ? fp.sent : fp.received) / fp.fileSize) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        ))}

        {/* Received files */}
        {receivedFiles.length > 0 && (
          <div className="flex flex-col gap-2 items-center">
            {receivedFiles.map((file, i) => (
              <button
                key={`${file.name}-${i}`}
                onClick={() => downloadFile(file)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-sm hover:bg-muted transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download {file.name} ({formatBytes(file.size)})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files && sendFile(e.target.files)}
            className="hidden"
            multiple
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!hasConnection}
            className="h-10 w-10 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
            title="Send file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={hasConnection ? "Type a message..." : "Waiting for peers..."}
            disabled={!hasConnection}
            className="flex-1 h-10 rounded-lg border border-border bg-card px-3.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-30"
          />
          <button
            onClick={sendMessage}
            disabled={!hasConnection || !inputText.trim()}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Drag & drop files to send directly to peers
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
