import { WebRTCManager, type ConnectionState } from "./webrtc";

export interface PeerInfo {
  id: string;
  state: ConnectionState;
}

export interface MultiPeerEvents {
  onPeerChange: (peers: PeerInfo[]) => void;
  onMessage: (from: string, data: string | ArrayBuffer) => void;
}

export class MultiPeerManager {
  private roomId: string;
  private selfId: string;
  private peers = new Map<string, { rtc: WebRTCManager; state: ConnectionState }>();
  private events: MultiPeerEvents;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private knownPeers = new Set<string>();

  constructor(roomId: string, selfId: string, events: MultiPeerEvents) {
    this.roomId = roomId;
    this.selfId = selfId;
    this.events = events;
  }

  async start() {
    await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "joinRoom", roomId: this.roomId, peerId: this.selfId }),
    });

    this.pollTimer = setInterval(() => this.pollPeers(), 2000);
    await this.pollPeers();
  }

  private async pollPeers() {
    try {
      const res = await fetch(`/api/signal/peers?roomId=${this.roomId}`);
      if (!res.ok) return;
      const { peers: peerIds }: { peers: string[] } = await res.json();

      for (const pid of peerIds) {
        if (pid === this.selfId || this.knownPeers.has(pid)) continue;
        this.knownPeers.add(pid);
        this.connectToPeer(pid, this.selfId < pid);
      }
    } catch {
      // silent
    }
  }

  private connectToPeer(peerId: string, isInitiator: boolean) {
    const rtc = new WebRTCManager(this.roomId, this.selfId, peerId, isInitiator, {
      onConnectionStateChange: (state) => {
        const entry = this.peers.get(peerId);
        if (entry) {
          entry.state = state;
          this.emitPeerChange();
        }
      },
      onDataChannelMessage: (event) => {
        this.events.onMessage(peerId, event.data);
      },
      onDataChannelOpen: () => {},
      onDataChannelClose: () => {},
    });

    rtc.start();
    this.peers.set(peerId, { rtc, state: "connecting" });
    this.emitPeerChange();
  }

  private emitPeerChange() {
    const list: PeerInfo[] = Array.from(this.peers.entries()).map(([id, { state }]) => ({
      id,
      state,
    }));
    this.events.onPeerChange(list);
  }

  sendMessage(text: string) {
    let sent = false;
    for (const { rtc } of this.peers.values()) {
      if (rtc.sendMessage(text)) sent = true;
    }
    return sent;
  }

  sendBinary(data: ArrayBuffer) {
    let sent = false;
    for (const { rtc } of this.peers.values()) {
      if (rtc.sendBinary(data)) sent = true;
    }
    return sent;
  }

  destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const { rtc } of this.peers.values()) {
      rtc.destroy();
    }
    this.peers.clear();
    this.knownPeers.clear();
  }
}
