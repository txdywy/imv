import { SignalingClient } from "./signaling";
import type { SignalMessage } from "./types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface WebRTCEvents {
  onConnectionStateChange: (state: ConnectionState) => void;
  onDataChannelMessage: (event: MessageEvent) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private signaling: SignalingClient;
  private isInitiator: boolean;
  private events: WebRTCEvents;

  constructor(
    roomId: string,
    selfId: string,
    targetPeerId: string,
    isInitiator: boolean,
    events: WebRTCEvents
  ) {
    this.isInitiator = isInitiator;
    this.signaling = new SignalingClient(roomId, selfId, targetPeerId);
    this.events = events;
  }

  async start() {
    this.signaling.startPolling((msg) => this.handleSignal(msg));

    if (this.isInitiator) {
      setTimeout(() => this.createOffer(), 300);
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send("candidate", event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        this.events.onConnectionStateChange("connected");
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this.events.onConnectionStateChange("disconnected");
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    return pc;
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dc = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => this.events.onDataChannelOpen();
    channel.onclose = () => this.events.onDataChannelClose();
    channel.onmessage = (event) => this.events.onDataChannelMessage(event);
  }

  private async createOffer() {
    this.pc = this.createPeerConnection();
    this.events.onConnectionStateChange("connecting");

    this.setupDataChannel(this.pc.createDataChannel("imv"));

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.signaling.send("offer", offer);
  }

  private async handleSignal(msg: SignalMessage) {
    if (msg.type === "offer" && !this.isInitiator) {
      this.pc = this.createPeerConnection();
      this.events.onConnectionStateChange("connecting");

      await this.pc.setRemoteDescription(
        new RTCSessionDescription(msg.data as RTCSessionDescriptionInit)
      );
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.signaling.send("answer", answer);
    } else if (msg.type === "answer" && this.pc) {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(msg.data as RTCSessionDescriptionInit)
      );
    } else if (msg.type === "candidate" && this.pc) {
      await this.pc.addIceCandidate(
        new RTCIceCandidate(msg.data as RTCIceCandidateInit)
      );
    }
  }

  sendMessage(message: string) {
    if (this.dc?.readyState === "open") {
      this.dc.send(message);
      return true;
    }
    return false;
  }

  sendBinary(data: ArrayBuffer) {
    if (this.dc?.readyState === "open") {
      this.dc.send(data);
      return true;
    }
    return false;
  }

  destroy() {
    this.signaling.stopPolling();
    this.dc?.close();
    this.pc?.close();
  }
}
