import type { SignalMessage } from "./types";

const POLL_INTERVAL = 500;

export class SignalingClient {
  private roomId: string;
  private selfId: string;
  private targetId?: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onMessage: ((msg: SignalMessage) => void) | null = null;

  constructor(roomId: string, selfId: string, targetId?: string) {
    this.roomId = roomId;
    this.selfId = selfId;
    this.targetId = targetId;
  }

  async createRoom(): Promise<boolean> {
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createRoom", roomId: this.roomId }),
    });
    return res.ok;
  }

  async joinRoom(): Promise<boolean> {
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "joinRoom", roomId: this.roomId, peerId: this.selfId }),
    });
    return res.ok;
  }

  async send(type: SignalMessage["type"], data: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "signal",
        roomId: this.roomId,
        message: {
          type,
          from: this.selfId,
          to: this.targetId,
          data,
          timestamp: Date.now(),
        },
      }),
    });
  }

  startPolling(callback: (msg: SignalMessage) => void) {
    this.onMessage = callback;
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll() {
    try {
      const params = new URLSearchParams({
        roomId: this.roomId,
        peerId: this.selfId,
      });
      if (this.targetId) params.set("targetId", this.targetId);
      const res = await fetch(`/api/signal?${params}`);
      if (!res.ok) return;
      const messages: SignalMessage[] = await res.json();
      for (const msg of messages) {
        this.onMessage?.(msg);
      }
    } catch {
      // silent
    }
  }
}
