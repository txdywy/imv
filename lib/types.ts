export interface SignalMessage {
  type: "offer" | "answer" | "candidate";
  from: string;
  to?: string;
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
  timestamp: number;
}

export interface RoomInfo {
  id: string;
  createdAt: number;
  peers: string[];
}

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  timestamp: number;
  type: "chat" | "system";
}

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  chunks: number;
}

export interface FileChunk {
  fileId: string;
  index: number;
  total: number;
  data: ArrayBuffer;
}

export interface FileTransferProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  sent: number;
  received: number;
  status: "pending" | "transferring" | "complete" | "cancelled";
  direction: "send" | "receive";
}

export const CHUNK_SIZE = 64 * 1024; // 64KB
