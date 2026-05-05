"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { nanoid } from "nanoid";
import { FileTransferManager } from "@/lib/file-transfer";
import type { ChatMessage, FileTransferProgress } from "@/lib/types";
import { playNotification } from "@/lib/sound";
import {
  decodeAnswerFromHash,
  decodeAnswerFromText,
  decodeOfferFromHash,
  encodeAnswerText,
  encodeOfferLink,
} from "@/lib/signal-url";

type ConnectionState = "idle" | "creating-offer" | "waiting-answer" | "connecting" | "connected";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;

  const [state, setState] = useState<ConnectionState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [fileProgress, setFileProgress] = useState<Map<string, FileTransferProgress>>(new Map());
  const [receivedFiles, setReceivedFiles] = useState<File[]>([]);
  const [shareLink, setShareLink] = useState("");
  const [answerLink, setAnswerLink] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const ftRef = useRef<FileTransferManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.from === "peer") playNotification();
  }, [messages]);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dcRef.current = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      setState("connected");
      setShareLink("");
      setAnswerLink("");
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      addMessage({
        id: nanoid(8), from: "system",
        text: "Connected. Messages are end-to-end encrypted.",
        timestamp: Date.now(), type: "system",
      });
    };
    channel.onclose = () => {
      addMessage({
        id: nanoid(8), from: "system",
        text: "Disconnected.", timestamp: Date.now(), type: "system",
      });
    };
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.__type === "file-meta" || parsed.__type === "file-end") {
            ftRef.current?.handleMessage(event);
            return;
          }
        } catch { /* not JSON */ }
        addMessage({
          id: nanoid(8), from: "peer", text: event.data,
          timestamp: Date.now(), type: "chat",
        });
      } else {
        ftRef.current?.handleMessage(event);
      }
    };
  }, [addMessage]);

  const createPeerConnection = useCallback((iceServers?: RTCIceServer[]) => {
    const pc = new RTCPeerConnection({ iceServers: iceServers || ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Try to store candidate via API (best effort)
        fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "candidate", roomId, candidate: event.candidate.toJSON() }),
        }).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setState("connected");
    };

    return pc;
  }, [roomId]);

  // Creator: create offer, show share link, poll for answer
  const createRoom = useCallback(async () => {
    setState("creating-offer");
    setError("");
    setAnswerText("");

    const pc = createPeerConnection();
    const dc = pc.createDataChannel("imv");
    setupDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const link = encodeOfferLink(window.location.origin, roomId, getLocalDescription(pc), ICE_SERVERS);
    setShareLink(link);
    setState("waiting-answer");

    // Poll for answer (works if Redis is configured)
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/signal?roomId=${roomId}`);
        const data = await r.json();
        if (data.answer) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setState("connecting");
        }
        // Also poll ICE candidates
        if (data.candidates?.length) {
          for (const c of data.candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
        }
      } catch { /* keep polling */ }
    }, 1000);
  }, [roomId, createPeerConnection, setupDataChannel]);

  // Joiner: extract offer from URL, create answer
  const joinRoom = useCallback(async () => {
    const hashData = decodeOfferFromHash(window.location.hash);
    if (!hashData) {
      setError("No offer found in URL");
      return;
    }

    setError("");
    setState("connecting");
    const pc = createPeerConnection(hashData.ice);
    pc.ondatachannel = (event) => setupDataChannel(event.channel);

    await pc.setRemoteDescription(new RTCSessionDescription(hashData.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc);
    const completeAnswer = getLocalDescription(pc);

    // Try to POST answer to API
    try {
      const res = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", roomId, sdp: completeAnswer }),
      });
      const result = await res.json();
      if (result.stored) {
        // API stored the answer — creator will poll it
        setState("connecting");
        return;
      }
    } catch { /* API unavailable */ }

    // Fallback: copy this answer back into the creator's still-open room page.
    setAnswerLink(encodeAnswerText(completeAnswer));
    setState("connecting");
  }, [roomId, createPeerConnection, setupDataChannel]);

  const applyManualAnswer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) {
      setError("Create a room before applying an answer");
      return;
    }

    const answer = decodeAnswerFromText(answerText);
    if (!answer) {
      setError("Invalid answer code");
      return;
    }

    try {
      setError("");
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      setAnswerText("");
      setState("connecting");
    } catch {
      setError("Could not apply answer code");
    }
  }, [answerText]);

  // Auto-detect role
  useEffect(() => {
    const ft = new FileTransferManager({
      send: (data) => { dcRef.current?.send(data); return true; },
      sendText: (text) => { dcRef.current?.send(text); return true; },
      onProgress: updateProgress,
      onFileReady: handleFileReady,
    });
    ftRef.current = ft;

    const startupTimer = window.setTimeout(() => {
      // Check if there's an answer in the hash (creator received answer link)
      const answer = decodeAnswerFromHash(window.location.hash);
      if (answer && pcRef.current) {
        pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setState("connecting");
        return;
      }

      if (window.location.hash.startsWith("#offer=")) {
        void joinRoom();
      }
    }, 0);

    return () => {
      window.clearTimeout(startupTimer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [joinRoom, updateProgress, handleFileReady]);

  // Poll for ICE candidates when connecting
  useEffect(() => {
    if (state !== "waiting-answer" && state !== "connecting") return;
    const pc = pcRef.current;
    if (!pc) return;

    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/signal?roomId=${roomId}`);
        const data = await r.json();
        if (data.candidates?.length) {
          for (const c of data.candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
        }
      } catch { /* keep polling */ }
    }, 1000);

    return () => clearInterval(poll);
  }, [state, roomId]);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || state !== "connected" || !dcRef.current) return;
    dcRef.current.send(text);
    addMessage({ id: nanoid(8), from: "self", text, timestamp: Date.now(), type: "chat" });
    setInputText("");
  };

  const sendFile = async (files: FileList) => {
    if (state !== "connected" || !ftRef.current) return;
    for (const file of Array.from(files)) {
      await ftRef.current.sendFile(file);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  };

  const isConnected = state === "connected";
  const isWaiting = state === "waiting-answer";
  const statusText = isConnected
    ? "Connected"
    : isWaiting
      ? "Waiting..."
      : state === "creating-offer"
        ? "Preparing..."
        : state === "connecting"
          ? "Connecting..."
          : "Ready";
  const statusClass = isConnected
    ? "text-green-400"
    : isWaiting || state === "creating-offer" || state === "connecting"
      ? "text-yellow-400"
      : "text-muted-foreground";

  return (
    <div
      className="flex flex-col flex-1 h-screen relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) sendFile(e.dataTransfer.files); }}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="border-2 border-dashed border-primary rounded-2xl p-16 text-center">
            <p className="text-xl font-medium text-primary">Drop files to send</p>
          </div>
        </div>
      )}

      <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <h1 className="font-bold text-lg">IMV</h1>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400" : statusClass === "text-yellow-400" ? "bg-yellow-400 animate-pulse" : "bg-muted-foreground"}`} />
          <span className={`text-sm ${statusClass}`}>
            {statusText}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Share link for creator */}
        {state === "creating-offer" && (
          <div className="text-center py-20 space-y-3">
            <p className="text-muted-foreground">Preparing a connection link...</p>
          </div>
        )}

        {isWaiting && shareLink && (
          <div className="text-center py-12 space-y-4">
            <p className="text-muted-foreground">Share this link with your peer:</p>
            <div className="bg-card border border-border rounded-lg p-4 break-all text-xs font-mono max-w-lg mx-auto">
              {shareLink}
            </div>
            <button onClick={() => copyText(shareLink)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <div className="pt-6 space-y-3 max-w-lg mx-auto">
              <p className="text-muted-foreground">Paste the answer code here:</p>
              <textarea
                value={answerText}
                onChange={(e) => { setAnswerText(e.target.value); setError(""); }}
                className="w-full min-h-24 rounded-lg border border-border bg-card p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={applyManualAnswer}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">
                Apply Answer
              </button>
            </div>
          </div>
        )}

        {/* Answer link fallback (when no Redis) */}
        {answerLink && (
          <div className="text-center py-8 space-y-4">
            <p className="text-muted-foreground">Connection answer ready. Copy this code back to the creator:</p>
            <div className="bg-card border border-border rounded-lg p-4 break-all text-xs font-mono max-w-lg mx-auto">
              {answerLink}
            </div>
            <button onClick={() => copyText(answerLink)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
              {copied ? "Copied!" : "Copy Answer Code"}
            </button>
          </div>
        )}

        {state === "connecting" && !answerLink && !isConnected && (
          <div className="text-center py-20 space-y-3">
            <p className="text-muted-foreground">Preparing connection...</p>
          </div>
        )}

        {/* Idle state */}
        {state === "idle" && (
          <div className="text-center py-20 space-y-4">
            <p className="text-muted-foreground">Create a room to start chatting</p>
            <button onClick={createRoom}
              className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90">
              Create Room
            </button>
          </div>
        )}

        {error && <div className="text-center text-destructive text-sm">{error}</div>}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.from === "self" ? "justify-end" : msg.from === "system" ? "justify-center" : "justify-start"}`}>
            {msg.type === "system" ? (
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">{msg.text}</span>
            ) : (
              <div className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm ${msg.from === "self" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border rounded-bl-md"}`}>
                {msg.text}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />

        {Array.from(fileProgress.values()).map((fp) => (
          <div key={fp.fileId} className="bg-card border border-border rounded-lg p-3 mx-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium truncate max-w-[200px]">{fp.direction === "send" ? "↑" : "↓"} {fp.fileName}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(fp.direction === "send" ? fp.sent : fp.received)} / {formatBytes(fp.fileSize)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-200 rounded-full" style={{ width: `${fp.fileSize > 0 ? ((fp.direction === "send" ? fp.sent : fp.received) / fp.fileSize) * 100 : 0}%` }} />
            </div>
          </div>
        ))}

        {receivedFiles.map((file, i) => (
          <div key={`${file.name}-${i}`} className="flex justify-center">
            <button onClick={() => downloadFile(file)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-sm hover:bg-muted transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download {file.name} ({formatBytes(file.size)})
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && sendFile(e.target.files)} className="hidden" multiple />
          <button onClick={() => fileInputRef.current?.click()} disabled={!isConnected} className="h-10 w-10 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30" title="Send file">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={isConnected ? "Type a message..." : "Waiting for connection..."} disabled={!isConnected}
            className="flex-1 h-10 rounded-lg border border-border bg-card px-3.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-30" />
          <button onClick={sendMessage} disabled={!isConnected || !inputText.trim()} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30">Send</button>
        </div>
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

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") cleanup();
    };
    const timeout = window.setTimeout(cleanup, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function getLocalDescription(pc: RTCPeerConnection): RTCSessionDescriptionInit {
  if (!pc.localDescription) {
    throw new Error("Peer connection has no local description");
  }

  return pc.localDescription.toJSON();
}
