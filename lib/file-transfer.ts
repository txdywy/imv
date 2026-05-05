import type { FileMeta, FileTransferProgress } from "./types";
import { CHUNK_SIZE } from "./types";
import { nanoid } from "nanoid";

export type FileProgressCallback = (progress: FileTransferProgress) => void;

interface PendingReceive {
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  receivedChunks: Map<number, ArrayBuffer>;
  received: number;
}

export class FileTransferManager {
  private send: (data: ArrayBuffer) => boolean;
  private sendText: (text: string) => boolean;
  private onProgress: FileProgressCallback;
  private onFileReady: (file: File) => void;
  private pendingReceives = new Map<string, PendingReceive>();

  constructor(opts: {
    send: (data: ArrayBuffer) => boolean;
    sendText: (text: string) => boolean;
    onProgress: FileProgressCallback;
    onFileReady: (file: File) => void;
  }) {
    this.send = opts.send;
    this.sendText = opts.sendText;
    this.onProgress = opts.onProgress;
    this.onFileReady = opts.onFileReady;
  }

  async sendFile(file: File) {
    const fileId = nanoid(12);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const meta: FileMeta & { fileId: string } = {
      fileId,
      name: file.name,
      size: file.size,
      type: file.type,
      chunks: totalChunks,
    };

    this.sendText(JSON.stringify({ __type: "file-meta", ...meta }));
    this.onProgress({
      fileId,
      fileName: file.name,
      fileSize: file.size,
      sent: 0,
      received: 0,
      status: "transferring",
      direction: "send",
    });

    const buffer = await file.arrayBuffer();
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      const chunk = buffer.slice(start, end);

      // Prepend fileId (12 bytes) + chunk index (4 bytes) header
      const fileIdBytes = new TextEncoder().encode(fileId.padEnd(12, "\0"));
      const header = new Uint8Array(16);
      header.set(fileIdBytes, 0);
      new DataView(header.buffer).setInt32(12, i, true);

      const packet = new Uint8Array(header.length + chunk.byteLength);
      packet.set(header, 0);
      packet.set(new Uint8Array(chunk), header.length);

      this.send(packet.buffer);

      this.onProgress({
        fileId,
        fileName: file.name,
        fileSize: file.size,
        sent: end,
        received: 0,
        status: "transferring",
        direction: "send",
      });

      // Small delay to avoid overwhelming the channel
      if (i % 10 === 9) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    this.sendText(JSON.stringify({ __type: "file-end", fileId }));
    this.onProgress({
      fileId,
      fileName: file.name,
      fileSize: file.size,
      sent: file.size,
      received: 0,
      status: "complete",
      direction: "send",
    });
  }

  handleMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      const parsed = JSON.parse(event.data);
      if (parsed.__type === "file-meta") {
        this.pendingReceives.set(parsed.fileId, {
          fileName: parsed.name,
          fileSize: parsed.size,
          fileType: parsed.type,
          totalChunks: parsed.chunks,
          receivedChunks: new Map(),
          received: 0,
        });
        this.onProgress({
          fileId: parsed.fileId,
          fileName: parsed.name,
          fileSize: parsed.size,
          sent: 0,
          received: 0,
          status: "transferring",
          direction: "receive",
        });
      } else if (parsed.__type === "file-end") {
        this.finalizeReceive(parsed.fileId);
      }
    } else if (event.data instanceof ArrayBuffer) {
      this.handleChunk(event.data);
    }
  }

  private handleChunk(buffer: ArrayBuffer) {
    const header = new Uint8Array(buffer.slice(0, 16));
    const fileId = new TextDecoder().decode(header.slice(0, 12)).replace(/\0+$/, "");
    const chunkIndex = new DataView(buffer).getInt32(12, true);
    const data = buffer.slice(16);

    const pending = this.pendingReceives.get(fileId);
    if (!pending) return;

    pending.receivedChunks.set(chunkIndex, data);
    pending.received += data.byteLength;

    this.onProgress({
      fileId,
      fileName: pending.fileName,
      fileSize: pending.fileSize,
      sent: 0,
      received: pending.received,
      status: "transferring",
      direction: "receive",
    });
  }

  private finalizeReceive(fileId: string) {
    const pending = this.pendingReceives.get(fileId);
    if (!pending) return;

    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < pending.totalChunks; i++) {
      const chunk = pending.receivedChunks.get(i);
      if (chunk) parts.push(chunk);
    }

    const blob = new Blob(parts, { type: pending.fileType });
    const file = new File([blob], pending.fileName, { type: pending.fileType });
    this.onFileReady(file);

    this.onProgress({
      fileId,
      fileName: pending.fileName,
      fileSize: pending.fileSize,
      sent: 0,
      received: pending.fileSize,
      status: "complete",
      direction: "receive",
    });

    this.pendingReceives.delete(fileId);
  }
}
