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
