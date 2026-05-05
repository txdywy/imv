import { NextRequest, NextResponse } from "next/server";

interface StoredSignal {
  type: string;
  from: string;
  to?: string;
  data: unknown;
  timestamp: number;
}

interface RoomData {
  messages: StoredSignal[];
  peers: string[];
  createdAt: number;
}

// In-memory store for local dev only
const memoryStore = new Map<string, RoomData>();
const isDev = process.env.NODE_ENV === "development";

// KV TTL: rooms expire after 1 hour
const ROOM_TTL = 3600;

// Cached KV instance
let kvInstance: typeof import("@vercel/kv").kv | null | undefined = undefined;

async function getKV() {
  if (kvInstance !== undefined) return kvInstance;
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv");
    kvInstance = kv;
    return kv;
  }
  kvInstance = null;
  return null;
}

async function getRoom(roomId: string) {
  const kv = await getKV();
  if (kv) return await kv.get<RoomData>(`room:${roomId}`);
  if (isDev) return memoryStore.get(`room:${roomId}`) || null;
  return null;
}

async function setRoom(roomId: string, data: RoomData) {
  const kv = await getKV();
  if (kv) {
    await kv.set(`room:${roomId}`, data, { ex: ROOM_TTL });
  } else if (isDev) {
    memoryStore.set(`room:${roomId}`, data);
  }
}

// POST: createRoom, joinRoom, signal
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, roomId } = body;

  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  if (action === "createRoom") {
    const existing = await getRoom(roomId);
    if (existing) {
      return NextResponse.json({ error: "Room already exists" }, { status: 409 });
    }
    await setRoom(roomId, { messages: [], peers: [], createdAt: Date.now() });
    return NextResponse.json({ ok: true });
  }

  if (action === "joinRoom") {
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const { peerId } = body;
    if (peerId && !room.peers.includes(peerId)) {
      room.peers.push(peerId);
      await setRoom(roomId, room);
    }
    return NextResponse.json({ ok: true, peers: room.peers });
  }

  if (action === "signal") {
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    room.messages.push(body.message as StoredSignal);
    await setRoom(roomId, room);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// GET: poll for messages
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  const peerId = req.nextUrl.searchParams.get("peerId");
  const targetId = req.nextUrl.searchParams.get("targetId");

  if (!roomId || !peerId) {
    return NextResponse.json({ error: "roomId and peerId required" }, { status: 400 });
  }

  const room = await getRoom(roomId);
  if (!room) {
    return NextResponse.json([]);
  }

  // Return messages targeted at this peer (or broadcast), not from self
  const messages = room.messages.filter((m) => {
    if (m.from === peerId) return false;
    if (targetId) {
      // Targeted signaling: only messages for this specific connection
      return m.to === peerId && m.from === targetId;
    }
    // Legacy: messages not from self
    return !m.to || m.to === peerId;
  });

  // Remove delivered messages
  const deliveredSet = new Set(messages);
  room.messages = room.messages.filter((m) => !deliveredSet.has(m));
  await setRoom(roomId, room);

  return NextResponse.json(messages);
}
